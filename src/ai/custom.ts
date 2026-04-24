import { AIProvider, AIContent } from './provider';
import type { ModelInfo } from '../core/canvas-model';
import { getAihubmixModelLimits, isAihubmixBaseUrl, type AihubmixModelLimits } from './aihubmix-model-caps';
import type { AIModelCapabilities } from './model-capabilities';

interface OpenAIDeltaLike {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning_details?: unknown;
  tool_calls?: unknown;
  [key: string]: unknown;
}

interface OpenAIChunk {
  choices?: { delta?: OpenAIDeltaLike; message?: OpenAIDeltaLike; finish_reason?: string | null }[];
}

interface OpenAIModelsResponse {
  data?: { id: string; object?: string }[];
}

interface OpenAIErrorBody {
  error?: {
    message?: unknown;
    code?: unknown;
    type?: unknown;
  };
  message?: unknown;
  code?: unknown;
  type?: unknown;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAICompatibleRequestBody {
  model: string;
  stream: true;
  messages: { role: string; content: string | OpenAIContentPart[] }[];
  max_tokens?: number;
  max_completion_tokens?: number;
}

function collectTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return value ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => collectTextFragments(item));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directKeys = ['text', 'value', 'thinking', 'content', 'output_text'];
  for (const key of directKeys) {
    if (key in record) {
      const nested = collectTextFragments(record[key]);
      if (nested.length > 0) { return nested; }
    }
  }

  return [];
}

function buildRawFallback(args: {
  providerName: string;
  model: string;
  reasoningTexts: string[];
  rawChunks: string[];
  toolCallChunks: string[];
}): string {
  const sections: string[] = [
    `# ${args.providerName} 原始输出保留`,
    '',
    `- model: ${args.model}`,
    '- 说明: 未识别到标准文本输出格式，已优先保留原始返回，避免信息丢失。',
  ];

  if (args.reasoningTexts.length > 0) {
    sections.push(
      '',
      '## reasoning_content / thinking',
      args.reasoningTexts.join('\n'),
    );
  }

  if (args.toolCallChunks.length > 0) {
    sections.push(
      '',
      '## tool_calls',
      ...args.toolCallChunks.map(chunk => `\`\`\`json\n${chunk}\n\`\`\``),
    );
  }

  sections.push(
    '',
    '## raw_sse_chunks',
    ...args.rawChunks.map(chunk => `\`\`\`json\n${chunk}\n\`\`\``),
  );

  return sections.join('\n');
}

function normalizeErrorText(text: string): string | undefined {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function parseOpenAIErrorBody(text: string): { message?: string; code?: string; type?: string } {
  const fallback = normalizeErrorText(text);
  try {
    const payload = JSON.parse(text) as OpenAIErrorBody;
    const message = normalizeErrorText(
      typeof payload.error?.message === 'string'
        ? payload.error.message
        : typeof payload.message === 'string'
          ? payload.message
          : '',
    ) ?? fallback;
    const code = typeof payload.error?.code === 'string'
      ? payload.error.code
      : typeof payload.code === 'string'
        ? payload.code
        : undefined;
    const type = typeof payload.error?.type === 'string'
      ? payload.error.type
      : typeof payload.type === 'string'
        ? payload.type
        : undefined;
    return { message, code, type };
  } catch {
    return { message: fallback };
  }
}

function isAihubmixReasoningModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4-mini)(?:$|[-._])/i.test(model.trim());
}

export function buildCustomProviderRequestBody(args: {
  model: string;
  messages: { role: string; content: string | OpenAIContentPart[] }[];
  maxTokens?: number;
  isAihubmixProvider: boolean;
}): OpenAICompatibleRequestBody {
  const body: OpenAICompatibleRequestBody = {
    model: args.model,
    stream: true,
    messages: args.messages,
  };

  if (!args.maxTokens || args.maxTokens <= 0) {
    return body;
  }

  if (args.isAihubmixProvider && isAihubmixReasoningModel(args.model)) {
    body.max_completion_tokens = args.maxTokens;
    return body;
  }

  body.max_tokens = args.maxTokens;
  return body;
}

export function formatCustomProviderHttpError(args: {
  providerName: string;
  status: number;
  statusText: string;
  responseText: string;
  isAihubmixProvider: boolean;
}): string {
  const parsed = parseOpenAIErrorBody(args.responseText);

  if (
    args.isAihubmixProvider &&
    args.status === 403 &&
    parsed.code === 'insufficient_user_quota'
  ) {
    return 'AIHubMix 额度不足：当前 API token quota 已耗尽，请前往 AIHubMix 控制台检查配额或余额后重试。';
  }

  const suffix = parsed.message ?? normalizeErrorText(args.statusText) ?? 'Request failed';
  return `${args.providerName} API error ${args.status}: ${suffix}`;
}

export class CustomProvider implements AIProvider {
  readonly id: string;
  readonly name: string;
  readonly supportsImages = true;

  constructor(private readonly config: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    defaultModel?: string;
  }) {
    this.id = config.id;
    this.name = config.name;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey.trim() && !!this.config.baseUrl.trim();
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!await this.isAvailable()) { return []; }
    const base = this.config.baseUrl.replace(/\/$/, '');
    try {
      const resp = await fetch(`${base}/models`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) { return []; }
      const data = await resp.json() as OpenAIModelsResponse;
      if (!Array.isArray(data.data) || data.data.length === 0) { return []; }
      return data.data.map(m => ({ id: m.id, name: m.id }));
    } catch {
      return [];
    }
  }

  async resolveModel(modelOverride?: string): Promise<string | undefined> {
    return (modelOverride && modelOverride !== 'auto')
      ? modelOverride
      : (this.config.defaultModel || undefined);
  }

  isAihubmixProvider(): boolean {
    return isAihubmixBaseUrl(this.config.baseUrl);
  }

  async getAihubmixModelLimits(modelOverride?: string): Promise<AihubmixModelLimits | null> {
    const resolvedModel = await this.resolveModel(modelOverride);
    if (!resolvedModel || !this.isAihubmixProvider()) {
      return null;
    }
    return getAihubmixModelLimits(resolvedModel);
  }

  async getModelCapabilities(modelOverride?: string): Promise<AIModelCapabilities | null> {
    const limits = await this.getAihubmixModelLimits(modelOverride);
    if (!limits) {
      return null;
    }
    return {
      modelId: limits.modelId,
      maxOutputTokens: limits.maxOutput,
      contextWindowTokens: limits.contextLength,
      source: 'AIHubMix Models API',
    };
  }

  async *stream(
    systemPrompt: string,
    contents: AIContent[],
    opts?: { signal?: AbortSignal; maxTokens?: number; model?: string }
  ): AsyncIterable<string> {
    if (!await this.isAvailable()) {
      throw new Error(`Provider "${this.name}" is not configured (missing API key or base URL).`);
    }

    const resolvedModel = await this.resolveModel(opts?.model) || '';

    if (!resolvedModel) {
      throw new Error(`Provider "${this.name}": no model selected. Set a default model in Settings.`);
    }

    const base = this.config.baseUrl.replace(/\/$/, '');
    const isAihubmixProvider = this.isAihubmixProvider();
    const aihubmixLimits = await this.getAihubmixModelLimits(resolvedModel);
    const maxTokens = opts?.maxTokens ?? aihubmixLimits?.maxOutput;

    // Build messages array (OpenAI format)
    const hasImages = contents.some(c => c.type === 'image' && c.base64 && c.mediaType);

    const messages: { role: string; content: string | OpenAIContentPart[] }[] = [];
    if (systemPrompt) { messages.push({ role: 'system', content: systemPrompt }); }

    if (hasImages) {
      // Multimodal: use OpenAI content array format
      const parts: OpenAIContentPart[] = [];
      for (const c of contents) {
        if (c.type === 'text' && c.text) {
          parts.push({ type: 'text', text: `[${c.title}]\n${c.text}` });
        } else if (c.type === 'image' && c.base64 && c.mediaType) {
          parts.push({ type: 'text', text: c.contextText ? `[${c.title}]\n${c.contextText}` : `[${c.title}]` });
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${c.mediaType};base64,${c.base64}` },
          });
        } else if (c.type === 'image') {
          parts.push({ type: 'text', text: `[${c.title}] (image data unavailable)` });
        }
      }
      messages.push({ role: 'user', content: parts });
    } else {
      // Text-only: use simple string format for backward compatibility
      const userParts: string[] = [];
      for (const c of contents) {
        if (c.type === 'text' && c.text) {
          userParts.push(`[${c.title}]\n${c.text}`);
        }
      }
      messages.push({ role: 'user', content: userParts.join('\n\n') });
    }

    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: opts?.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(buildCustomProviderRequestBody({
        model: resolvedModel,
        messages,
        maxTokens,
        isAihubmixProvider,
      })),
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(formatCustomProviderHttpError({
        providerName: this.name,
        status: resp.status,
        statusText: resp.statusText,
        responseText: text,
        isAihubmixProvider,
      }));
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let sawVisibleText = false;
    const reasoningTexts: string[] = [];
    const rawChunks: string[] = [];
    const toolCallChunks: string[] = [];

    const processSseLine = (line: string): string[] => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') { return []; }
      if (!trimmed.startsWith('data: ')) { return []; }

      try {
        const chunk = JSON.parse(trimmed.slice(6)) as OpenAIChunk;
        rawChunks.push(JSON.stringify(chunk, null, 2));

        const choice = chunk.choices?.[0];
        const delta = choice?.delta ?? choice?.message;
        if (!delta) { return []; }

        const visibleTexts = collectTextFragments(delta.content);
        const reasoning = [
          ...collectTextFragments(delta.reasoning_content),
          ...collectTextFragments(delta.reasoning_details),
        ];
        if (reasoning.length > 0) {
          reasoningTexts.push(...reasoning);
        }

        if (delta.tool_calls !== undefined) {
          toolCallChunks.push(JSON.stringify(delta.tool_calls, null, 2));
        }

        if (visibleTexts.length > 0) {
          sawVisibleText = true;
        }
        return visibleTexts;
      } catch {
        rawChunks.push(trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed);
        return [];
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) { break; }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const texts = processSseLine(line);
        for (const text of texts) {
          yield text;
        }
      }
    }

    if (buf.trim()) {
      const texts = processSseLine(buf);
      for (const text of texts) {
        yield text;
      }
    }

    if (!sawVisibleText && rawChunks.length > 0) {
      yield buildRawFallback({
        providerName: this.name,
        model: resolvedModel,
        reasoningTexts,
        rawChunks,
        toolCallChunks,
      });
    }
  }
}
