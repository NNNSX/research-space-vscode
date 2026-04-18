import type { ModelInfo, SettingsSnapshot } from '../../../src/core/canvas-model';

const BUILTIN_DEFAULT_MODEL_IDS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  ollama: 'llama3.2',
};

type FavoriteModelMatcher = {
  matchers: RegExp[];
  reject?: RegExp[];
};

const TEXT_MODEL_REJECT_PATTERNS = [
  /image/i,
  /tts/i,
  /stt/i,
  /speech/i,
  /audio/i,
  /transcribe/i,
  /transcription/i,
  /embedding/i,
  /rerank/i,
  /moderation/i,
  /vision/i,
  /video/i,
  /live/i,
];

const GPT_FLAGSHIP_REJECT_PATTERNS = [
  /mini/i,
  /nano/i,
];

const DEFAULT_TEXT_FAVORITE_MATCHERS: FavoriteModelMatcher[] = [
  {
    matchers: [
      /^gpt-5\.4(?:$|[-._])/i,
      /^gpt-5(?:$|[-._])/i,
      /^gpt-4\.1(?:$|[-._])/i,
      /^gpt-4o(?:$|[-._])/i,
    ],
    reject: GPT_FLAGSHIP_REJECT_PATTERNS,
  },
  {
    matchers: [
      /^gpt-5\.4-mini(?:$|[-._])/i,
      /^gpt-5-mini(?:$|[-._])/i,
      /^gpt-4o-mini(?:$|[-._])/i,
    ],
  },
  {
    matchers: [
      /^gemini-3\.1-pro(?:$|[-._])/i,
      /^gemini-3-pro(?:$|[-._])/i,
      /^gemini-2\.5-pro(?:$|[-._])/i,
    ],
    reject: TEXT_MODEL_REJECT_PATTERNS,
  },
  {
    matchers: [
      /^gemini-3(?:\.1)?-flash(?:$|[-._])/i,
      /^gemini-2\.5-flash(?:$|[-._])/i,
    ],
    reject: TEXT_MODEL_REJECT_PATTERNS,
  },
  {
    matchers: [
      /^claude-sonnet-4-6(?:$|[-._])/i,
      /^claude-sonnet-4-5(?:$|[-._])/i,
      /^claude-sonnet-4(?:$|[-._])/i,
    ],
  },
  {
    matchers: [
      /^claude-opus-4-6(?:$|[-._])/i,
      /^claude-opus-4-5(?:$|[-._])/i,
      /^claude-opus-4(?:$|[-._])/i,
    ],
  },
];

const CLAUDE_TEXT_FAVORITE_MATCHERS = DEFAULT_TEXT_FAVORITE_MATCHERS.slice(4);
const AIHUBMIX_TEXT_FAVORITE_MATCHERS: FavoriteModelMatcher[] = [
  DEFAULT_TEXT_FAVORITE_MATCHERS[2], // Gemini Pro
  DEFAULT_TEXT_FAVORITE_MATCHERS[0], // GPT flagship
  DEFAULT_TEXT_FAVORITE_MATCHERS[4], // Claude Sonnet
];
const OPTIMISTIC_FAVORITE_MODEL_IDS: Record<string, string[]> = {
  copilot: [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gemini-3.1-pro-preview',
    'gemini-3-flash',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
  ],
  anthropic: [
    'claude-sonnet-4-6',
    'claude-opus-4-6',
  ],
};
const AIHUBMIX_OPTIMISTIC_FAVORITE_MODEL_IDS = [
  'gemini-3.1-pro-preview',
  'gpt-5.4',
  'claude-sonnet-4-6',
];

const BUILTIN_FAVORITE_MODEL_MATCHERS: Record<string, FavoriteModelMatcher[]> = {
  copilot: DEFAULT_TEXT_FAVORITE_MATCHERS,
  anthropic: CLAUDE_TEXT_FAVORITE_MATCHERS,
};

function pickModelsByMatchers(
  models: ModelInfo[] | undefined,
  matchers: FavoriteModelMatcher[],
): string[] {
  if (!models || models.length === 0) {
    return [];
  }

  const picked: string[] = [];
  const used = new Set<string>();

  for (const item of matchers) {
    const match = models.find(model => {
      if (used.has(model.id)) {
        return false;
      }
      if (item.reject?.some(pattern => pattern.test(model.id))) {
        return false;
      }
      return item.matchers.some(pattern => pattern.test(model.id));
    });
    if (match) {
      picked.push(match.id);
      used.add(match.id);
    }
  }

  return picked;
}

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

export function getFavoriteModelsForProvider(
  providerId: string,
  settings: SettingsSnapshot | null,
  models?: ModelInfo[]
): string[] {
  const configuredMap = settings?.favoriteModels;
  if (configuredMap && Object.prototype.hasOwnProperty.call(configuredMap, providerId)) {
    const configured = configuredMap[providerId] ?? [];
    if (configured.length > 0) {
      return configured;
    }
  }

  const modelIds = models?.map(model => model.id) ?? [];
  if (providerId === 'ollama') {
    const ollamaPreferred = models?.filter(model => /qwen|llama|gemma|mistral|deepseek/i.test(model.id)).slice(0, 6) ?? [];
    return ollamaPreferred.map(model => model.id);
  }

  if (providerId in BUILTIN_FAVORITE_MODEL_MATCHERS) {
    const matchers = BUILTIN_FAVORITE_MODEL_MATCHERS[providerId];
    const picked = pickModelsByMatchers(models, matchers);
    if (picked.length > 0) { return picked; }
  }

  const customProvider = settings?.customProviders?.find(cp => cp.id === providerId);
  const isAihubmix = !!customProvider && /aihubmix\.com/i.test(customProvider.baseUrl);
  if (isAihubmix) {
    const picked = pickModelsByMatchers(models, AIHUBMIX_TEXT_FAVORITE_MATCHERS);
    if (picked.length > 0) { return picked; }
    if (!models || models.length === 0) {
      return AIHUBMIX_OPTIMISTIC_FAVORITE_MODEL_IDS;
    }
  }

  if ((!models || models.length === 0) && OPTIMISTIC_FAVORITE_MODEL_IDS[providerId]) {
    return OPTIMISTIC_FAVORITE_MODEL_IDS[providerId];
  }

  if (customProvider?.defaultModel && modelIds.includes(customProvider.defaultModel)) {
    return [customProvider.defaultModel, ...modelIds.filter(id => id !== customProvider.defaultModel).slice(0, 5)];
  }

  return [];
}

export function orderModelsByIds(models: ModelInfo[], orderedIds: string[]): ModelInfo[] {
  if (orderedIds.length === 0) {
    return models;
  }
  const modelMap = new Map(models.map(model => [model.id, model] as const));
  const picked = orderedIds
    .map(id => modelMap.get(id))
    .filter((model): model is ModelInfo => !!model);
  const pickedIds = new Set(picked.map(model => model.id));
  const rest = models.filter(model => !pickedIds.has(model.id));
  return [...picked, ...rest];
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
