import * as vscode from 'vscode';
import type { ModelInfo, CustomProviderConfig } from '../core/canvas-model';
import type { AIModelCapabilities } from './model-capabilities';

// ── Content type passed to providers ───────────────────────────────────────

export interface AIContent {
  type: 'text' | 'image';
  title: string;
  // Text
  text?: string;
  contextText?: string;
  // Image
  localPath?: string;   // For Copilot: vscode.Uri.file(localPath)
  base64?: string;      // For Anthropic: base64 encoded
  mediaType?: string;
}

// ── Provider interface ──────────────────────────────────────────────────────

export interface AIProvider {
  id: string;
  name: string;
  supportsImages: boolean;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  resolveModel(modelOverride?: string): Promise<string | undefined>;
  getModelCapabilities?(modelOverride?: string): Promise<AIModelCapabilities | null>;
  stream(
    systemPrompt: string,
    contents: AIContent[],
    opts?: { signal?: AbortSignal; maxTokens?: number; model?: string }
  ): AsyncIterable<string>;
}

// ── Provider registry ───────────────────────────────────────────────────────

import { CopilotProvider } from './copilot';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';
import { OMLXProvider } from './omlx';
import { CustomProvider } from './custom';

const copilotProvider = new CopilotProvider();
const anthropicProvider = new AnthropicProvider();
const ollamaProvider = new OllamaProvider();
const omlxProvider = new OMLXProvider();

// Exported for CanvasEditorProvider to access by ID without going through getProvider fallback
export const PROVIDER_MAP: Record<string, AIProvider> = {
  copilot:   copilotProvider,
  anthropic: anthropicProvider,
  ollama:    ollamaProvider,
  omlx:      omlxProvider,
};

/** Build a CustomProvider from config, or return undefined if not found. */
function findCustomProvider(id: string): AIProvider | undefined {
  const configs = vscode.workspace
    .getConfiguration('researchSpace.ai')
    .get<CustomProviderConfig[]>('customProviders', []);
  const cfg = configs.find(c => c.id === id);
  if (!cfg) { return undefined; }
  return new CustomProvider({ ...cfg });
}

export async function getProvider(preferredId?: string): Promise<AIProvider> {
  const config = vscode.workspace.getConfiguration('researchSpace.ai');
  // Per-node override takes priority; 'auto' or undefined falls back to global setting
  const pref = (preferredId && preferredId !== 'auto')
    ? preferredId
    : config.get<string>('provider', 'copilot');

  const staticProviders: AIProvider[] = [copilotProvider, anthropicProvider, ollamaProvider, omlxProvider];

  // If a specific provider was requested (not auto), try it first and skip fallback
  if (preferredId && preferredId !== 'auto') {
    // Check static providers first
    const staticP = staticProviders.find(p => p.id === pref);
    if (staticP) {
      if (await staticP.isAvailable()) { return staticP; }
      throw new Error(
        `Requested provider "${staticP.name}" is not available. ` +
        `Check your API key / connection, or set the node to "Auto".`
      );
    }
    // Check custom providers
    const customP = findCustomProvider(pref);
    if (customP) {
      if (await customP.isAvailable()) { return customP; }
      throw new Error(
        `Requested provider "${customP.name}" is not available. ` +
        `Check your API key and Base URL in Settings.`
      );
    }
    throw new Error(`Unknown provider "${pref}". Please check Settings.`);
  }

  // Auto mode: try preferred first, then fall through the rest
  const preferred = staticProviders.find(p => p.id === pref) ?? findCustomProvider(pref);
  const rest = staticProviders.filter(p => p.id !== pref);
  const ordered: AIProvider[] = preferred ? [preferred, ...rest] : rest;

  for (const p of ordered) {
    if (await p.isAvailable()) { return p; }
  }
  throw new Error(
    'No AI provider available. Please configure Anthropic / Ollama / oMLX in Settings, or install GitHub Copilot.'
  );
}

/** Get a provider by exact ID, including custom providers. For requestModels use. */
export function getProviderById(id: string): AIProvider | undefined {
  return PROVIDER_MAP[id] ?? findCustomProvider(id);
}
