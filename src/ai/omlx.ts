import * as vscode from 'vscode';
import { AIProvider, AIContent } from './provider';
import type { ModelInfo } from '../core/canvas-model';

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

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

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
  for (const key of ['text', 'value', 'thinking', 'content', 'output_text']) {
    if (key in record) {
      const nested = collectTextFragments(record[key]);
      if (nested.length > 0) { return nested; }
    }
  }
  return [];
}

export class OMLXProvider implements AIProvider {
  readonly id = 'omlx';
  readonly name = 'oMLX';
  readonly supportsImages = true;

  private get baseUrl(): string {
    return vscode.workspace
      .getConfiguration('researchSpace.ai')
      .get<string>('omlxBaseUrl', 'http://localhost:11433/v1');
  }

  private get apiKey(): string {
    return vscode.workspace
      .getConfiguration('researchSpace.ai')
      .get<string>('omlxApiKey', '');
  }

  private get defaultModel(): string {
    return vscode.workspace
      .getConfiguration('researchSpace.ai')
      .get<string>('omlxModel', '');
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = this.apiKey.trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl.replace(/\/$/, '')}/models`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const resp = await fetch(`${this.baseUrl.replace(/\/$/, '')}/models`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) { return []; }
      const data = await resp.json() as OpenAIModelsResponse;
      if (!Array.isArray(data.data) || data.data.length === 0) { return []; }
      return data.data.map(model => ({ id: model.id, name: model.id }));
    } catch {
      return [];
    }
  }

  async resolveModel(modelOverride?: string): Promise<string | undefined> {
    return (modelOverride && modelOverride !== 'auto')
      ? modelOverride
      : (this.defaultModel || undefined);
  }

  async *stream(
    systemPrompt: string,
    contents: AIContent[],
    opts?: { signal?: AbortSignal; maxTokens?: number; model?: string }
  ): AsyncIterable<string> {
    const model = await this.resolveModel(opts?.model);
    if (!model) {
      throw new Error('oMLX: no model selected. Set a default model in Settings.');
    }

    const hasImages = contents.some(c => c.type === 'image' && c.base64 && c.mediaType);
    const messages: { role: string; content: string | OpenAIContentPart[] }[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    if (hasImages) {
      const parts: OpenAIContentPart[] = [];
      for (const c of contents) {
        if (c.type === 'text' && c.text) {
          parts.push({ type: 'text', text: `[${c.title}]\n${c.text}` });
        } else if (c.type === 'image' && c.base64 && c.mediaType) {
          parts.push({ type: 'text', text: `[${c.title}]` });
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
      const userParts: string[] = [];
      for (const c of contents) {
        if (c.type === 'text' && c.text) {
          userParts.push(`[${c.title}]\n${c.text}`);
        }
      }
      messages.push({ role: 'user', content: userParts.join('\n\n') });
    }

    const resp = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: opts?.signal,
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model,
        stream: true,
        messages,
        ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`oMLX API error ${resp.status}: ${text.trim() || resp.statusText || 'Request failed'}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const processSseLine = (line: string): string[] => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) {
        return [];
      }
      try {
        const chunk = JSON.parse(trimmed.slice(6)) as OpenAIChunk;
        const choice = chunk.choices?.[0];
        const delta = choice?.delta ?? choice?.message;
        if (!delta) { return []; }
        return [
          ...collectTextFragments(delta.content),
          ...collectTextFragments(delta.reasoning_content),
          ...collectTextFragments(delta.reasoning_details),
        ];
      } catch {
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
  }
}
