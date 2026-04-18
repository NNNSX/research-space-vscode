export interface AIModelCapabilities {
  modelId: string;
  maxOutputTokens?: number;
  contextWindowTokens?: number;
  source: string;
}

export interface AIBudgetSettings {
  maxOutputTokens?: number;
  maxContextTokens?: number;
}

export function parsePositiveLimit(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return undefined;
}

export function resolveEffectiveLimit(modelLimit?: number, configuredLimit?: number): number | undefined {
  if (modelLimit && configuredLimit) {
    return Math.min(modelLimit, configuredLimit);
  }
  return modelLimit ?? configuredLimit;
}
