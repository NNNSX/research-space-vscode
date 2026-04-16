import { AIProvider, AIContent } from './provider';
import type { ModelInfo } from '../core/canvas-model';

interface OpenAIChunk {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
}

interface OpenAIModelsResponse {
  data?: { id: string; object?: string }[];
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

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
      body: JSON.stringify({
        model: resolvedModel,
        stream: true,
        messages,
        ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`${this.name} API error ${resp.status}: ${text}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) { break; }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') { continue; }
        if (trimmed.startsWith('data: ')) {
          try {
            const chunk = JSON.parse(trimmed.slice(6)) as OpenAIChunk;
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) { yield content; }
          } catch { /* ignore malformed */ }
        }
      }
    }
  }
}
