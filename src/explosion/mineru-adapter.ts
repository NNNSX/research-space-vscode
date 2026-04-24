import * as path from 'path';
import * as vscode from 'vscode';
import { createWriteStream, promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { MinerUConfig, MinerUErrorCode, MinerUParseResponse } from './explosion-types';
import { getExplosionSourceTypeFromPath } from '../core/explosion-file-types';

// `yauzl` is bundled into dist by esbuild; keep require-style import to avoid extra type deps.
const yauzl = require('yauzl');

const DEFAULT_ONLINE_API_BASE = 'https://mineru.net';
const DEFAULT_LOCAL_API_URL = 'http://localhost:8000';
const DEFAULT_OUTPUT_DIR = '.research-space/explosions';
const DEFAULT_LOCAL_ENDPOINT = '/file_parse';
const DEFAULT_POLL_INTERVAL_MS = 2500;
const DEFAULT_POLL_TIMEOUT_MS = 300000;
const COMPLETED_TASK_STATES = new Set(['done', 'success', 'completed', 'finished', 'succeeded']);
const FAILED_TASK_STATES = new Set(['failed', 'error']);

type MinerUErrorContext = {
  status?: number;
  detail?: string;
  cause?: unknown;
};

export class MinerUError extends Error {
  readonly code: MinerUErrorCode;
  readonly status?: number;
  readonly detail?: string;

  constructor(code: MinerUErrorCode, message: string, context?: MinerUErrorContext) {
    super(message);
    this.name = 'MinerUError';
    this.code = code;
    this.status = context?.status;
    this.detail = context?.detail;
    if (context && 'cause' in context) {
      (this as Error & { cause?: unknown }).cause = context.cause;
    }
  }
}

function readString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readNestedString(value: unknown, paths: string[][]): string | undefined {
  for (const keys of paths) {
    let current: unknown = value;
    let ok = true;
    for (const key of keys) {
      if (!current || typeof current !== 'object' || !(key in (current as Record<string, unknown>))) {
        ok = false;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (ok && typeof current === 'string' && current.trim()) {
      return current.trim();
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizePath(value?: string): string | undefined {
  if (!value) { return undefined; }
  return path.normalize(value);
}

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
  return sanitized || 'untitled';
}

function trimMessage(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildErrorMessage(prefix: string, detail?: string): string {
  return detail ? `${prefix} ${detail}` : prefix;
}

function createMinerUError(code: MinerUErrorCode, message: string, context?: MinerUErrorContext): MinerUError {
  return new MinerUError(code, message, context);
}

function asMinerUError(error: unknown): MinerUError | undefined {
  return error instanceof MinerUError ? error : undefined;
}

function classifyApiError(status: number, payload: unknown, fallbackPrefix: string): MinerUError {
  const detail = trimMessage(toErrorMessage(status, payload).replace(/^MinerU API error \d+:\s*/, '').replace(/^MinerU API error \d+$/, ''));
  const normalizedDetail = (detail ?? '').toLowerCase();

  if (status === 401 || status === 403) {
    return createMinerUError('api_auth_failed', buildErrorMessage('MinerU 在线 API 鉴权失败，请检查 Token 是否有效。', detail), { status, detail });
  }
  if (status === 402 || normalizedDetail.includes('quota') || normalizedDetail.includes('balance') || normalizedDetail.includes('credit')) {
    return createMinerUError('api_quota_exceeded', buildErrorMessage('MinerU 在线 API 配额不足或余额不足。', detail), { status, detail });
  }
  if (status === 429 || normalizedDetail.includes('rate limit') || normalizedDetail.includes('too many requests')) {
    return createMinerUError('api_rate_limited', buildErrorMessage('MinerU 在线 API 当前限流，请稍后重试。', detail), { status, detail });
  }
  return createMinerUError('api_error', buildErrorMessage(fallbackPrefix, detail), { status, detail });
}

function wrapTransportError(code: MinerUErrorCode, message: string, error: unknown): MinerUError {
  return createMinerUError(code, message, {
    cause: error,
    detail: error instanceof Error ? error.message : String(error),
  });
}

export function isMinerUTaskCompletedState(state: string | undefined): boolean {
  const normalized = state?.trim().toLowerCase();
  return !!normalized && COMPLETED_TASK_STATES.has(normalized);
}

function isMinerUTaskFailedState(state: string | undefined): boolean {
  const normalized = state?.trim().toLowerCase();
  return !!normalized && FAILED_TASK_STATES.has(normalized);
}

export function formatMinerUErrorForDisplay(error: unknown): string {
  const mineruError = asMinerUError(error);
  if (!mineruError) {
    return error instanceof Error ? error.message : String(error);
  }

  switch (mineruError.code) {
    case 'input_limit_exceeded':
      return mineruError.message;
    case 'config_missing_token':
      return '未配置 MinerU 在线 API Token。请先在设置中填写 researchSpace.explosion.mineru.apiToken。';
    case 'mode_unsupported':
      return mineruError.message;
    case 'api_auth_failed':
      return `${mineruError.message} 可打开设置后重新填写 Token。`;
    case 'api_quota_exceeded':
      return `${mineruError.message} 请检查 MinerU 账号额度后再重试。`;
    case 'api_rate_limited':
      return `${mineruError.message} 建议稍后重试，或适当降低并发使用频率。`;
    case 'upload_failed':
      return `${mineruError.message} 请检查网络、文件大小和签名上传地址是否仍有效。`;
    case 'download_failed':
      return `${mineruError.message} 请检查网络连接，并确认任务结果下载链接仍有效。`;
    case 'task_timeout':
      return `${mineruError.message} 可稍后重试，或适当增大 researchSpace.explosion.mineru.pollTimeoutMs。`;
    case 'output_missing':
      return `${mineruError.message} 请确认 MinerU 任务结果中是否包含 content_list.json / content_list_v2.json。`;
    default:
      return mineruError.message;
  }
}

function toErrorMessage(status: number, payload: unknown): string {
  const record = asRecord(payload);
  if (!record) {
    return `MinerU API error ${status}`;
  }
  const direct = readString(record, ['detail', 'message', 'msg', 'error', 'err_msg']);
  if (direct) {
    return `MinerU API error ${status}: ${direct}`;
  }
  const nested = readNestedString(payload, [
    ['detail', 'message'],
    ['error', 'message'],
    ['data', 'message'],
    ['data', 'err_msg'],
  ]);
  if (nested) {
    return `MinerU API error ${status}: ${nested}`;
  }
  return `MinerU API error ${status}`;
}

function extractApiData(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  if (!record) {
    throw new Error('MinerU 在线 API 返回了无法识别的响应。');
  }

  const code = record.code;
  if (typeof code === 'number' && code !== 0 && code !== 200) {
    const message = readString(record, ['message', 'msg', 'detail']) ?? readNestedString(payload, [['data', 'err_msg']]);
    throw new Error(message ?? `MinerU 在线 API 返回错误码 ${code}`);
  }

  const data = asRecord(record.data);
  if (data) {
    return data;
  }
  return record;
}

async function parseApiResponse(resp: Response): Promise<unknown> {
  const contentType = resp.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return resp.json();
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildAuthHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

function ensureOnlineToken(config: MinerUConfig): string {
  if (!config.apiToken.trim()) {
    throw createMinerUError('config_missing_token', '请先在设置中配置 MinerU 在线 API Token。');
  }
  return config.apiToken.trim();
}

function getSourceDisplayName(source: string): string {
  if (isHttpUrl(source)) {
    try {
      const url = new URL(source);
      return path.basename(url.pathname) || url.hostname || 'remote-pdf';
    } catch {
      return 'remote-pdf';
    }
  }
  return path.basename(source);
}

function ensureSupportedSource(source: string): void {
  const displayName = getSourceDisplayName(source);
  if (!getExplosionSourceTypeFromPath(displayName)) {
    throw createMinerUError('unsupported_file', `MinerU 当前仅支持 PDF / DOCX / PPTX / XLS / XLSX / 图片文件: ${source}`);
  }
}

function buildOutputRoot(source: string, workspaceRoot: string, config: MinerUConfig): { rootDir: string; zipPath: string } {
  const sourceName = getSourceDisplayName(source);
  const sourceBase = sanitizePathSegment(path.basename(sourceName, path.extname(sourceName)));
  const session = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const rootDir = path.resolve(workspaceRoot, config.outputDir, sourceBase, session);
  return {
    rootDir,
    zipPath: path.join(rootDir, 'mineru-result.zip'),
  };
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function buildMinerUApiUrl(baseUrl: string, route = DEFAULT_LOCAL_ENDPOINT): string {
  const normalizedBase = (baseUrl || DEFAULT_ONLINE_API_BASE).trim().replace(/\/+$/, '');
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${normalizedBase}${normalizedRoute}`;
}

export function getMinerUConfig(): MinerUConfig {
  const config = vscode.workspace.getConfiguration('researchSpace.explosion');
  return {
    provider: 'mineru',
    apiMode: config.get<'precise' | 'agent' | 'local'>('mineru.apiMode', 'precise'),
    apiBaseUrl: config.get<string>('mineru.apiBaseUrl', DEFAULT_ONLINE_API_BASE),
    apiToken: config.get<string>('mineru.apiToken', ''),
    modelVersion: config.get<'pipeline' | 'vlm' | 'MinerU-HTML'>('mineru.modelVersion', 'pipeline'),
    pollIntervalMs: Math.max(500, config.get<number>('mineru.pollIntervalMs', DEFAULT_POLL_INTERVAL_MS)),
    pollTimeoutMs: Math.max(5000, config.get<number>('mineru.pollTimeoutMs', DEFAULT_POLL_TIMEOUT_MS)),
    localMode: config.get<'auto' | 'upload' | 'path'>('mineru.mode', 'auto'),
    localApiUrl: config.get<string>('mineru.apiUrl', DEFAULT_LOCAL_API_URL),
    maxUnits: Math.max(0, config.get<number>('maxUnits', 200)),
    attachOriginalFileNode: config.get<boolean>('attachOriginalFileNode', true),
    consumeAsGroup: config.get<boolean>('consumeAsGroup', true),
    outputDir: config.get<string>('outputDir', DEFAULT_OUTPUT_DIR),
  };
}

export async function checkMinerUHealth(baseUrl?: string): Promise<boolean> {
  const config = getMinerUConfig();
  if (config.apiMode === 'local') {
    const candidates = ['/health', '/docs', '/openapi.json'];
    for (const route of candidates) {
      try {
        const resp = await fetch(buildMinerUApiUrl(baseUrl ?? config.localApiUrl, route), {
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          return true;
        }
      } catch {
        // try next route
      }
    }
    return false;
  }

  if (!config.apiToken.trim()) {
    return false;
  }

  const candidates = ['/apiManage/docs', '/doc/docs/index_en'];
  for (const route of candidates) {
    try {
      const resp = await fetch(buildMinerUApiUrl(baseUrl ?? config.apiBaseUrl, route), {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        return true;
      }
    } catch {
      // try next route
    }
  }
  return false;
}

async function buildUploadBody(filePath: string): Promise<FormData> {
  const buffer = await fs.readFile(filePath);
  const form = new FormData();
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xls': 'application/vnd.ms-excel',
    '.xlt': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xltx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
    '.xltm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  const mimeType = mimeByExt[ext] ?? 'application/octet-stream';
  form.append('file', new Blob([buffer], { type: mimeType }), path.basename(filePath));
  return form;
}

async function parsePdfViaLocalApi(filePath: string, config: MinerUConfig): Promise<MinerUParseResponse> {
  const endpoint = buildMinerUApiUrl(config.localApiUrl);
  const requestMode = config.localMode === 'path' ? 'path' : 'upload';

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: requestMode === 'path' ? { 'Content-Type': 'application/json' } : undefined,
      body: requestMode === 'path'
        ? JSON.stringify({ file_path: path.resolve(filePath) })
        : await buildUploadBody(filePath),
    });
  } catch (error) {
    throw wrapTransportError('api_error', '无法连接本地 MinerU 服务。', error);
  }

  const payload = await parseApiResponse(response);
  if (!response.ok) {
    throw classifyApiError(response.status, payload, '本地 MinerU 服务调用失败。');
  }

  const record = asRecord(payload) ?? {};
  const outputDir = normalizePath(
    readString(record, ['output_dir', 'outputDir', 'result_dir', 'dir']) ??
    readNestedString(payload, [
      ['data', 'output_dir'],
      ['data', 'outputDir'],
      ['data', 'result_dir'],
      ['result', 'output_dir'],
      ['result', 'outputDir'],
    ]),
  );
  const manifestPath = readString(record, [
    'manifest_path',
    'manifestPath',
    'content_list_v2_path',
    'content_list_path',
  ]) ?? readNestedString(payload, [
    ['data', 'manifest_path'],
    ['data', 'manifestPath'],
    ['data', 'content_list_v2_path'],
    ['data', 'content_list_path'],
    ['result', 'manifest_path'],
    ['result', 'content_list_v2_path'],
  ]);
  const markdownPath = readString(record, [
    'markdown_path',
    'markdownPath',
    'md_path',
    'full_md_path',
  ]) ?? readNestedString(payload, [
    ['data', 'markdown_path'],
    ['data', 'markdownPath'],
    ['result', 'markdown_path'],
    ['result', 'markdownPath'],
  ]);

  return {
    requestMode,
    endpoint,
    outputDir,
    manifestPath,
    markdownPath,
    raw: payload,
  };
}

async function createPreciseBatchUpload(filePath: string, config: MinerUConfig): Promise<{
  batchId: string;
  uploadUrl: string;
  endpoint: string;
  raw: unknown;
}> {
  const token = ensureOnlineToken(config);
  const endpoint = buildMinerUApiUrl(config.apiBaseUrl, '/api/v4/file-urls/batch');
  const payloadBody = {
    enable_formula: true,
    enable_table: true,
    language: 'auto',
    model_version: config.modelVersion,
    files: [
      {
        name: path.basename(filePath),
        is_ocr: true,
        data_id: randomUUID(),
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payloadBody),
  }).catch(error => {
    throw wrapTransportError('api_error', '无法连接 MinerU 在线 API。', error);
  });
  const payload = await parseApiResponse(response);
  if (!response.ok) {
    throw classifyApiError(response.status, payload, 'MinerU 在线任务创建失败。');
  }

  const data = extractApiData(payload);
  const batchId = readString(data, ['batch_id', 'batchId']);
  const fileUrls = asArray(data.file_urls).map(item =>
    typeof item === 'string'
      ? item
      : readString(asRecord(item) ?? {}, ['upload_url', 'url', 'file_url']),
  ).filter((value): value is string => !!value);

  if (!batchId || fileUrls.length === 0) {
    throw new Error('MinerU 在线 API 未返回有效的 batch_id 或签名上传地址。');
  }

  return {
    batchId,
    uploadUrl: fileUrls[0],
    endpoint,
    raw: payload,
  };
}

async function createPreciseTaskByUrl(fileUrl: string, config: MinerUConfig): Promise<{
  taskId: string;
  endpoint: string;
  raw: unknown;
}> {
  const token = ensureOnlineToken(config);
  const endpoint = buildMinerUApiUrl(config.apiBaseUrl, '/api/v4/extract/task');
  const payloadBody = {
    url: fileUrl,
    is_ocr: true,
    enable_formula: true,
    enable_table: true,
    language: 'auto',
    model_version: config.modelVersion,
    data_id: randomUUID(),
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payloadBody),
  }).catch(error => {
    throw wrapTransportError('api_error', '无法连接 MinerU 在线 API。', error);
  });
  const payload = await parseApiResponse(response);
  if (!response.ok) {
    throw classifyApiError(response.status, payload, 'MinerU 在线任务创建失败。');
  }

  const data = extractApiData(payload);
  const taskId = readString(data, ['task_id', 'taskId', 'id']);
  if (!taskId) {
    throw createMinerUError('api_error', 'MinerU 在线 API 未返回有效的 task_id。');
  }

  return {
    taskId,
    endpoint,
    raw: payload,
  };
}

async function uploadFileToSignedUrl(uploadUrl: string, filePath: string): Promise<void> {
  const buffer = await fs.readFile(filePath);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: buffer,
  }).catch(error => {
    throw wrapTransportError('upload_failed', 'MinerU 文件上传失败。', error);
  });
  if (!response.ok) {
    const payload = await parseApiResponse(response);
    throw createMinerUError(
      'upload_failed',
      buildErrorMessage('MinerU 文件上传失败。', trimMessage(toErrorMessage(response.status, payload).replace(/^MinerU API error \d+:\s*/, '').replace(/^MinerU API error \d+$/, ''))),
      { status: response.status },
    );
  }
}

function resolvePreciseBatchResult(payload: unknown, expectedFileName: string): {
  state?: string;
  fullZipUrl?: string;
  markdownUrl?: string;
  errorMessage?: string;
} {
  const data = extractApiData(payload);
  const resultCandidates = [
    ...asArray(data.extract_result),
    ...asArray(data.results),
    data.result,
  ].map(item => asRecord(item)).filter((item): item is Record<string, unknown> => !!item);

  const matched = resultCandidates.find(item => {
    const fileName = readString(item, ['file_name', 'filename', 'name']);
    return fileName === expectedFileName;
  }) ?? resultCandidates[0] ?? data;

  return {
    state: readString(matched, ['state', 'status']),
    fullZipUrl: readString(matched, ['full_zip_url', 'zip_url', 'result_zip_url']),
    markdownUrl: readString(matched, ['markdown_url', 'full_md_url']),
    errorMessage: readString(matched, ['err_msg', 'message', 'msg', 'error']),
  };
}

async function pollPreciseBatchResult(batchId: string, fileName: string, config: MinerUConfig): Promise<{
  fullZipUrl: string;
  raw: unknown;
}> {
  const token = ensureOnlineToken(config);
  const endpoint = buildMinerUApiUrl(config.apiBaseUrl, `/api/v4/extract-results/batch/${batchId}`);
  const deadlineAt = Date.now() + config.pollTimeoutMs;

  const queryOnce = async (): Promise<{ fullZipUrl: string; raw: unknown } | null> => {
    const response = await fetch(endpoint, {
      headers: buildAuthHeaders(token),
    }).catch(error => {
      throw wrapTransportError('api_error', '轮询 MinerU 在线任务结果失败。', error);
    });
    const payload = await parseApiResponse(response);
    if (!response.ok) {
      throw classifyApiError(response.status, payload, '轮询 MinerU 在线任务结果失败。');
    }

    const result = resolvePreciseBatchResult(payload, fileName);
    if (result.fullZipUrl && !isMinerUTaskFailedState(result.state)) {
      return { fullZipUrl: result.fullZipUrl, raw: payload };
    }
    if (isMinerUTaskFailedState(result.state)) {
      throw createMinerUError('task_failed', result.errorMessage ?? 'MinerU 在线解析任务失败。', {
        detail: result.errorMessage,
      });
    }
    return null;
  };

  while (Date.now() < deadlineAt) {
    const completed = await queryOnce();
    if (completed) {
      return completed;
    }
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(config.pollIntervalMs, remainingMs)));
  }

  const completed = await queryOnce();
  if (completed) {
    return completed;
  }

  throw createMinerUError('task_timeout', 'MinerU 在线解析任务超时。');
}

async function pollPreciseTaskResult(taskId: string, config: MinerUConfig): Promise<{
  fullZipUrl: string;
  raw: unknown;
}> {
  const token = ensureOnlineToken(config);
  const endpoint = buildMinerUApiUrl(config.apiBaseUrl, `/api/v4/extract/task/${taskId}`);
  const deadlineAt = Date.now() + config.pollTimeoutMs;

  const queryOnce = async (): Promise<{ fullZipUrl: string; raw: unknown } | null> => {
    const response = await fetch(endpoint, {
      headers: buildAuthHeaders(token),
    }).catch(error => {
      throw wrapTransportError('api_error', '轮询 MinerU 在线任务结果失败。', error);
    });
    const payload = await parseApiResponse(response);
    if (!response.ok) {
      throw classifyApiError(response.status, payload, '轮询 MinerU 在线任务结果失败。');
    }

    const data = extractApiData(payload);
    const state = readString(data, ['state', 'status']);
    const fullZipUrl = readString(data, ['full_zip_url', 'zip_url', 'result_zip_url']);
    const errorMessage = readString(data, ['err_msg', 'message', 'msg', 'error']);

    if (fullZipUrl && !isMinerUTaskFailedState(state)) {
      return { fullZipUrl, raw: payload };
    }
    if (isMinerUTaskFailedState(state)) {
      throw createMinerUError('task_failed', errorMessage ?? 'MinerU 在线解析任务失败。', {
        detail: errorMessage,
      });
    }
    return null;
  };

  while (Date.now() < deadlineAt) {
    const completed = await queryOnce();
    if (completed) {
      return completed;
    }
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(config.pollIntervalMs, remainingMs)));
  }

  const completed = await queryOnce();
  if (completed) {
    return completed;
  }

  throw createMinerUError('task_timeout', 'MinerU 在线解析任务超时。');
}

async function downloadResultZip(zipUrl: string, zipPath: string): Promise<void> {
  const response = await fetch(zipUrl).catch(error => {
    throw wrapTransportError('download_failed', '下载 MinerU 解析结果失败。', error);
  });
  const payload = response.ok ? undefined : await parseApiResponse(response);
  if (!response.ok) {
    throw createMinerUError(
      'download_failed',
      buildErrorMessage('下载 MinerU 解析结果失败。', trimMessage(toErrorMessage(response.status, payload).replace(/^MinerU API error \d+:\s*/, '').replace(/^MinerU API error \d+$/, ''))),
      { status: response.status },
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await ensureDir(path.dirname(zipPath));
  await fs.writeFile(zipPath, buffer);
}

async function extractZipToDir(zipPath: string, outputDir: string): Promise<void> {
  await ensureDir(outputDir);

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err: Error | null, zipFile: any) => {
      if (err || !zipFile) {
        reject(err ?? new Error(`Failed to open zip: ${zipPath}`));
        return;
      }

      zipFile.readEntry();
      zipFile.on('entry', (entry: any) => {
        const normalizedName = path.normalize(entry.fileName).replace(/^(\.\.(\/|\\|$))+/, '');
        const targetPath = path.join(outputDir, normalizedName);
        if (/\/$/.test(entry.fileName)) {
          ensureDir(targetPath).then(() => zipFile.readEntry(), reject);
          return;
        }

        ensureDir(path.dirname(targetPath))
          .then(() => new Promise<void>((entryResolve, entryReject) => {
            zipFile.openReadStream(entry, (streamErr: Error | null, stream: any) => {
              if (streamErr || !stream) {
                entryReject(streamErr ?? new Error(`Failed to read zip entry: ${entry.fileName}`));
                return;
              }
              const out = createWriteStream(targetPath);
              stream.on('error', entryReject);
              out.on('error', entryReject);
              out.on('close', () => entryResolve());
              stream.pipe(out);
            });
          }))
          .then(() => zipFile.readEntry(), reject);
      });
      zipFile.on('end', resolve);
      zipFile.on('error', reject);
    });
  });
}

async function findFileRecursively(rootDir: string, matcher: (name: string) => boolean): Promise<string | undefined> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFileRecursively(absPath, matcher);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (matcher(entry.name)) {
      return absPath;
    }
  }
  return undefined;
}

async function parsePdfViaPreciseOnline(filePath: string, workspaceRoot: string, config: MinerUConfig): Promise<MinerUParseResponse> {
  const { batchId, uploadUrl, endpoint, raw: submitRaw } = await createPreciseBatchUpload(filePath, config);
  await uploadFileToSignedUrl(uploadUrl, filePath);
  const { fullZipUrl, raw: pollRaw } = await pollPreciseBatchResult(batchId, path.basename(filePath), config);

  const { rootDir, zipPath } = buildOutputRoot(filePath, workspaceRoot, config);
  await downloadResultZip(fullZipUrl, zipPath);
  await extractZipToDir(zipPath, rootDir);

  const manifestPath = await findFileRecursively(rootDir, name =>
    name === 'content_list_v2.json' ||
    name === 'content_list.json' ||
    /content_list\.json$/i.test(name),
  );
  const markdownPath = await findFileRecursively(rootDir, name =>
    name === 'full.md' || /\.md$/i.test(name),
  );

  if (!manifestPath) {
    throw createMinerUError('output_missing', 'MinerU 在线任务已完成，但结果 Zip 中未找到 manifest。');
  }

  return {
    requestMode: 'precise-batch-upload',
    endpoint,
    outputDir: rootDir,
    manifestPath,
    markdownPath,
    raw: {
      submit: submitRaw,
      poll: pollRaw,
      fullZipUrl,
      batchId,
    },
  };
}

async function parsePdfViaPreciseOnlineUrl(fileUrl: string, workspaceRoot: string, config: MinerUConfig): Promise<MinerUParseResponse> {
  const { taskId, endpoint, raw: submitRaw } = await createPreciseTaskByUrl(fileUrl, config);
  const { fullZipUrl, raw: pollRaw } = await pollPreciseTaskResult(taskId, config);

  const { rootDir, zipPath } = buildOutputRoot(fileUrl, workspaceRoot, config);
  await downloadResultZip(fullZipUrl, zipPath);
  await extractZipToDir(zipPath, rootDir);

  const manifestPath = await findFileRecursively(rootDir, name =>
    name === 'content_list_v2.json' ||
    name === 'content_list.json' ||
    /content_list\.json$/i.test(name),
  );
  const markdownPath = await findFileRecursively(rootDir, name =>
    name === 'full.md' || /\.md$/i.test(name),
  );

  if (!manifestPath) {
    throw createMinerUError('output_missing', 'MinerU 在线任务已完成，但结果 Zip 中未找到 manifest。');
  }

  return {
    requestMode: 'precise-task-url',
    endpoint,
    outputDir: rootDir,
    manifestPath,
    markdownPath,
    raw: {
      submit: submitRaw,
      poll: pollRaw,
      fullZipUrl,
      taskId,
    },
  };
}

export async function parsePdfViaMinerU(filePath: string, workspaceRoot: string): Promise<MinerUParseResponse> {
  return parseDocumentViaMinerU(filePath, workspaceRoot);
}

export async function parseDocumentViaMinerU(filePath: string, workspaceRoot: string): Promise<MinerUParseResponse> {
  ensureSupportedSource(filePath);
  const config = getMinerUConfig();
  if (config.apiMode === 'agent') {
    throw createMinerUError('mode_unsupported', 'MinerU Agent 轻量 API 暂未接入 Research Space 的多模态爆炸主链，请先将 apiMode 设为 precise。');
  }
  if (config.apiMode === 'local') {
    if (isHttpUrl(filePath)) {
      throw createMinerUError('mode_unsupported', '本地 MinerU fallback 暂不支持远程 PDF URL，请先使用 precise 在线模式。');
    }
    return parsePdfViaLocalApi(filePath, config);
  }
  if (isHttpUrl(filePath)) {
    return parsePdfViaPreciseOnlineUrl(filePath, workspaceRoot, config);
  }
  return parsePdfViaPreciseOnline(filePath, workspaceRoot, config);
}

export async function readMinerUResultManifest(targetPath: string): Promise<{
  manifestPath: string;
  outputDir: string;
  manifest: unknown;
}> {
  const stat = await fs.stat(targetPath);
  const manifestPath = stat.isDirectory()
    ? await resolveManifestFileFromDir(targetPath)
    : targetPath;
  const manifestRaw = await fs.readFile(manifestPath, 'utf8');
  return {
    manifestPath,
    outputDir: path.dirname(manifestPath),
    manifest: JSON.parse(manifestRaw),
  };
}

async function resolveManifestFileFromDir(dirPath: string): Promise<string> {
  const directCandidates = [
    path.join(dirPath, 'content_list_v2.json'),
    path.join(dirPath, 'content_list.json'),
  ];
  for (const candidate of directCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  const nested = await findFileRecursively(dirPath, name =>
    name === 'content_list_v2.json' ||
    name === 'content_list.json' ||
    /content_list\.json$/i.test(name),
  );
  if (nested) {
    return nested;
  }

  throw createMinerUError('output_missing', `MinerU manifest not found in ${dirPath}`);
}
