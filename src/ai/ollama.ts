import * as vscode from 'vscode';
import * as fs from 'fs';
import { AIProvider, AIContent } from './provider';
import type { ModelInfo } from '../core/canvas-model';
import type { AIModelCapabilities } from './model-capabilities';

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

interface OllamaTagsResponse {
  models?: { name: string; model?: string; details?: { family?: string } }[];
}

interface OllamaShowResponse {
  parameters?: string;
  model_info?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return undefined;
}

function parseOllamaParameterValue(parameters: string | undefined, key: string): number | undefined {
  if (!parameters) {
    return undefined;
  }
  const match = parameters.match(new RegExp(`(?:^|\\n)\\s*${key}\\s+(\\d+)`, 'i'));
  return parsePositiveInt(match?.[1]);
}

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (Local)';
  readonly supportsImages = true;  // multimodal models (llava, gemma3, etc.) support images

  private get baseUrl(): string {
    return vscode.workspace
      .getConfiguration('researchSpace.ai')
      .get<string>('ollamaBaseUrl', 'http://localhost:11434');
  }

  private get defaultModel(): string {
    return vscode.workspace
      .getConfiguration('researchSpace.ai')
      .get<string>('ollamaModel', 'llama3.2');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) { return []; }
      const data = await resp.json() as OllamaTagsResponse;
      if (!Array.isArray(data.models) || data.models.length === 0) { return []; }
      return data.models.map(m => ({
        id: m.model ?? m.name,
        name: m.name,
        description: m.details?.family ? `Family: ${m.details.family}` : undefined,
      }));
    } catch {
      return [];
    }
  }

  async resolveModel(modelOverride?: string): Promise<string | undefined> {
    return (modelOverride && modelOverride !== 'auto')
      ? modelOverride
      : (this.defaultModel || 'llama3.2');
  }

  async getModelCapabilities(modelOverride?: string): Promise<AIModelCapabilities | null> {
    const model = await this.resolveModel(modelOverride);
    if (!model) {
      return null;
    }

    try {
      const resp = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        return null;
      }
      const data = await resp.json() as OllamaShowResponse;
      const modelInfo = data.model_info ?? {};
      const contextLength = Object.entries(modelInfo).reduce<number | undefined>((found, [key, value]) => {
        if (found) { return found; }
        if (/context_length$/i.test(key) || /num_ctx$/i.test(key)) {
          return parsePositiveInt(value);
        }
        return undefined;
      }, undefined) ?? parseOllamaParameterValue(data.parameters, 'num_ctx');
      const numPredict = parseOllamaParameterValue(data.parameters, 'num_predict');

      return {
        modelId: model,
        maxOutputTokens: numPredict,
        contextWindowTokens: contextLength,
        source: 'Ollama /api/show',
      };
    } catch {
      return null;
    }
  }

  async *stream(
    systemPrompt: string,
    contents: AIContent[],
    opts?: { signal?: AbortSignal; maxTokens?: number; model?: string; think?: boolean }
  ): AsyncIterable<string> {
    // Per-node model override > global setting
    const model = await this.resolveModel(opts?.model);

    // Build messages array.
    // Ollama multimodal API: each message can have an optional `images` field
    // containing an array of base64-encoded strings (no data URI prefix).
    // Ref: https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion
    const messages: { role: string; content: string; images?: string[] }[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Group text and images together into a single user message so multimodal
    // models receive both the descriptive text and the image data in one turn.
    const textParts: string[] = [];
    const imageBase64List: string[] = [];

    for (const c of contents) {
      if (c.type === 'text' && c.text) {
        textParts.push(`[${c.title}]\n${c.text}`);
      } else if (c.type === 'image') {
        textParts.push(`[${c.title}]`);
        // Prefer pre-extracted base64 from content-extractor; fall back to reading the file.
        if (c.base64) {
          imageBase64List.push(c.base64);
        } else if (c.localPath) {
          try {
            const data = fs.readFileSync(c.localPath);
            imageBase64List.push(Buffer.from(data).toString('base64'));
          } catch {
            textParts.push('(image file could not be read)');
          }
        }
      }
    }

    const userMsg: { role: string; content: string; images?: string[] } = {
      role: 'user',
      content: textParts.join('\n\n'),
    };
    if (imageBase64List.length > 0) {
      userMsg.images = imageBase64List;
    }
    messages.push(userMsg);

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      signal: opts?.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        ...(opts?.think === false ? { think: false } : {}),
        messages,
        ...(opts?.maxTokens ? { options: { num_predict: opts.maxTokens } } : {}),
      }),
    });

    if (!resp.ok || !resp.body) {
      // Ollama returns JSON error body on failure: { "error": "..." }
      let errMsg = `Ollama request failed: ${resp.status} ${resp.statusText}`;
      try {
        const errBody = await resp.text();
        const errJson = JSON.parse(errBody) as { error?: string };
        if (errJson.error) { errMsg = `Ollama error: ${errJson.error}`; }
      } catch { /* ignore parse failures */ }
      throw new Error(errMsg);
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
        if (!line.trim()) { continue; }
        try {
          const chunk = JSON.parse(line) as OllamaChunk;
          if (chunk.error) {
            throw new Error(`Ollama error: ${chunk.error}`);
          }
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
          if (chunk.done) { return; }
        } catch (parseErr) {
          // Re-throw Ollama errors; ignore malformed lines
          if (parseErr instanceof Error && parseErr.message.startsWith('Ollama error:')) {
            throw parseErr;
          }
        }
      }
    }
  }
}
