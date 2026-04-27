import * as vscode from 'vscode';
import { Buffer } from 'node:buffer';
import type { CanvasEdge, CanvasFile, CanvasNode } from '../../core/canvas-model';
import {
  buildDoubaoPredictionsEndpoint,
  buildOpenAIImagesEndpoint,
  normalizeOpenAIImageModel,
  normalizeOpenAIImageSize,
} from '../../core/aihubmix-image-models';
import type { AIContent } from '../provider';
import { extractPredictionImageCandidates, persistGeneratedImages } from './image-results';

export interface ImageRunSuccess {
  outputNodes: CanvasNode[];
  outputEdges: CanvasEdge[];
  outputContents: AIContent[];
}

export interface ImageExecutionCanvasAdapters {
  calcOutputPosition: (
    nodeId: string,
    fnNode: CanvasNode,
    outSize: { width: number; height: number },
    canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
  ) => { x: number; y: number };
  buildOutputMeta: (
    nodeId: string,
    fnNode: CanvasNode,
    canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
    extra?: CanvasNode['meta'],
  ) => CanvasNode['meta'];
  appendOutputToCanvas: (
    canvas: Pick<CanvasFile, 'nodes' | 'edges'>,
    nodeId: string,
    outNode: CanvasNode,
  ) => CanvasEdge[];
}

export function asImageDataUrl(content: AIContent): string {
  if (content.type !== 'image' || !content.base64 || !content.mediaType) {
    throw new Error('图像输入缺少可用的 base64 或 mediaType');
  }
  return `data:${content.mediaType};base64,${content.base64}`;
}

export function normalizeOpenAIImageCount(value: unknown): number {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed)) { return 1; }
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

export function normalizeEnumParam<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const raw = String(value ?? '').trim().toLowerCase();
  return allowed.includes(raw as T) ? raw as T : fallback;
}

export function buildOpenAIImageGenerationRequestBody(args: {
  params: Record<string, unknown>;
  prompt: string;
  model: string;
}): Record<string, unknown> {
  return {
    model: normalizeOpenAIImageModel(args.model),
    prompt: args.prompt,
    size: normalizeOpenAIImageSize(args.params['size'] as string | undefined),
    n: normalizeOpenAIImageCount(args.params['n']),
    quality: normalizeEnumParam(args.params['quality'], ['high', 'medium', 'low', 'auto'], 'high'),
    moderation: normalizeEnumParam(args.params['moderation'], ['low', 'auto'], 'low'),
    background: normalizeEnumParam(args.params['background'], ['auto', 'transparent', 'opaque'], 'auto'),
    output_format: normalizeEnumParam(args.params['output_format'], ['png', 'jpeg', 'webp'], 'png'),
  };
}

function normalizeErrorText(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function appendOptionalFormValue(formData: FormData, key: string, value: unknown): void {
  const normalized = normalizeErrorText(value);
  if (normalized) {
    formData.append(key, normalized);
  }
}

function buildOpenAIImageEditFormData(args: {
  params: Record<string, unknown>;
  prompt: string;
  model: string;
  imageContent: AIContent & { type: 'image' };
}): FormData {
  const formData = new FormData();
  const binary = Buffer.from(args.imageContent.base64 ?? '', 'base64');
  const blob = new Blob([binary], { type: args.imageContent.mediaType ?? 'image/png' });
  formData.append('model', normalizeOpenAIImageModel(args.model));
  formData.append('prompt', args.prompt);
  formData.append('image', blob, 'reference.png');
  formData.append('size', normalizeOpenAIImageSize(args.params['size'] as string | undefined));
  formData.append('quality', normalizeEnumParam(args.params['quality'], ['high', 'medium', 'low', 'auto'], 'high'));
  formData.append('background', normalizeEnumParam(args.params['background'], ['auto', 'transparent', 'opaque'], 'auto'));
  appendOptionalFormValue(formData, 'output_format', normalizeEnumParam(args.params['output_format'], ['png', 'jpeg', 'webp'], 'png'));
  return formData;
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
    return { message: normalizeErrorText(responseText) };
  }
  const error = payload?.error && typeof payload.error === 'object'
    ? payload.error
    : payload;
  const message = normalizeErrorText(error?.message ?? payload?.message);
  const code = normalizeErrorText(error?.code ?? payload?.code);
  const type = normalizeErrorText(error?.type ?? payload?.type);
  const requestId = message?.match(/request ID\s+([a-f0-9-]+)/i)?.[1];
  const tid = message?.match(/\(tid:\s*([^)]+)\)/i)?.[1];
  return { message, code, type, requestId, tid };
}

export function formatAihubmixImageHttpError(args: {
  label: string;
  status: number;
  statusText?: string;
  responseText: string;
}): string {
  const parsed = parseAihubmixErrorBody(args.responseText);
  const code = parsed.code?.toLowerCase();
  const type = parsed.type?.toLowerCase();
  const message = parsed.message ?? normalizeErrorText(args.statusText) ?? 'Request failed';
  const requestMeta = [
    parsed.requestId ? `请求 ID：${parsed.requestId}` : '',
    parsed.tid ? `tid：${parsed.tid}` : '',
  ].filter(Boolean).join('；');
  const suffix = requestMeta ? `（${requestMeta}）` : '';

  if (args.status === 403 && code === 'insufficient_user_quota') {
    return 'AIHubMix 额度不足：当前 API token quota 已耗尽，请前往 AIHubMix 控制台检查配额或余额后重试。';
  }

  if (
    /safety system|content safety|policy|rejected/i.test(message)
    || /safety|policy|content_filter/.test(`${code ?? ''} ${type ?? ''}`)
  ) {
    return `${args.label} 请求被安全系统拒绝：请调整图像描述或参考图，避免可能触发安全策略的内容后重试。${suffix}`;
  }

  return `${args.label} API error ${args.status}: ${message}`;
}

function readErrorCause(error: unknown): { code?: string; message?: string } {
  const cause = (error as { cause?: unknown })?.cause as { code?: unknown; message?: unknown } | undefined;
  return {
    code: normalizeErrorText(cause?.code),
    message: normalizeErrorText(cause?.message),
  };
}

export function formatAihubmixImageNetworkError(label: string, error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Cancelled';
  }
  const cause = readErrorCause(error);
  const message = error instanceof Error
    ? normalizeErrorText(error.message)
    : normalizeErrorText(error);
  const detail = [cause.code, cause.message]
    .filter(Boolean)
    .join('：');
  const suffix = detail || message;
  return `${label} 网络请求失败：已连接网络也可能发生该问题，常见原因是 AIHubMix / 上游模型服务连接超时、DNS / 代理 / TLS 连接被中断，或图像生成耗时较长导致连接被重置。请稍后重试，或切换 Gemini / Doubao 模型验证服务是否可用。${suffix ? `（${suffix}）` : ''}`;
}

async function fetchImageApi(label: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new Error(formatAihubmixImageNetworkError(label, error));
  }
}

async function throwImageHttpError(label: string, response: Response): Promise<never> {
  const responseText = await response.text();
  throw new Error(formatAihubmixImageHttpError({
    label,
    status: response.status,
    statusText: response.statusText,
    responseText,
  }));
}

async function persistPredictionPayload(args: {
  nodeId: string;
  fnNode: CanvasNode;
  canvasUri: vscode.Uri;
  filePrefix: string;
  titlePrefix: string;
  model: string;
  payload: unknown;
  adapters: ImageExecutionCanvasAdapters;
}): Promise<ImageRunSuccess> {
  return persistGeneratedImages({
    nodeId: args.nodeId,
    fnNode: args.fnNode,
    canvasUri: args.canvasUri,
    filePrefix: args.filePrefix,
    titlePrefix: args.titlePrefix,
    candidates: extractPredictionImageCandidates(args.payload),
    model: args.model,
    calcOutputPosition: args.adapters.calcOutputPosition,
    buildOutputMeta: args.adapters.buildOutputMeta,
    appendOutputToCanvas: args.adapters.appendOutputToCanvas,
  });
}

function extractGeminiInlineImage(payload: unknown, fallbackError: string): { dataUrl: string } {
  const data = payload as {
    candidates?: {
      content?: {
        parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[];
      };
    }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find(part => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error(fallbackError);
  }
  const mimeType = imagePart.inlineData.mimeType ?? 'image/png';
  return { dataUrl: `data:${mimeType};base64,${imagePart.inlineData.data}` };
}

export function buildGeminiImageEndpoint(model: string): string {
  return `https://aihubmix.com/gemini/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export async function requestGeminiImageGeneration(args: {
  nodeId: string;
  fnNode: CanvasNode;
  prompt: string;
  model: string;
  aspectRatio: string;
  canvasUri: vscode.Uri;
  apiKey: string;
  signal: AbortSignal;
  adapters: ImageExecutionCanvasAdapters;
}): Promise<ImageRunSuccess> {
  const response = await fetchImageApi('Gemini Image', buildGeminiImageEndpoint(args.model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': args.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: args.aspectRatio, imageSize: '1K' },
      },
    }),
    signal: args.signal,
  });
  if (!response.ok) {
    await throwImageHttpError('Gemini Image', response);
  }
  return persistGeneratedImages({
    nodeId: args.nodeId,
    fnNode: args.fnNode,
    canvasUri: args.canvasUri,
    filePrefix: 'image-gen',
    titlePrefix: 'Image',
    candidates: [extractGeminiInlineImage(await response.json() as unknown, 'Gemini 图像生成未返回图像数据')],
    model: args.model,
    calcOutputPosition: args.adapters.calcOutputPosition,
    buildOutputMeta: args.adapters.buildOutputMeta,
    appendOutputToCanvas: args.adapters.appendOutputToCanvas,
  });
}

export async function requestGeminiImageEdit(args: {
  nodeId: string;
  fnNode: CanvasNode;
  prompt: string;
  model: string;
  aspectRatio: string;
  imageContent: AIContent & { type: 'image' };
  canvasUri: vscode.Uri;
  apiKey: string;
  signal: AbortSignal;
  adapters: ImageExecutionCanvasAdapters;
}): Promise<ImageRunSuccess> {
  const response = await fetchImageApi('Gemini Image Edit', buildGeminiImageEndpoint(args.model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': args.apiKey,
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: args.imageContent.mediaType, data: args.imageContent.base64 } },
          { text: args.prompt },
        ],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: args.aspectRatio, imageSize: '1K' },
      },
    }),
    signal: args.signal,
  });
  if (!response.ok) {
    await throwImageHttpError('Gemini Image Edit', response);
  }
  return persistGeneratedImages({
    nodeId: args.nodeId,
    fnNode: args.fnNode,
    canvasUri: args.canvasUri,
    filePrefix: 'image-edit',
    titlePrefix: 'Edited Image',
    candidates: [extractGeminiInlineImage(await response.json() as unknown, 'Gemini 图像编辑未返回图像数据')],
    model: args.model,
    calcOutputPosition: args.adapters.calcOutputPosition,
    buildOutputMeta: args.adapters.buildOutputMeta,
    appendOutputToCanvas: args.adapters.appendOutputToCanvas,
  });
}

export async function requestOpenAIImageGeneration(args: {
  nodeId: string;
  fnNode: CanvasNode;
  params: Record<string, unknown>;
  prompt: string;
  model: string;
  canvasUri: vscode.Uri;
  apiKey: string;
  signal: AbortSignal;
  adapters: ImageExecutionCanvasAdapters;
}): Promise<ImageRunSuccess> {
  const response = await fetchImageApi('GPT Image', buildOpenAIImagesEndpoint('generations'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(buildOpenAIImageGenerationRequestBody({
      params: args.params,
      prompt: args.prompt,
      model: args.model,
    })),
    signal: args.signal,
  });
  if (!response.ok) {
    await throwImageHttpError('GPT Image', response);
  }
  return persistPredictionPayload({
    nodeId: args.nodeId,
    fnNode: args.fnNode,
    canvasUri: args.canvasUri,
    filePrefix: 'gpt-image',
    titlePrefix: 'GPT Image',
    model: normalizeOpenAIImageModel(args.model),
    payload: await response.json() as unknown,
    adapters: args.adapters,
  });
}

export async function requestOpenAIImageEdit(args: {
  nodeId: string;
  fnNode: CanvasNode;
  params: Record<string, unknown>;
  prompt: string;
  model: string;
  imageContent: AIContent & { type: 'image' };
  canvasUri: vscode.Uri;
  apiKey: string;
  signal: AbortSignal;
  adapters: ImageExecutionCanvasAdapters;
}): Promise<ImageRunSuccess> {
  const response = await fetchImageApi('GPT Image Edit', buildOpenAIImagesEndpoint('edits'), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${args.apiKey}`,
    },
    body: buildOpenAIImageEditFormData({
      params: args.params,
      prompt: args.prompt,
      model: args.model,
      imageContent: args.imageContent,
    }),
    signal: args.signal,
  });
  if (!response.ok) {
    await throwImageHttpError('GPT Image Edit', response);
  }
  return persistPredictionPayload({
    nodeId: args.nodeId,
    fnNode: args.fnNode,
    canvasUri: args.canvasUri,
    filePrefix: 'gpt-image-edit',
    titlePrefix: 'Edited GPT Image',
    model: normalizeOpenAIImageModel(args.model),
    payload: await response.json() as unknown,
    adapters: args.adapters,
  });
}

export async function requestDoubaoImageGeneration(args: {
  nodeId: string;
  fnNode: CanvasNode;
  prompt: string;
  model: string;
  size: string;
  watermark: boolean;
  webSearch: boolean;
  canvasUri: vscode.Uri;
  apiKey: string;
  signal: AbortSignal;
  adapters: ImageExecutionCanvasAdapters;
}): Promise<ImageRunSuccess> {
  const response = await fetchImageApi('Doubao Image', buildDoubaoPredictionsEndpoint(args.model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      input: {
        prompt: args.prompt,
        size: args.size,
        sequential_image_generation: 'disabled',
        stream: false,
        response_format: 'url',
        watermark: args.watermark,
        ...(args.webSearch ? { tools: [{ type: 'web_search' }] } : {}),
      },
    }),
    signal: args.signal,
  });
  if (!response.ok) {
    await throwImageHttpError('Doubao Image', response);
  }
  return persistPredictionPayload({
    nodeId: args.nodeId,
    fnNode: args.fnNode,
    canvasUri: args.canvasUri,
    filePrefix: 'image-gen',
    titlePrefix: 'Image',
    model: args.model,
    payload: await response.json() as unknown,
    adapters: args.adapters,
  });
}

export async function requestDoubaoImageGroupOutput(args: {
  nodeId: string;
  fnNode: CanvasNode;
  prompt: string;
  model: string;
  size: string;
  maxImages: number;
  watermark: boolean;
  canvasUri: vscode.Uri;
  apiKey: string;
  signal: AbortSignal;
  adapters: ImageExecutionCanvasAdapters;
}): Promise<ImageRunSuccess> {
  const response = await fetchImageApi('Doubao Group Image', buildDoubaoPredictionsEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      input: {
        model: args.model,
        prompt: args.prompt,
        size: args.size,
        sequential_image_generation: 'auto',
        sequential_image_generation_options: { max_images: args.maxImages },
        stream: false,
        response_format: 'url',
        watermark: args.watermark,
      },
    }),
    signal: args.signal,
  });
  if (!response.ok) {
    await throwImageHttpError('Doubao Group Image', response);
  }
  return persistPredictionPayload({
    nodeId: args.nodeId,
    fnNode: args.fnNode,
    canvasUri: args.canvasUri,
    filePrefix: 'image-group',
    titlePrefix: 'Group Image',
    model: args.model,
    payload: await response.json() as unknown,
    adapters: args.adapters,
  });
}

export async function requestDoubaoImageEdit(args: {
  nodeId: string;
  fnNode: CanvasNode;
  prompt: string;
  model: string;
  imageContent: AIContent & { type: 'image' };
  size: string;
  watermark: boolean;
  canvasUri: vscode.Uri;
  apiKey: string;
  signal: AbortSignal;
  adapters: ImageExecutionCanvasAdapters;
}): Promise<ImageRunSuccess> {
  const response = await fetchImageApi('Doubao Image Edit', buildDoubaoPredictionsEndpoint(args.model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      input: {
        image: asImageDataUrl(args.imageContent),
        prompt: args.prompt,
        size: args.size,
        sequential_image_generation: 'disabled',
        stream: false,
        response_format: 'url',
        watermark: args.watermark,
      },
    }),
    signal: args.signal,
  });
  if (!response.ok) {
    await throwImageHttpError('Doubao Image Edit', response);
  }
  return persistPredictionPayload({
    nodeId: args.nodeId,
    fnNode: args.fnNode,
    canvasUri: args.canvasUri,
    filePrefix: 'image-edit',
    titlePrefix: 'Edited Image',
    model: args.model,
    payload: await response.json() as unknown,
    adapters: args.adapters,
  });
}

export async function requestDoubaoImageFusion(args: {
  nodeId: string;
  fnNode: CanvasNode;
  prompt: string;
  model: string;
  imageContents: Array<AIContent & { type: 'image' }>;
  size: string;
  watermark: boolean;
  canvasUri: vscode.Uri;
  apiKey: string;
  signal: AbortSignal;
  adapters: ImageExecutionCanvasAdapters;
}): Promise<ImageRunSuccess> {
  const response = await fetchImageApi('Doubao Image Fusion', buildDoubaoPredictionsEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      input: {
        model: args.model,
        prompt: args.prompt,
        image: args.imageContents.map(asImageDataUrl),
        sequential_image_generation: 'disabled',
        size: args.size,
        stream: false,
        response_format: 'url',
        watermark: args.watermark,
      },
    }),
    signal: args.signal,
  });
  if (!response.ok) {
    await throwImageHttpError('Doubao Image Fusion', response);
  }
  return persistPredictionPayload({
    nodeId: args.nodeId,
    fnNode: args.fnNode,
    canvasUri: args.canvasUri,
    filePrefix: 'image-fusion',
    titlePrefix: 'Fusion Image',
    model: args.model,
    payload: await response.json() as unknown,
    adapters: args.adapters,
  });
}
