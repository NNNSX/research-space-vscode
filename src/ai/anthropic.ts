import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIContent } from './provider';
import type { ModelInfo } from '../core/canvas-model';
import type { AIModelCapabilities } from './model-capabilities';

// Static fallback used when API key is absent or the list endpoint fails
const ANTHROPIC_STATIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6',    name: 'Claude Opus 4.6',    description: 'Most capable' },
  { id: 'claude-sonnet-4-6',  name: 'Claude Sonnet 4.6',  description: 'Balanced performance' },
  { id: 'claude-haiku-4-5',   name: 'Claude Haiku 4.5',   description: 'Fastest & most efficient' },
];

const ANTHROPIC_MODEL_CAP_HINTS: Array<{
  pattern: RegExp;
  maxOutputTokens?: number;
  contextWindowTokens?: number;
}> = [
  { pattern: /claude-opus-4-6/i, maxOutputTokens: 128_000, contextWindowTokens: 1_000_000 },
  { pattern: /claude-sonnet-4-6/i, maxOutputTokens: 64_000, contextWindowTokens: 1_000_000 },
  { pattern: /claude-opus-4-5/i, maxOutputTokens: 64_000, contextWindowTokens: 200_000 },
  { pattern: /claude-sonnet-4-5/i, maxOutputTokens: 64_000, contextWindowTokens: 200_000 },
  { pattern: /claude-haiku-4-5/i, maxOutputTokens: 64_000, contextWindowTokens: 200_000 },
  { pattern: /claude-opus-4(?:[-.]|$)|claude-opus-4-1/i, maxOutputTokens: 32_000, contextWindowTokens: 200_000 },
  { pattern: /claude-sonnet-4(?:[-.]|$)|claude-sonnet-4-5|claude-3-7-sonnet/i, maxOutputTokens: 64_000, contextWindowTokens: 200_000 },
  { pattern: /claude-3-5-sonnet/i, maxOutputTokens: 8_192, contextWindowTokens: 200_000 },
  { pattern: /claude-haiku-4(?:[-.]|$)|claude-3-5-haiku/i, maxOutputTokens: 8_192, contextWindowTokens: 200_000 },
  { pattern: /claude-3-haiku/i, maxOutputTokens: 4_096, contextWindowTokens: 200_000 },
];

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic Claude';
  readonly supportsImages = true;

  private get apiKey(): string {
    return vscode.workspace
      .getConfiguration('researchSpace.ai')
      .get<string>('anthropicApiKey', '');
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.trim().length > 0;
  }

  async listModels(): Promise<ModelInfo[]> {
    const key = this.apiKey.trim();
    if (!key) { return ANTHROPIC_STATIC_MODELS; }

    try {
      const resp = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) { return ANTHROPIC_STATIC_MODELS; }
      const data = await resp.json() as { data?: { id: string; display_name?: string }[] };
      if (!Array.isArray(data.data) || data.data.length === 0) {
        return ANTHROPIC_STATIC_MODELS;
      }
      return data.data.map(m => ({
        id: m.id,
        name: m.display_name ?? m.id,
      }));
    } catch {
      return ANTHROPIC_STATIC_MODELS;
    }
  }

  async resolveModel(modelOverride?: string): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('researchSpace.ai');
    const configured = config.get<string>('anthropicModel', 'claude-sonnet-4-6');
    return (modelOverride && modelOverride !== 'auto')
      ? modelOverride
      : (configured || 'claude-sonnet-4-6');
  }

  async getModelCapabilities(modelOverride?: string): Promise<AIModelCapabilities | null> {
    const model = await this.resolveModel(modelOverride);
    if (!model) {
      return null;
    }

    const normalized = model.trim().toLowerCase();
    const matched = ANTHROPIC_MODEL_CAP_HINTS.find(item => item.pattern.test(normalized));
    if (!matched) {
      return null;
    }

    return {
      modelId: model,
      maxOutputTokens: matched.maxOutputTokens,
      contextWindowTokens: matched.contextWindowTokens,
      source: 'Anthropic models overview (family heuristic)',
    };
  }

  async *stream(
    systemPrompt: string,
    contents: AIContent[],
    opts?: { signal?: AbortSignal; maxTokens?: number; model?: string }
  ): AsyncIterable<string> {
    const config = vscode.workspace.getConfiguration('researchSpace.ai');
    const apiKey = this.apiKey;
    // Per-node model override > global setting
    const model = await this.resolveModel(opts?.model);

    if (!apiKey) {
      throw new Error('Anthropic API key is not configured');
    }

    const client = new Anthropic({ apiKey });

    // Build message content blocks
    const msgParts: Anthropic.MessageParam['content'] = [];
    for (const c of contents) {
      msgParts.push({ type: 'text', text: `[${c.title}]\n` });
      if (c.type === 'text' && c.text) {
        msgParts.push({ type: 'text', text: c.text + '\n\n' });
      } else if (c.type === 'image' && c.base64 && c.mediaType) {
        msgParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: c.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
            data: c.base64,
          },
        });
      }
    }

    const streamResp = client.messages.stream({
      model,
      max_tokens: opts?.maxTokens ?? 4096,
      system: systemPrompt || undefined,
      messages: [{ role: 'user', content: msgParts }],
    });

    opts?.signal?.addEventListener('abort', () => {
      streamResp.abort();
    });

    for await (const event of streamResp) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }
}
