export type PetCanvasEventType =
  | 'node_added'
  | 'node_deleted'
  | 'node_selected'
  | 'node_connected'
  | 'tool_run_started'
  | 'tool_run_completed'
  | 'tool_run_failed'
  | 'board_created'
  | 'mindmap_edited'
  | 'export_completed'
  | 'idle_timeout'
  | 'repeated_error'
  | 'long_session';

export type LegacyPetCanvasEventType = 'nodeAdded' | 'nodeDeleted' | 'aiDone' | 'aiError';
export type PetCanvasEventInput = PetCanvasEventType | LegacyPetCanvasEventType;
export type PetEventImportance = 'low' | 'medium' | 'high';
export type PetSuggestionActivity = 'off' | 'quiet' | 'balanced' | 'active';
export type PetSuggestionKind = 'mindmap_structure' | 'organize_outputs' | 'recover_error' | 'rest';

export interface PetCanvasEvent {
  id: string;
  type: PetCanvasEventType;
  createdAt: number;
  importance: PetEventImportance;
  nodeId?: string;
  nodeType?: string;
  title?: string;
}

export interface PetLocalSuggestion {
  kind: PetSuggestionKind;
  message: string;
  reason: string;
  importance: PetEventImportance;
  cooldownMs: number;
}

export interface PetLocalSuggestionInput {
  event: PetCanvasEvent;
  recentEvents: PetCanvasEvent[];
  now?: number;
  activity?: PetSuggestionActivity;
  mutedKinds?: Partial<Record<PetSuggestionKind, boolean>>;
  lastSuggestionByKind?: Partial<Record<PetSuggestionKind, number>>;
}

const LEGACY_EVENT_MAP: Record<LegacyPetCanvasEventType, PetCanvasEventType> = {
  nodeAdded: 'node_added',
  nodeDeleted: 'node_deleted',
  aiDone: 'tool_run_completed',
  aiError: 'tool_run_failed',
};

const IMPORTANCE_BY_EVENT: Record<PetCanvasEventType, PetEventImportance> = {
  node_added: 'low',
  node_deleted: 'low',
  node_selected: 'low',
  node_connected: 'low',
  tool_run_started: 'low',
  tool_run_completed: 'medium',
  tool_run_failed: 'high',
  board_created: 'medium',
  mindmap_edited: 'medium',
  export_completed: 'medium',
  idle_timeout: 'low',
  repeated_error: 'high',
  long_session: 'medium',
};

const ACTIVITY_COOLDOWN_MULTIPLIER: Record<PetSuggestionActivity, number> = {
  off: 999,
  quiet: 1.8,
  balanced: 1,
  active: 0.65,
};

const WINDOW_MS = 10 * 60_000;
const BASE_SUGGESTION_COOLDOWN_MS: Record<PetSuggestionKind, number> = {
  mindmap_structure: 12 * 60_000,
  organize_outputs: 10 * 60_000,
  recover_error: 4 * 60_000,
  rest: 30 * 60_000,
};

export function normalizePetCanvasEventType(type: PetCanvasEventInput): PetCanvasEventType {
  return (LEGACY_EVENT_MAP as Partial<Record<PetCanvasEventInput, PetCanvasEventType>>)[type] ?? type as PetCanvasEventType;
}

export function getPetEventImportance(type: PetCanvasEventInput): PetEventImportance {
  return IMPORTANCE_BY_EVENT[normalizePetCanvasEventType(type)];
}

export function createPetCanvasEvent(
  type: PetCanvasEventInput,
  meta: Omit<Partial<PetCanvasEvent>, 'id' | 'type' | 'createdAt' | 'importance'> = {},
  now = Date.now(),
): PetCanvasEvent {
  const normalizedType = normalizePetCanvasEventType(type);
  return {
    id: `${normalizedType}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    type: normalizedType,
    createdAt: now,
    importance: getPetEventImportance(normalizedType),
    ...meta,
  };
}

export function trimPetEventHistory(events: PetCanvasEvent[], now = Date.now(), maxAgeMs = 30 * 60_000): PetCanvasEvent[] {
  return events
    .filter(event => now - event.createdAt <= maxAgeMs)
    .slice(-40);
}

function countRecent(events: PetCanvasEvent[], type: PetCanvasEventType, now: number): number {
  return events.filter(event => event.type === type && now - event.createdAt <= WINDOW_MS).length;
}

function withActivityCooldown(kind: PetSuggestionKind, activity: PetSuggestionActivity): number {
  return Math.round(BASE_SUGGESTION_COOLDOWN_MS[kind] * ACTIVITY_COOLDOWN_MULTIPLIER[activity]);
}

function isSuggestionCoolingDown(
  kind: PetSuggestionKind,
  now: number,
  activity: PetSuggestionActivity,
  lastSuggestionByKind: Partial<Record<PetSuggestionKind, number>> = {},
): boolean {
  const last = lastSuggestionByKind[kind] ?? 0;
  return last > 0 && now - last < withActivityCooldown(kind, activity);
}

function buildSuggestion(
  kind: PetSuggestionKind,
  activity: PetSuggestionActivity,
  suggestion: Omit<PetLocalSuggestion, 'kind' | 'cooldownMs'>,
): PetLocalSuggestion {
  return {
    kind,
    cooldownMs: withActivityCooldown(kind, activity),
    ...suggestion,
  };
}

export function pickPetLocalSuggestion(input: PetLocalSuggestionInput): PetLocalSuggestion | null {
  const now = input.now ?? Date.now();
  const activity = input.activity ?? 'balanced';
  if (activity === 'off') { return null; }
  if (activity === 'quiet' && input.event.importance === 'low') { return null; }

  const recentEvents = trimPetEventHistory(input.recentEvents, now, WINDOW_MS);
  const mutedKinds = input.mutedKinds ?? {};
  const lastSuggestionByKind = input.lastSuggestionByKind ?? {};

  const canSuggest = (kind: PetSuggestionKind): boolean => {
    if (mutedKinds[kind]) { return false; }
    return !isSuggestionCoolingDown(kind, now, activity, lastSuggestionByKind);
  };

  const failedRuns = countRecent(recentEvents, 'tool_run_failed', now) + countRecent(recentEvents, 'repeated_error', now);
  if ((input.event.type === 'tool_run_failed' || input.event.type === 'repeated_error') && failedRuns >= 2 && canSuggest('recover_error')) {
    return buildSuggestion('recover_error', activity, {
      importance: 'high',
      reason: `最近 ${failedRuns} 次 AI 工具运行失败`,
      message: '这个工具连续遇到问题了，先检查服务商配置、网络或模型额度，再继续会更省时间。',
    });
  }

  const addedNodes = countRecent(recentEvents, 'node_added', now);
  if (input.event.type === 'node_added' && addedNodes >= 3 && canSuggest('mindmap_structure')) {
    return buildSuggestion('mindmap_structure', activity, {
      importance: 'medium',
      reason: `最近新增了 ${addedNodes} 个节点`,
      message: '我看到你收集了几份新材料，可以先建一个导图或画板，把问题、材料和结论分开。',
    });
  }

  const completedRuns = countRecent(recentEvents, 'tool_run_completed', now);
  if (input.event.type === 'tool_run_completed' && completedRuns >= 2 && canSuggest('organize_outputs')) {
    return buildSuggestion('organize_outputs', activity, {
      importance: 'medium',
      reason: `最近完成了 ${completedRuns} 次 AI 输出`,
      message: '已经有几份 AI 输出了，建议把关键结论收进笔记或导图，避免结果散在画布上。',
    });
  }

  if (input.event.type === 'long_session' && canSuggest('rest')) {
    return buildSuggestion('rest', activity, {
      importance: 'medium',
      reason: '检测到较长连续工作时段',
      message: '已经专注很久了，可以休息几分钟再回来，我会在画布边上等你。',
    });
  }

  return null;
}
