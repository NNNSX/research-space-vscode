import * as path from 'node:path';
import { Buffer } from 'node:buffer';

export interface TextToSpeechRequest {
  apiKey: string;
  inputText: string;
  model: string;
  voice: string;
  responseFormat: string;
  signal?: AbortSignal;
}

export interface TextToSpeechResult {
  audioBytes: Buffer;
  model: string;
  responseFormat: string;
}

export interface SpeechToTextRequest {
  apiKey: string;
  audioBytes: Buffer;
  filename: string;
  model: string;
  language?: string;
  responseFormat: string;
  signal?: AbortSignal;
}

export interface SpeechToTextResult {
  text: string;
  model: string;
  responseFormat: string;
}

export function buildTextToSpeechRequestBody(args: {
  inputText: string;
  model: string;
  voice: string;
  responseFormat: string;
}): Record<string, unknown> {
  return {
    model: args.model,
    input: args.inputText,
    voice: args.voice,
    response_format: args.responseFormat,
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

export function formatAihubmixAudioHttpError(args: {
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

export function formatAihubmixAudioNetworkError(label: string, error: unknown): string {
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
  return `${label} 网络请求失败：已连接网络也可能发生该问题，常见原因是 AIHubMix / 上游音频模型服务连接超时、DNS / 代理 / TLS 连接被中断，或音频文件较大导致请求超时。请稍后重试，或换用更短音频片段验证服务是否可用。${suffix ? `（${suffix}）` : ''}`;
}

async function fetchAudioApi(label: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(formatAihubmixAudioNetworkError(label, error));
  }
}

async function throwAudioHttpError(label: string, response: Response): Promise<never> {
  const responseText = await response.text();
  throw new Error(formatAihubmixAudioHttpError({
    label,
    status: response.status,
    statusText: response.statusText,
    responseText,
  }));
}

export async function requestTextToSpeech(args: TextToSpeechRequest): Promise<TextToSpeechResult> {
  const response = await fetchAudioApi('TTS', 'https://aihubmix.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(buildTextToSpeechRequestBody(args)),
    signal: args.signal,
  });

  if (!response.ok) {
    await throwAudioHttpError('TTS', response);
  }

  return {
    audioBytes: Buffer.from(await response.arrayBuffer()),
    model: args.model,
    responseFormat: args.responseFormat,
  };
}

export function buildSpeechToTextFormData(args: {
  audioBytes: Buffer;
  filename: string;
  model: string;
  language?: string;
  responseFormat: string;
}): FormData {
  const form = new FormData();
  form.set('file', new File([args.audioBytes], path.basename(args.filename)));
  form.set('model', args.model);
  form.set('response_format', args.responseFormat);
  const language = normalizeText(args.language);
  if (language) {
    form.set('language', language);
  }
  return form;
}

export async function requestSpeechToText(args: SpeechToTextRequest): Promise<SpeechToTextResult> {
  const response = await fetchAudioApi('STT', 'https://aihubmix.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${args.apiKey}` },
    body: buildSpeechToTextFormData(args),
    signal: args.signal,
  });

  if (!response.ok) {
    await throwAudioHttpError('STT', response);
  }

  let text: string;
  if (args.responseFormat === 'json' || args.responseFormat === 'verbose_json') {
    const json = await response.json() as { text?: string };
    text = json.text ?? '';
  } else {
    text = await response.text();
  }

  return {
    text,
    model: args.model,
    responseFormat: args.responseFormat,
  };
}
