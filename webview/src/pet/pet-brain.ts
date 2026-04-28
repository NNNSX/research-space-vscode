import type { PetLocalSuggestion, PetSuggestionKind } from './pet-event-policy';

export type PetSuggestedActionType = 'create_mindmap' | 'create_note' | 'open_ai_settings' | 'open_pet_settings';
export type PetActionRisk = 'low' | 'medium';
export type PetActionPermission = 'create' | 'open_panel';

export interface PetSuggestedAction {
  id: string;
  type: PetSuggestedActionType;
  label: string;
  confirmText: string;
  reason: string;
  risk: PetActionRisk;
  permission: PetActionPermission;
  payload?: Record<string, string>;
}

export interface PetSuggestionCard {
  id: string;
  kind: PetSuggestionKind;
  message: string;
  reason: string;
  preferenceHint?: string;
  actions: PetSuggestedAction[];
}

export interface PetBrainMemorySummary {
  profile?: {
    frequentNodeTypes?: string[];
    frequentTools?: string[];
    frequentScenes?: string[];
    suggestionStats?: {
      shown: number;
      accepted: number;
      later: number;
      muted: number;
    };
    suggestionActivity?: string;
    displayMode?: string;
  };
}

export interface PetBrainContext {
  memorySummary?: PetBrainMemorySummary | null;
  suggestionStats?: {
    shown: number;
    accepted: number;
    later: number;
    muted: number;
  };
}

interface PetPreferenceSignals {
  prefersMindmap: boolean;
  prefersNote: boolean;
  prefersQuiet: boolean;
  prefersCanvasFollow: boolean;
  acceptanceRate: number;
  mutedRate: number;
}

function normalizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(item => item.toLowerCase())
    : [];
}

function mergeStats(...stats: Array<PetBrainContext['suggestionStats'] | undefined>) {
  return stats.reduce((acc, stat) => ({
    shown: acc.shown + Math.max(0, stat?.shown ?? 0),
    accepted: acc.accepted + Math.max(0, stat?.accepted ?? 0),
    later: acc.later + Math.max(0, stat?.later ?? 0),
    muted: acc.muted + Math.max(0, stat?.muted ?? 0),
  }), { shown: 0, accepted: 0, later: 0, muted: 0 });
}

export function derivePetPreferenceSignals(context: PetBrainContext = {}): PetPreferenceSignals {
  const profile = context.memorySummary?.profile;
  const nodeTypes = normalizeList(profile?.frequentNodeTypes);
  const stats = mergeStats(profile?.suggestionStats, context.suggestionStats);
  const shown = Math.max(1, stats.shown);
  const acceptanceRate = stats.accepted / shown;
  const mutedRate = stats.muted / shown;
  const prefersMindmap = nodeTypes.some(type => type.includes('mindmap') || type.includes('mind_map') || type.includes('导图'));
  const prefersNote = nodeTypes.some(type => type.includes('note') || type.includes('markdown') || type.includes('笔记'));

  return {
    prefersMindmap,
    prefersNote,
    prefersQuiet: profile?.suggestionActivity === 'quiet' || (stats.shown >= 4 && (stats.later + stats.muted) > stats.accepted * 2),
    prefersCanvasFollow: profile?.displayMode === 'canvas-follow',
    acceptanceRate,
    mutedRate,
  };
}

function createMindmapAction(id: string, label: string, title: string, reason: string): PetSuggestedAction {
  return {
    id,
    type: 'create_mindmap',
    label,
    confirmText: `创建一个「${title}」思维导图？`,
    reason,
    risk: 'low',
    permission: 'create',
    payload: { title },
  };
}

function createNoteAction(id: string, label: string, title: string, reason: string): PetSuggestedAction {
  return {
    id,
    type: 'create_note',
    label,
    confirmText: `创建一个「${title}」笔记？`,
    reason,
    risk: 'low',
    permission: 'create',
    payload: { title },
  };
}

function orderStructureActions(actions: PetSuggestedAction[], signals: PetPreferenceSignals): PetSuggestedAction[] {
  if (signals.prefersNote && !signals.prefersMindmap) {
    return [...actions].sort((a, b) => Number(b.type === 'create_note') - Number(a.type === 'create_note'));
  }
  if (signals.prefersMindmap && !signals.prefersNote) {
    return [...actions].sort((a, b) => Number(b.type === 'create_mindmap') - Number(a.type === 'create_mindmap'));
  }
  return actions;
}

function buildPreferenceHint(signals: PetPreferenceSignals): string | undefined {
  if (signals.prefersQuiet) {
    return '我会按低打扰方式给建议：只给候选操作，不自动改动画布。';
  }
  if (signals.prefersCanvasFollow) {
    return '你常用全画布跟随模式，我会尽量把建议放在宠物旁边且避开画布主体。';
  }
  if (signals.acceptanceRate >= 0.5) {
    return '你之前较常采纳这类轻操作，我把最可能有用的操作放在前面。';
  }
  return undefined;
}

export function buildPetSuggestionCard(suggestion: PetLocalSuggestion, context: PetBrainContext = {}): PetSuggestionCard | null {
  const signals = derivePetPreferenceSignals(context);
  const base = {
    id: `${suggestion.kind}-${Date.now()}`,
    kind: suggestion.kind,
    message: suggestion.message,
    reason: suggestion.reason,
    preferenceHint: buildPreferenceHint(signals),
  };

  if (suggestion.kind === 'mindmap_structure') {
    const actions = orderStructureActions([
      createMindmapAction(
        'create-structure-mindmap',
        '新建导图',
        '结构梳理导图',
        '导图适合把材料、问题和支撑关系先搭成骨架。',
      ),
      createNoteAction(
        'create-material-note',
        '新建材料笔记',
        '材料要点整理',
        '笔记适合先把零散材料摘出来，后续再接导图或 AI 工具。',
      ),
    ], signals);

    return { ...base, actions };
  }

  if (suggestion.kind === 'organize_outputs') {
    const actions = orderStructureActions([
      createNoteAction(
        'create-summary-note',
        '新建整理笔记',
        '结论整理',
        '整理笔记能把多个 AI 输出压缩为用户自己的结论资产。',
      ),
      createMindmapAction(
        'create-output-mindmap',
        '新建结论导图',
        'AI 输出结论导图',
        '当输出之间有层级或并列关系时，导图比普通笔记更容易看清结构。',
      ),
    ], signals);

    return { ...base, actions };
  }

  if (suggestion.kind === 'recover_error') {
    return {
      ...base,
      actions: [{
        id: 'open-ai-settings',
        type: 'open_ai_settings',
        label: '打开 AI 设置',
        confirmText: '打开 AI 设置面板检查服务商、模型或额度配置？',
        reason: '连续失败通常与服务商配置、模型名、网络或额度有关。',
        risk: 'low',
        permission: 'open_panel',
      }],
    };
  }

  if (suggestion.kind === 'rest') {
    return {
      ...base,
      actions: [{
        id: 'open-pet-settings',
        type: 'open_pet_settings',
        label: '调整提醒',
        confirmText: '打开宠物设置，调整休息提醒或主动建议频率？',
        reason: '如果提醒太频繁，可以直接把宠物调成安静或关闭主动建议。',
        risk: 'low',
        permission: 'open_panel',
      }],
    };
  }

  return null;
}
