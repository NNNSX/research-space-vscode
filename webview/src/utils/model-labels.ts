import type { ModelInfo, SettingsSnapshot } from '../../../src/core/canvas-model';

const BUILTIN_DEFAULT_MODEL_IDS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-5',
  ollama: 'llama3.2',
};

export function getProviderDisplayName(providerId: string, settings: SettingsSnapshot | null): string {
  if (providerId === 'copilot') { return 'GitHub Copilot'; }
  if (providerId === 'anthropic') { return 'Anthropic Claude'; }
  if (providerId === 'ollama') { return 'Ollama'; }
  const custom = settings?.customProviders?.find(cp => cp.id === providerId);
  return custom?.name ?? providerId;
}

export function getConfiguredProviderModelId(providerId: string, settings: SettingsSnapshot | null): string {
  if (!settings) { return ''; }
  if (providerId === 'copilot') { return settings.copilotModel ?? ''; }
  if (providerId === 'anthropic') { return settings.anthropicModel ?? BUILTIN_DEFAULT_MODEL_IDS.anthropic; }
  if (providerId === 'ollama') { return settings.ollamaModel ?? BUILTIN_DEFAULT_MODEL_IDS.ollama; }
  const custom = settings.customProviders?.find(cp => cp.id === providerId);
  return custom?.defaultModel ?? '';
}

export function formatModelLabel(modelId: string, models?: ModelInfo[]): string {
  if (!modelId) { return ''; }
  const matched = models?.find(model => model.id === modelId);
  return matched?.id ?? modelId;
}

export function getConcreteProviderModelId(
  providerId: string,
  settings: SettingsSnapshot | null,
  modelCache: Record<string, ModelInfo[]>
): string {
  const configured = getConfiguredProviderModelId(providerId, settings);
  if (configured) { return configured; }

  if (providerId === 'copilot') {
    return modelCache[providerId]?.[0]?.id ?? '';
  }

  if (providerId in BUILTIN_DEFAULT_MODEL_IDS) {
    return BUILTIN_DEFAULT_MODEL_IDS[providerId];
  }

  return '';
}

export function getConcreteProviderModelLabel(
  providerId: string,
  settings: SettingsSnapshot | null,
  modelCache: Record<string, ModelInfo[]>
): string {
  const modelId = getConcreteProviderModelId(providerId, settings, modelCache);
  return formatModelLabel(modelId, modelCache[providerId]);
}

export function getAutoModelLabel(
  providerId: string,
  settings: SettingsSnapshot | null,
  modelCache: Record<string, ModelInfo[]>,
  options?: { emptyStateText?: string }
): string {
  const concrete = getConcreteProviderModelLabel(providerId, settings, modelCache);
  if (concrete) {
    return `自动（当前使用 ${concrete}）`;
  }
  return options?.emptyStateText ?? '自动（当前未配置具体模型）';
}
