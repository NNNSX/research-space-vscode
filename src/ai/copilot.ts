import * as vscode from 'vscode';
import * as fs from 'fs';
import { AIProvider, AIContent } from './provider';
import type { ModelInfo } from '../core/canvas-model';
import type { AIModelCapabilities } from './model-capabilities';

// Static fallback — vscode.lm API doesn't enumerate per-user model entitlements
const COPILOT_STATIC_MODELS: ModelInfo[] = [
  { id: 'gpt-4.1',           name: 'GPT-4.1',           description: 'OpenAI GPT-4.1' },
  { id: 'gpt-4o',            name: 'GPT-4o',            description: 'OpenAI GPT-4o' },
  { id: 'gpt-4o-mini',       name: 'GPT-4o Mini',       description: 'Faster & cheaper GPT-4o' },
  { id: 'o1',                name: 'o1',                description: 'OpenAI o1 reasoning' },
  { id: 'o1-mini',           name: 'o1 Mini',           description: 'Faster o1 reasoning' },
  { id: 'o3-mini',           name: 'o3 Mini',           description: 'OpenAI o3 Mini' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', description: 'Anthropic via Copilot' },
  { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  description: 'Fast Anthropic via Copilot' },
  { id: 'gemini-2.0-flash',  name: 'Gemini 2.0 Flash',  description: 'Google via Copilot' },
];

export class CopilotProvider implements AIProvider {
  readonly id = 'copilot';
  readonly name = 'GitHub Copilot';
  readonly supportsImages = true;

  async isAvailable(): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!await this.isAvailable()) { return []; }
    // Try to list dynamically via vscode.lm; fall back to static list
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length > 0) {
        return models.map(m => ({
          id: m.id,
          name: m.name ?? m.id,
          description: `${m.vendor ?? 'Copilot'} — ${m.family ?? ''}`.trim(),
        }));
      }
    } catch { /* fall through */ }
    return COPILOT_STATIC_MODELS;
  }

  async resolveModel(modelOverride?: string): Promise<string | undefined> {
    const globalModel = vscode.workspace
      .getConfiguration('researchSpace.ai')
      .get<string>('copilotModel', 'gpt-4.1');
    const preferredModel = (modelOverride && modelOverride !== 'auto')
      ? modelOverride
      : (globalModel || 'gpt-4.1');

    const selector: vscode.LanguageModelChatSelector = { vendor: 'copilot' };
    if (preferredModel) {
      (selector as Record<string, string>)['id'] = preferredModel;
    }

    let models = await vscode.lm.selectChatModels(selector);
    if (models.length === 0 && preferredModel) {
      models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    }
    if (models.length === 0) {
      throw new Error('No Copilot model available');
    }
    return models[0].id;
  }

  async getModelCapabilities(modelOverride?: string): Promise<AIModelCapabilities | null> {
    const modelId = await this.resolveModel(modelOverride).catch(() => modelOverride);
    if (!modelId) {
      return null;
    }
    return {
      modelId,
      source: 'VS Code language model API (capabilities unavailable)',
    };
  }

  async *stream(
    systemPrompt: string,
    contents: AIContent[],
    opts?: { signal?: AbortSignal; maxTokens?: number; model?: string }
  ): AsyncIterable<string> {
    const resolvedModel = await this.resolveModel(opts?.model);
    const selector: vscode.LanguageModelChatSelector = { vendor: 'copilot' };
    if (resolvedModel) { (selector as Record<string, string>)['id'] = resolvedModel; }

    const models = await vscode.lm.selectChatModels(selector);
    if (models.length === 0) {
      throw new Error('No Copilot model available');
    }
    const model = models[0];

    // Build message parts
    const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [];
    if (systemPrompt) {
      parts.push(new vscode.LanguageModelTextPart(systemPrompt + '\n\n'));
    }
    for (const c of contents) {
      const textHeader = c.type === 'image' && c.contextText
        ? `[${c.title}]\n${c.contextText}\n`
        : `[${c.title}]\n`;
      parts.push(new vscode.LanguageModelTextPart(textHeader));
      if (c.type === 'text' && c.text) {
        parts.push(new vscode.LanguageModelTextPart(c.text + '\n\n'));
      } else if (c.type === 'image' && c.localPath) {
        try {
          const data = fs.readFileSync(c.localPath);
          const ext  = c.localPath.split('.').pop()?.toLowerCase() ?? 'png';
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                     : ext === 'gif'  ? 'image/gif'
                     : ext === 'webp' ? 'image/webp'
                     : 'image/png';
          parts.push(vscode.LanguageModelDataPart.image(new Uint8Array(data), mime));
        } catch {
          // File unreadable — fall back to a text hint so the run still continues
          parts.push(new vscode.LanguageModelTextPart(`[Image file: ${c.localPath}]\n\n`));
        }
        parts.push(new vscode.LanguageModelTextPart('\n\n'));
      }
    }

    const messages = [vscode.LanguageModelChatMessage.User(parts)];
    const cancelToken = new vscode.CancellationTokenSource();
    opts?.signal?.addEventListener('abort', () => cancelToken.cancel());

    const response = await model.sendRequest(
      messages,
      {
        justification: 'Research Space AI analysis',
        ...(opts?.maxTokens ? {
          modelOptions: {
            max_tokens: opts.maxTokens,
            max_output_tokens: opts.maxTokens,
            max_completion_tokens: opts.maxTokens,
          },
        } : {}),
      },
      cancelToken.token
    );

    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        yield part.value;
      }
    }
  }
}
