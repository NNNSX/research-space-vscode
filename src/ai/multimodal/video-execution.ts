import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import type { AIContent } from '../provider';

export interface VideoProgress {
  phase: 'polling' | 'downloading';
  elapsedSeconds?: number;
  status?: string;
}

export interface VideoGenerationRequest {
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  seconds: string;
  imageContent?: AIContent & { type: 'image' };
  signal?: AbortSignal;
  pollIntervalMs?: number;
  onProgress?: (progress: VideoProgress) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface VideoGenerationResult {
  videoBytes: Buffer;
  model: string;
  jobId: string;
}

export function buildTextToVideoRequestBody(args: {
  model: string;
  prompt: string;
  size: string;
  seconds: string;
}): Record<string, unknown> {
  return {
    model: args.model,
    prompt: args.prompt,
    size: args.size,
    seconds: args.seconds,
  };
}

function normalizeText(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function parseAihubmixErrorBody(responseText: string): {
  message?: string;
  code?: string;
  type?: string;
  requestId?: string;
  tid?: string;
} {
  let payload: any;
  try {
    payload = JSON.parse(responseText);
  } catch {
    return { message: normalizeText(responseText) };
  }
  const error = payload?.error && typeof payload.error === 'object'
    ? payload.error
    : payload;
  const message = normalizeText(error?.message ?? payload?.message);
  const code = normalizeText(error?.code ?? payload?.code);
  const type = normalizeText(error?.type ?? payload?.type);
  const requestId = message?.match(/request ID\s+([a-f0-9-]+)/i)?.[1];
  const tid = message?.match(/\(tid:\s*([^)]+)\)/i)?.[1];
  return { message, code, type, requestId, tid };
}

export function formatAihubmixVideoHttpError(args: {
  label: string;
  status: number;
  statusText?: string;
  responseText: string;
}): string {
  const parsed = parseAihubmixErrorBody(args.responseText);
  const code = parsed.code?.toLowerCase();
  const message = parsed.message ?? normalizeText(args.statusText) ?? 'Request failed';
  const requestMeta = [
    parsed.requestId ? `请求 ID：${parsed.requestId}` : '',
    parsed.tid ? `tid：${parsed.tid}` : '',
  ].filter(Boolean).join('；');
  const suffix = requestMeta ? `（${requestMeta}）` : '';

  if (args.status === 403 && code === 'insufficient_user_quota') {
    return 'AIHubMix 额度不足：当前 API token quota 已耗尽，请前往 AIHubMix 控制台检查配额或余额后重试。';
  }

  if (args.status === 401 || /invalid.*key|unauthorized|authentication/.test(`${code ?? ''} ${message}`.toLowerCase())) {
    return `${args.label} 鉴权失败：请检查 AIHubMix API Key 是否正确、是否仍有效。${suffix}`;
  }

  return `${args.label} API error ${args.status}: ${message}${suffix}`;
}

function readErrorCause(error: unknown): { code?: string; message?: string } {
  const cause = (error as { cause?: unknown })?.cause as { code?: unknown; message?: unknown } | undefined;
  return {
    code: normalizeText(cause?.code),
    message: normalizeText(cause?.message),
  };
}

export function formatAihubmixVideoNetworkError(label: string, error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Cancelled';
  }
  const cause = readErrorCause(error);
  const message = error instanceof Error
    ? normalizeText(error.message)
    : normalizeText(error);
  const detail = [cause.code, cause.message]
    .filter(Boolean)
    .join('：');
  const suffix = detail || message;
  return `${label} 网络请求失败：已连接网络也可能发生该问题，常见原因是 AIHubMix / 上游视频模型服务连接超时、DNS / 代理 / TLS 连接被中断，或视频生成 / 下载耗时较长导致连接被重置。请稍后重试，或降低时长 / 分辨率后验证服务是否可用。${suffix ? `（${suffix}）` : ''}`;
}

async function fetchVideoApi(label: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(formatAihubmixVideoNetworkError(label, error));
  }
}

async function throwVideoHttpError(label: string, response: Response): Promise<never> {
  const responseText = await response.text();
  throw new Error(formatAihubmixVideoHttpError({
    label,
    status: response.status,
    statusText: response.statusText,
    responseText,
  }));
}

export function buildImageToVideoFormData(args: {
  model: string;
  prompt: string;
  size: string;
  seconds: string;
  imageContent: AIContent & { type: 'image' };
}): FormData {
  if (!args.imageContent.base64 || !args.imageContent.mediaType) {
    throw new Error('图生视频输入缺少可用的图像内容。');
  }

  const form = new FormData();
  form.set('model', args.model);
  form.set('size', args.size);
  form.set('seconds', args.seconds);
  if (args.prompt) {
    form.set('prompt', args.prompt);
  }

  const imageBytes = Buffer.from(args.imageContent.base64, 'base64');
  const ext = args.imageContent.mediaType.includes('jpeg') ? 'jpg' : 'png';
  const imageName = args.imageContent.localPath
    ? path.basename(args.imageContent.localPath)
    : `reference.${ext}`;
  form.set('input_reference', new File([imageBytes], imageName, { type: args.imageContent.mediaType }));
  return form;
}

async function submitVideoJob(args: VideoGenerationRequest): Promise<string> {
  const response = args.imageContent
    ? await fetchVideoApi('视频提交', 'https://aihubmix.com/v1/videos', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${args.apiKey}` },
        body: buildImageToVideoFormData({
          model: args.model,
          prompt: args.prompt,
          size: args.size,
          seconds: args.seconds,
          imageContent: args.imageContent,
        }),
        signal: args.signal,
      })
    : await fetchVideoApi('视频提交', 'https://aihubmix.com/v1/videos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${args.apiKey}`,
        },
        body: JSON.stringify(buildTextToVideoRequestBody(args)),
        signal: args.signal,
      });

  if (!response.ok) {
    await throwVideoHttpError('视频提交', response);
  }

  const submitData = await response.json() as { id?: string; task_id?: string };
  const jobId = normalizeText(submitData.id ?? submitData.task_id);
  if (!jobId) {
    throw new Error('视频接口没有返回任务 ID，请稍后重试。');
  }
  return jobId;
}

function isTerminalSuccessStatus(status: string | undefined): boolean {
  return ['succeeded', 'completed', 'success', 'done', 'finished'].includes(status ?? '');
}

function isTerminalFailureStatus(status: string | undefined): boolean {
  return ['failed', 'error', 'cancelled', 'canceled'].includes(status ?? '');
}

function extractVideoFailureReason(payload: any): string | undefined {
  const error = payload?.error && typeof payload.error === 'object'
    ? payload.error
    : undefined;
  return normalizeText(
    payload?.failure_reason ??
    payload?.failed_reason ??
    payload?.message ??
    error?.message ??
    payload?.status_message
  );
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) { return; }
  if (signal?.aborted) {
    throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function pollVideoJob(args: VideoGenerationRequest, jobId: string): Promise<void> {
  const now = args.now ?? Date.now;
  const sleep = args.sleep ?? ((ms: number) => defaultSleep(ms, args.signal));
  const startTime = now();
  const pollIntervalMs = args.pollIntervalMs ?? 15000;

  while (true) {
    if (args.signal?.aborted) {
      throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    }
    await sleep(pollIntervalMs);
    if (args.signal?.aborted) {
      throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    }

    const elapsedSeconds = Math.floor((now() - startTime) / 1000);
    const response = await fetchVideoApi('视频状态查询', `https://aihubmix.com/v1/videos/${jobId}`, {
      headers: { 'Authorization': `Bearer ${args.apiKey}` },
      signal: args.signal,
    });

    if (!response.ok) {
      await throwVideoHttpError('视频状态查询', response);
    }

    const pollData = await response.json() as { status?: string };
    const status = normalizeText(pollData.status)?.toLowerCase();
    args.onProgress?.({ phase: 'polling', elapsedSeconds, status });
    if (isTerminalSuccessStatus(status)) {
      return;
    }
    if (isTerminalFailureStatus(status)) {
      const reason = extractVideoFailureReason(pollData);
      throw new Error(`视频生成任务失败${reason ? `：${reason}` : '，服务端未返回具体原因。'}`);
    }
  }
}

async function downloadVideoContent(args: VideoGenerationRequest, jobId: string): Promise<Buffer> {
  args.onProgress?.({ phase: 'downloading' });
  const response = await fetchVideoApi('视频下载', `https://aihubmix.com/v1/videos/${jobId}/content`, {
    headers: { 'Authorization': `Bearer ${args.apiKey}` },
    signal: args.signal,
  });

  if (!response.ok) {
    await throwVideoHttpError('视频下载', response);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function requestVideoGeneration(args: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const jobId = await submitVideoJob(args);
  await pollVideoJob(args, jobId);
  const videoBytes = await downloadVideoContent(args, jobId);
  return {
    videoBytes,
    model: args.model,
    jobId,
  };
}
