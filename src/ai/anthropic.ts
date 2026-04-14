import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIContent } from './provider';
import type { ModelInfo } from '../core/canvas-model';

// Static fallback used when API key is absent or the list endpoint fails
const ANTHROPIC_STATIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-5',    name: 'Claude Opus 4.5',    description: 'Most capable' },
  { id: 'claude-sonnet-4-5',  name: 'Claude Sonnet 4.5',  description: 'Balanced performance' },
  { id: 'claude-haiku-4-5',   name: 'Claude Haiku 4.5',   description: 'Fastest & most efficient' },
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

  async *stream(
    systemPrompt: string,
    contents: AIContent[],
    opts?: { signal?: AbortSignal; maxTokens?: number; model?: string }
  ): AsyncIterable<string> {
    const config = vscode.workspace.getConfiguration('researchSpace.ai');
    const apiKey = this.apiKey;
    // Per-node model override > global setting
    const model = (opts?.model && opts.model !== 'auto')
      ? opts.model
      : config.get<string>('anthropicModel', 'claude-sonnet-4-5');

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
