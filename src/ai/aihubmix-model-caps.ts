interface AihubmixModelRecord {
  model_id?: unknown;
  max_output?: unknown;
  context_length?: unknown;
}

interface AihubmixModelsResponse {
  data?: AihubmixModelRecord[];
}

export interface AihubmixModelLimits {
  modelId: string;
  maxOutput?: number;
  contextLength?: number;
}

const AIHUBMIX_MODELS_API = 'https://aihubmix.com/api/v1/models?type=llm';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedAt = 0;
let cachedModels: AihubmixModelLimits[] | null = null;
let inflight: Promise<AihubmixModelLimits[]> | null = null;

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return undefined;
}

function normalizeLookupCandidates(model: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) { return; }
    seen.add(trimmed);
    out.push(trimmed);
  };

  push(model);
  push(model.replace(/-think$/i, ''));
  push(model.replace(/-search$/i, ''));
  push(model.replace(/-(high|low)$/i, ''));
  return out;
}

export function isAihubmixBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return /(^|\.)aihubmix\.com$/i.test(url.hostname);
  } catch {
    return /aihubmix\.com/i.test(baseUrl);
  }
}

async function fetchAllAihubmixModels(): Promise<AihubmixModelLimits[]> {
  const now = Date.now();
  if (cachedModels && now - cachedAt < CACHE_TTL_MS) {
    return cachedModels;
  }
  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    const resp = await fetch(AIHUBMIX_MODELS_API, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      throw new Error(`AIHubMix Models API error ${resp.status}`);
    }

    const payload = await resp.json() as AihubmixModelsResponse;
    const models: AihubmixModelLimits[] = [];
    if (Array.isArray(payload.data)) {
      for (const item of payload.data) {
        const modelId = typeof item.model_id === 'string' ? item.model_id : '';
        if (!modelId) { continue; }
        models.push({
          modelId,
          maxOutput: parsePositiveInt(item.max_output),
          contextLength: parsePositiveInt(item.context_length),
        });
      }
    }

    cachedModels = models;
    cachedAt = Date.now();
    inflight = null;
    return models;
  })().catch(err => {
    inflight = null;
    throw err;
  });

  return inflight ?? [];
}

export async function getAihubmixModelLimits(model: string): Promise<AihubmixModelLimits | null> {
  const candidates = normalizeLookupCandidates(model);
  if (candidates.length === 0) { return null; }

  try {
    const models = await fetchAllAihubmixModels();
    for (const candidate of candidates) {
      const exact = models.find(item => item.modelId === candidate);
      if (exact) { return exact; }
    }
    for (const candidate of candidates) {
      const fuzzy = models.find(item => item.modelId.includes(candidate));
      if (fuzzy) { return fuzzy; }
    }
  } catch {
    return null;
  }

  return null;
}
