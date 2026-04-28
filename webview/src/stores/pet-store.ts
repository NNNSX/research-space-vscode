import { create } from 'zustand';
import type { PetTypeId, PetState, GroundThemeId } from '../pet/pet-types';
import {
  createDefaultPetState, getPetType, getTimeOfDay, pickRandom,
  getMoodCategory, getLevelFromExp, DIALOGUES,
} from '../pet/pet-types';
import {
  createInitialEngine, tick, forceState,
  type EngineState, type TickResult,
} from '../pet/pet-engine';
import { postMessage } from '../bridge';
import type { PetChatMessage, PetState as SharedPetState } from '../../../src/core/canvas-model';
import { getUnlockedPetsForLevel, normalizePetState } from '../../../src/core/pet-state';
import {
  createPetCanvasEvent,
  pickPetLocalSuggestion,
  trimPetEventHistory,
  type PetCanvasEvent,
  type PetCanvasEventInput,
  type PetSuggestionActivity,
  type PetSuggestionKind,
} from '../pet/pet-event-policy';
import { buildPetSuggestionCard, type PetSuggestionCard } from '../pet/pet-brain';

// ── Types ─────────────────────────────────────────────────────────────────

export type PetMode = 'minimized' | 'roaming' | 'chat' | 'game';
export type PetDisplayMode = 'panel' | 'canvas-follow';

export interface PetMemorySummaryState {
  profile: {
    frequentEventTypes: string[];
    frequentNodeTypes: string[];
    frequentTools: string[];
    frequentScenes: string[];
    suggestionStats: {
      shown: number;
      accepted: number;
      later: number;
      muted: number;
    };
    suggestionActivity: string;
    displayMode: string;
    updatedAt?: string;
  };
  records: Array<{
    id: string;
    createdAt: string;
    type: string;
    importance: number;
    text: string;
  }>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

type MiniGameId = 'snake' | 'twenty48' | 'sudoku' | 'flappy';

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resetDailyMiniGameStats(pet: PetState, today = localDateKey()): PetState {
  if (pet.miniGameStatsDate === today) { return pet; }
  return {
    ...pet,
    miniGameStatsDate: today,
    snakeBestScoreToday: 0,
    twenty48BestScoreToday: 0,
    sudokuBestScoreToday: 0,
    flappyBestScoreToday: 0,
  };
}

// ── Pet store interface ────────────────────────────────────────────────────

interface PetStore {
  hydrated: boolean;
  // Feature toggle
  enabled: boolean;

  // Widget mode (replaces collapsed + chatOpen)
  mode: PetMode;
  displayMode: PetDisplayMode;

  // Floating widget position (absolute left/top)
  widgetLeft: number;
  widgetTop: number;
  canvasPetLeft: number | null;
  canvasPetTop: number | null;
  canvasPetManual: boolean;
  hovered: boolean;

  // Pre-chat position (saved when entering chat, restored when leaving)
  preChatLeft: number | null;
  preChatTop: number | null;

  // Persistent pet state
  pet: PetState;

  // GIF asset base URI (set by extension host)
  assetsBaseUri: string;

  // Ground theme
  groundTheme: GroundThemeId;

  // Runtime engine state
  engine: EngineState;
  sessionStartTime: number;    // Date.now() at session start
  lastInteractionTime: number; // Date.now() of last user interaction
  lastRestRemind: number;      // Date.now() of last rest reminder
  lastAiSuggestion: number;    // Date.now() of last AI suggestion
  aiSuggestionInterval: number; // minutes between AI suggestions (0 = disabled)
  restReminderMin: number;     // from settings
  waitingForAi: boolean;       // true while waiting for AI response

  // Bubble
  bubbleText: string | null;
  bubbleSuggestionKind: PetSuggestionKind | null;

  // Chat state (managed in store, not local component state)
  chatMessages: ChatMessage[];
  chatLoading: boolean;

  // Canvas event awareness
  lastCanvasReaction: number;  // Date.now() of last event reaction (30s throttle)
  recentCanvasEvents: PetCanvasEvent[];
  lastSuggestionByKind: Partial<Record<PetSuggestionKind, number>>;
  mutedSuggestionKinds: Partial<Record<PetSuggestionKind, boolean>>;
  suggestionActivity: PetSuggestionActivity;
  longTermMemory: boolean;
  memorySummary: PetMemorySummaryState | null;
  suggestionStats: PetMemorySummaryState['profile']['suggestionStats'];
  activeSuggestionCard: PetSuggestionCard | null;

  // Greeting shown this session?
  greetingShown: boolean;

  // Actions
  setAssetsBaseUri(uri: string): void;
  init(state: PetState | null, enabled: boolean, restReminderMin: number, groundTheme?: GroundThemeId, suggestionActivity?: string, displayMode?: string, longTermMemory?: boolean): void;
  setEnabled(enabled: boolean): void;
  setMode(mode: PetMode): void;
  setAnchor(left: number, top: number): void;
  setCanvasPetPosition(left: number, top: number, manual?: boolean): void;
  resetCanvasPetPosition(): void;
  setHovered(hovered: boolean): void;
  setGroundTheme(id: GroundThemeId): void;
  setSuggestionActivity(activity: PetSuggestionActivity): void;
  setDisplayMode(mode: PetDisplayMode): void;
  setLongTermMemory(enabled: boolean): void;
  clearLongTermMemory(): void;
  requestMemorySummary(): void;
  setMemorySummary(summary: PetMemorySummaryState): void;
  tickEngine(): void;
  handleClick(): void;
  handleDoubleClick(): void;
  handleSwipe(): void;
  setPetType(id: PetTypeId): void;
  setPetName(name: string): void;
  setRestReminderMin(min: number): void;
  addExp(amount: number): void;
  dismissRestReminder(): void;
  showBubble(text: string, durationMs?: number): void;
  dismissSuggestion(kind?: PetSuggestionKind | null): void;
  acceptSuggestion(kind?: PetSuggestionKind | null): void;
  closeSuggestionCard(kind?: PetSuggestionKind | null): void;
  muteSuggestionKind(kind?: PetSuggestionKind | null): void;
  savePetState(): void;
  saveMemory(): void;
  // Chat actions
  sendChatMessage(text: string): void;
  addChatResponse(text: string): void;
  clearChat(): void;
  // Canvas event awareness
  notifyCanvasEvent(eventType: PetCanvasEventInput, meta?: Partial<Pick<PetCanvasEvent, 'nodeId' | 'nodeType' | 'title'>>): void;
  recordMiniGameResult(gameId: MiniGameId, score: number): void;
}

// ── Store ──────────────────────────────────────────────────────────────────

export const usePetStore = create<PetStore>((set, get) => ({
  hydrated: false,
  enabled: false,
  mode: 'roaming',
  displayMode: 'panel',
  widgetLeft: 16,
  widgetTop: -1,  // -1 = needs initial placement (bottom-left default)
  canvasPetLeft: null,
  canvasPetTop: null,
  canvasPetManual: false,
  hovered: false,
  preChatLeft: null,
  preChatTop: null,
  pet: createDefaultPetState(),
  assetsBaseUri: '',
  groundTheme: 'forest' as GroundThemeId,
  engine: createInitialEngine(),
  sessionStartTime: Date.now(),
  lastInteractionTime: Date.now(),
  lastRestRemind: Date.now(),
  lastAiSuggestion: 0,
  aiSuggestionInterval: 15,
  restReminderMin: 45,
  waitingForAi: false,
  bubbleText: null,
  bubbleSuggestionKind: null,
  chatMessages: [],
  chatLoading: false,
  lastCanvasReaction: 0,
  recentCanvasEvents: [],
  lastSuggestionByKind: {},
  mutedSuggestionKinds: {},
  suggestionActivity: 'balanced',
  longTermMemory: true,
  memorySummary: null,
  suggestionStats: { shown: 0, accepted: 0, later: 0, muted: 0 },
  activeSuggestionCard: null,
  greetingShown: false,

  setAssetsBaseUri(uri) {
    set({ assetsBaseUri: uri });
  },

  init(state, enabled, restReminderMin, groundTheme, suggestionActivity, displayMode, longTermMemory) {
    const pet = resetDailyMiniGameStats(normalizePetState(state) ?? createDefaultPetState());
    const now = Date.now();
    const normalizedActivity: PetSuggestionActivity =
      suggestionActivity === 'off' || suggestionActivity === 'quiet' || suggestionActivity === 'active'
        ? suggestionActivity
        : 'balanced';
    const normalizedDisplayMode: PetDisplayMode = displayMode === 'canvas-follow' ? 'canvas-follow' : 'panel';
    set({
      pet: { ...pet, currentSessionStart: new Date().toISOString() },
      hydrated: true,
      enabled,
      restReminderMin,
      groundTheme: groundTheme ?? 'forest',
      suggestionActivity: normalizedActivity,
      displayMode: normalizedDisplayMode,
      longTermMemory: longTermMemory !== false,
      sessionStartTime: now,
      lastInteractionTime: now,
      lastRestRemind: now,
      engine: createInitialEngine(),
      greetingShown: false,
      // Restore widget position from persisted state (migrate from anchor-based if needed)
      widgetLeft: pet.widgetLeft ?? 16,
      widgetTop: pet.widgetTop ?? -1,  // -1 = needs initial placement
      canvasPetLeft: Number.isFinite(pet.canvasPetLeft) ? pet.canvasPetLeft! : null,
      canvasPetTop: Number.isFinite(pet.canvasPetTop) ? pet.canvasPetTop! : null,
      canvasPetManual: pet.canvasPetManual === true,
    });

    // Show greeting after a short delay
    if (enabled) {
      setTimeout(() => {
        const s = get();
        if (!s.greetingShown && s.enabled) {
          const tod = getTimeOfDay();
          const greeting = pickRandom(DIALOGUES.greetings[tod]);
          s.showBubble(greeting, 6000);
          set({ greetingShown: true });
        }
      }, 1500);
    }
  },

  setEnabled(enabled) {
    set({ enabled });
    postMessage({ type: 'petSettingChanged', key: 'pet.enabled', value: enabled });
  },

  setMode(mode) {
    const s = get();
    const updates: Partial<PetStore> = { mode };

    // Save position before entering chat; restore when leaving chat
    if (mode === 'chat' || mode === 'game') {
      updates.preChatLeft = s.widgetLeft;
      updates.preChatTop = s.widgetTop;
      // When entering chat mode with empty messages, add greeting
      if (mode === 'chat' && s.chatMessages.length === 0) {
        updates.chatMessages = [{ role: 'assistant', text: `你好！我是${s.pet.petName}~ 有什么可以帮你的吗？` }];
      }
    } else if ((s.mode === 'chat' || s.mode === 'game') && s.preChatLeft !== null && s.preChatTop !== null) {
      // Leaving expanded mode → restore original position
      updates.widgetLeft = s.preChatLeft;
      updates.widgetTop = s.preChatTop;
      updates.preChatLeft = null;
      updates.preChatTop = null;
    }

    set(updates);
    // Persist mode change
    setTimeout(() => get().savePetState(), 500);
  },

  setAnchor(left, top) {
    set({ widgetLeft: left, widgetTop: top });
    // Persist position
    setTimeout(() => get().savePetState(), 500);
  },

  setCanvasPetPosition(left, top, manual = true) {
    set({ canvasPetLeft: left, canvasPetTop: top, canvasPetManual: manual });
    setTimeout(() => get().savePetState(), 500);
  },

  resetCanvasPetPosition() {
    set({ canvasPetLeft: null, canvasPetTop: null, canvasPetManual: false });
    setTimeout(() => get().savePetState(), 500);
  },

  setHovered(hovered) {
    set({ hovered });
  },

  setGroundTheme(id) {
    set({ groundTheme: id });
    postMessage({ type: 'petSettingChanged', key: 'pet.groundTheme', value: id });
  },

  setSuggestionActivity(activity) {
    set({ suggestionActivity: activity });
    postMessage({ type: 'petSettingChanged', key: 'pet.suggestionActivity', value: activity });
  },

  setDisplayMode(mode) {
    set({ displayMode: mode });
    postMessage({ type: 'petSettingChanged', key: 'pet.displayMode', value: mode });
  },

  setLongTermMemory(enabled) {
    set({ longTermMemory: enabled });
    postMessage({ type: 'petSettingChanged', key: 'pet.longTermMemory', value: enabled });
  },

  clearLongTermMemory() {
    set({ memorySummary: null });
    postMessage({ type: 'petClearMemory' });
  },

  requestMemorySummary() {
    if (!get().longTermMemory) { return; }
    postMessage({ type: 'petRequestMemorySummary' });
  },

  setMemorySummary(summary) {
    set({ memorySummary: summary });
  },

  tickEngine() {
    const s = get();
    // In minimized mode, still decay mood/energy but skip behavior engine
    if (!s.enabled || !s.hydrated) { return; }

    const now = Date.now();
    const idleMinutes = (now - s.lastInteractionTime) / 60_000;
    const sessionMinutes = (now - s.sessionStartTime) / 60_000;

    if (s.mode === 'minimized') {
      // Only decay mood/energy, no animation/behavior updates
      const moodDelta = idleMinutes > 1 ? -0.002 : 0;
      const energyDelta = -0.0025;
      set(prev => {
        const newExp = prev.pet.exp + 0.025;
        const newLevel = getLevelFromExp(Math.floor(newExp));
        const leveledUp = newLevel > prev.pet.level;
        return {
          pet: {
            ...prev.pet,
            mood: Math.max(0, Math.min(100, prev.pet.mood + moodDelta)),
            energy: Math.max(0, Math.min(100, prev.pet.energy + energyDelta)),
            exp: newExp,
            level: newLevel,
            totalWorkMinutes: prev.pet.totalWorkMinutes + 0.05,
            unlockedPets: getUnlockedPetsForLevel(newLevel, prev.pet.petType, prev.pet.unlockedPets),
          },
          ...(leveledUp ? { bubbleText: `升级啦！Lv.${newLevel}` } : {}),
        };
      });
      return;
    }

    const result: TickResult = tick(s.engine, {
      mood: s.pet.mood,
      energy: s.pet.energy,
      idleMinutes,
      sessionMinutes,
      restReminderMin: s.restReminderMin,
      lastRestRemind: s.lastRestRemind,
    });

    // Apply mood/energy deltas
    let newMood = Math.max(0, Math.min(100, s.pet.mood + result.moodDelta));
    let newEnergy = Math.max(0, Math.min(100, s.pet.energy + result.energyDelta));

    // Work experience: ~5 exp per 10 min => 0.025 per 3s tick
    let newExp = s.pet.exp + 0.025;
    const newLevel = getLevelFromExp(Math.floor(newExp));

    const newUnlocked = getUnlockedPetsForLevel(newLevel, s.pet.petType, s.pet.unlockedPets);

    let newEngine = result.engine;
    let bubbleText = s.bubbleText;

    // Rest reminder
    if (result.shouldRemindRest) {
      const restText = pickRandom(DIALOGUES.rest).replace('{minutes}', String(Math.floor(sessionMinutes)));
      newEngine = forceState(newEngine, 'idle', 'stretch', restText, 8000);
      bubbleText = restText;
      set({ lastRestRemind: now });
    }

    // Clear expired bubble
    if (bubbleText && now > newEngine.bubbleExpiry) {
      bubbleText = null;
    }

    // Random idle dialogue (very low chance per tick)
    if (!bubbleText && Math.random() < 0.005) {
      const cat = getMoodCategory(s.pet.mood);
      const text = pickRandom(DIALOGUES.idle[cat]);
      newEngine = forceState(newEngine, newEngine.behavior, newEngine.animation, text, 4000);
      bubbleText = text;
    }

    // AI suggestion trigger: idle > 5min, interval elapsed, not already waiting
    if (
      s.suggestionActivity !== 'off' &&
      !s.waitingForAi &&
      s.aiSuggestionInterval > 0 &&
      idleMinutes > 5 &&
      (now - s.lastAiSuggestion) > s.aiSuggestionInterval * 60_000
    ) {
      set({ waitingForAi: true, lastAiSuggestion: now });
      newEngine = forceState(newEngine, 'idle', 'think');
      postMessage({
        type: 'petAiChat',
        requestId: `suggest-${now}`,
        petName: s.pet.petName,
        personality: getPetType(s.pet.petType).personality,
        messages: [{ role: 'user', text: '请基于画布内容给我一些研究建议或鼓励' }],
        mode: 'suggestion',
      });
    }

    // Update work minutes (~0.05 per 3s tick)
    const newTotalWork = s.pet.totalWorkMinutes + 0.05;
    const leveledUp = newLevel > s.pet.level;
    if (leveledUp) {
      const unlockedDelta = Math.max(0, newUnlocked.length - s.pet.unlockedPets.length);
      const levelText = unlockedDelta > 0
        ? `升级到 Lv.${newLevel}，解锁了 ${unlockedDelta} 个新伙伴！`
        : `升级啦！现在是 Lv.${newLevel}`;
      newEngine = forceState(newEngine, 'happy', 'happy', levelText, 6000);
      bubbleText = levelText;
    }

    set({
      engine: newEngine,
      bubbleText,
      pet: {
        ...s.pet,
        mood: Math.round(newMood * 100) / 100,
        energy: Math.round(newEnergy * 100) / 100,
        exp: newExp,
        level: newLevel,
        totalWorkMinutes: newTotalWork,
        unlockedPets: newUnlocked,
      },
    });
  },

  handleClick() {
    const s = get();
    const now = Date.now();
    const text = pickRandom(DIALOGUES.click);
    const newEngine = forceState(s.engine, 'happy', 'happy', text, 4000);
    const newMood = Math.min(100, s.pet.mood + 5);

    set({
      engine: newEngine,
      bubbleText: text,
      lastInteractionTime: now,
      pet: {
        ...s.pet,
        mood: newMood,
        lastInteraction: new Date().toISOString(),
      },
    });

    setTimeout(() => get().savePetState(), 500);
  },

  handleDoubleClick() {
    get().setMode('chat');
  },

  handleSwipe() {
    const s = get();
    const now = Date.now();
    if (s.engine.animation === 'happy') { return; }
    const newEngine = forceState(s.engine, 'happy', 'happy', '👋', 2000);
    set({
      engine: newEngine,
      bubbleText: '👋',
      lastInteractionTime: now,
      pet: {
        ...s.pet,
        mood: Math.min(100, s.pet.mood + 2),
        lastInteraction: new Date().toISOString(),
      },
    });
  },

  setPetType(id) {
    const typeDef = getPetType(id);
    set(s => ({
      pet: {
        ...s.pet,
        petType: id,
        petName: s.pet.petName || typeDef.defaultName,
        unlockedPets: getUnlockedPetsForLevel(s.pet.level, id, s.pet.unlockedPets),
      },
    }));
    get().savePetState();
  },

  setPetName(name) {
    set(s => ({ pet: { ...s.pet, petName: name } }));
    get().savePetState();
  },

  setRestReminderMin(min) {
    set({ restReminderMin: min });
    postMessage({ type: 'petSettingChanged', key: 'pet.restReminder', value: min });
  },

  addExp(amount) {
    set(s => {
      const newExp = s.pet.exp + amount;
      const newLevel = getLevelFromExp(Math.floor(newExp));
      const leveledUp = newLevel > s.pet.level;
      return {
        pet: {
          ...s.pet,
          exp: newExp,
          level: newLevel,
          unlockedPets: getUnlockedPetsForLevel(newLevel, s.pet.petType, s.pet.unlockedPets),
        },
        ...(leveledUp ? { bubbleText: `升级啦！Lv.${newLevel}` } : {}),
      };
    });
    get().savePetState();
  },

  dismissRestReminder() {
    set({
      lastRestRemind: Date.now(),
      bubbleText: null,
    });
    set(s => ({
      pet: { ...s.pet, energy: Math.min(100, s.pet.energy + 30) },
    }));
  },

  showBubble(text, durationMs = 5000) {
    const engine = forceState(get().engine, get().engine.behavior, 'talk', text, durationMs);
    set({ engine, bubbleText: text, bubbleSuggestionKind: null });
  },

  dismissSuggestion(kind) {
    const now = Date.now();
    set(s => ({
      bubbleText: null,
      bubbleSuggestionKind: null,
      activeSuggestionCard: null,
      suggestionStats: kind ? { ...s.suggestionStats, later: s.suggestionStats.later + 1 } : s.suggestionStats,
      ...(kind ? { lastSuggestionByKind: { ...s.lastSuggestionByKind, [kind]: now } } : {}),
    }));
  },

  acceptSuggestion(kind) {
    const now = Date.now();
    set(s => ({
      bubbleText: null,
      bubbleSuggestionKind: null,
      activeSuggestionCard: null,
      suggestionStats: kind ? { ...s.suggestionStats, accepted: s.suggestionStats.accepted + 1 } : s.suggestionStats,
      ...(kind ? { lastSuggestionByKind: { ...s.lastSuggestionByKind, [kind]: now } } : {}),
      pet: {
        ...s.pet,
        mood: Math.min(100, s.pet.mood + 2),
      },
    }));
  },

  closeSuggestionCard(kind) {
    const now = Date.now();
    set(s => ({
      activeSuggestionCard: null,
      bubbleText: null,
      bubbleSuggestionKind: null,
      suggestionStats: kind ? { ...s.suggestionStats, later: s.suggestionStats.later + 1 } : s.suggestionStats,
      ...(kind ? { lastSuggestionByKind: { ...s.lastSuggestionByKind, [kind]: now } } : {}),
    }));
  },

  muteSuggestionKind(kind) {
    if (!kind) {
      set({ bubbleText: null, bubbleSuggestionKind: null });
      return;
    }
    set(s => ({
      bubbleText: null,
      bubbleSuggestionKind: null,
      activeSuggestionCard: null,
      suggestionStats: { ...s.suggestionStats, muted: s.suggestionStats.muted + 1 },
      mutedSuggestionKinds: { ...s.mutedSuggestionKinds, [kind]: true },
    }));
  },

  savePetState() {
    const { pet, widgetLeft, widgetTop, canvasPetLeft, canvasPetTop, canvasPetManual, hydrated } = get();
    if (!hydrated) { return; }
    const stateToSave: SharedPetState = {
      ...pet,
      widgetLeft,
      widgetTop,
      canvasPetLeft: canvasPetLeft ?? undefined,
      canvasPetTop: canvasPetTop ?? undefined,
      canvasPetManual,
    };
    postMessage({ type: 'savePetState', state: stateToSave });
  },

  saveMemory() {
    const { pet, sessionStartTime, hydrated, longTermMemory, recentCanvasEvents, suggestionActivity, displayMode, suggestionStats } = get();
    if (!hydrated || !longTermMemory) { return; }
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const sessionMin = Math.floor((Date.now() - sessionStartTime) / 60_000);

    const content = [
      `# 宠物记忆`,
      ``,
      `## ${dateStr}`,
      ``,
      `### 会话信息`,
      `- 宠物: ${pet.petName} (${pet.petType})`,
      `- 等级: Lv.${pet.level} | 经验: ${Math.floor(pet.exp)}`,
      `- 心情: ${Math.round(pet.mood)} | 精力: ${Math.round(pet.energy)}`,
      `- 本次会话时长: ${sessionMin} 分钟`,
      `- 总工作时间: ${Math.floor(pet.totalWorkMinutes)} 分钟`,
      `- 连续天数: ${pet.streakDays}`,
      `- 贪吃蛇: 最近 ${pet.snakeLastScore ?? 0} / 今日最佳 ${pet.snakeBestScoreToday ?? 0} / 历史最佳 ${pet.snakeBestScore ?? 0}`,
      `- 2048: 最近 ${pet.twenty48LastScore ?? 0} / 今日最佳 ${pet.twenty48BestScoreToday ?? 0} / 历史最佳 ${pet.twenty48BestScore ?? 0}`,
      `- 数独: 最近 ${pet.sudokuLastScore ?? 0} / 今日最佳 ${pet.sudokuBestScoreToday ?? 0} / 历史最佳 ${pet.sudokuBestScore ?? 0}`,
      `- 像素鸟: 最近 ${pet.flappyLastScore ?? 0} / 今日最佳 ${pet.flappyBestScoreToday ?? 0} / 历史最佳 ${pet.flappyBestScore ?? 0}`,
      ``,
    ].join('\n');

    const frequentEventTypes = Array.from(new Set(recentCanvasEvents.map(event => event.type))).slice(-12);
    postMessage({
      type: 'petSaveMemory',
      content,
      profileSnapshot: {
        frequentEventTypes,
        frequentNodeTypes: recentCanvasEvents.map(event => event.nodeType).filter(Boolean),
        frequentTools: recentCanvasEvents
          .filter(event => event.type === 'tool_run_completed' || event.type === 'tool_run_failed')
          .map(event => event.title)
          .filter(Boolean),
        suggestionStats,
        suggestionActivity,
        displayMode,
      },
      memoryRecord: {
        id: `session-${Date.now()}`,
        createdAt: now.toISOString(),
        type: 'session',
        importance: sessionMin >= 30 ? 3 : 2,
        text: `本次宠物陪伴会话约 ${sessionMin} 分钟，近期画布事件：${frequentEventTypes.join(', ') || '暂无'}。`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      },
    });
  },

  // ── Chat actions ────────────────────────────────────────────────────────

  sendChatMessage(text) {
    const s = get();
    const newMessages: ChatMessage[] = [...s.chatMessages, { role: 'user', text }];
    set({ chatMessages: newMessages, chatLoading: true });

    const typeDef = getPetType(s.pet.petType);
    postMessage({
      type: 'petAiChat',
      requestId: `chat-${Date.now()}`,
      petName: s.pet.petName,
      personality: typeDef.personality,
      messages: newMessages.map<PetChatMessage>(m => ({ role: m.role, text: m.text })),
      mode: 'chat',
    });
  },

  addChatResponse(text) {
    set(s => ({
      chatMessages: [...s.chatMessages, { role: 'assistant', text }],
      chatLoading: false,
      // Reward mood for conversation
      pet: { ...s.pet, mood: Math.min(100, s.pet.mood + 3) },
    }));
    get().addExp(10);
  },

  clearChat() {
    set({ chatMessages: [], chatLoading: false });
  },

  // ── Canvas event awareness ────────────────────────────────────────────────

  notifyCanvasEvent(eventType, meta = {}) {
    const s = get();
    if (!s.enabled || !s.hydrated || s.mode === 'minimized') { return; }
    if (s.suggestionActivity === 'off') { return; }
    const now = Date.now();
    const event = createPetCanvasEvent(eventType, meta, now);
    const recentCanvasEvents = trimPetEventHistory([...s.recentCanvasEvents, event], now);
    const localSuggestion = pickPetLocalSuggestion({
      event,
      recentEvents: recentCanvasEvents,
      now,
      activity: s.suggestionActivity,
      mutedKinds: s.mutedSuggestionKinds,
      lastSuggestionByKind: s.lastSuggestionByKind,
    });

    const genericCooldownMs = event.importance === 'high' ? 12_000 : 30_000;
    if (!localSuggestion && now - s.lastCanvasReaction < genericCooldownMs) {
      set({ recentCanvasEvents });
      return;
    }

    const legacyPhraseKey = event.type === 'node_added'
      ? 'nodeAdded'
      : event.type === 'node_deleted'
        ? 'nodeDeleted'
        : event.type === 'tool_run_completed'
          ? 'aiDone'
          : event.type === 'tool_run_failed' || event.type === 'repeated_error'
            ? 'aiError'
            : event.type;
    const directPhrases = (DIALOGUES as any).canvasEvents?.[event.type] as string[] | undefined;
    const fallbackPhrases = (DIALOGUES as any).canvasEvents?.[legacyPhraseKey] as string[] | undefined;
    const phrases = directPhrases ?? fallbackPhrases ?? [];
    if (!localSuggestion && !phrases?.length) {
      set({ recentCanvasEvents });
      return;
    }

    const bubbleText = localSuggestion ? localSuggestion.message : pickRandom(phrases);
    const engine = forceState(s.engine, s.engine.behavior, 'talk', bubbleText, localSuggestion ? 9000 : 4000);

    // Mood/exp adjustments for different events
    let moodDelta = 0;
    let expDelta = 0;
    if (event.type === 'node_added')  { moodDelta = 2; expDelta = 3; }
    if (event.type === 'tool_run_completed') { moodDelta = 5; expDelta = 8; }
    if (event.type === 'tool_run_failed' || event.type === 'repeated_error') { moodDelta = -2; }

    const nextExp = s.pet.exp + expDelta;
    const nextLevel = getLevelFromExp(Math.floor(nextExp));
    const leveledUp = nextLevel > s.pet.level;
    set({
      lastCanvasReaction: now,
      recentCanvasEvents,
      engine,
      bubbleText,
      bubbleSuggestionKind: localSuggestion?.kind ?? null,
      activeSuggestionCard: localSuggestion ? buildPetSuggestionCard(localSuggestion, {
        memorySummary: s.memorySummary,
        suggestionStats: s.suggestionStats,
      }) : null,
      ...(localSuggestion ? { suggestionStats: { ...s.suggestionStats, shown: s.suggestionStats.shown + 1 } } : {}),
      ...(localSuggestion ? { lastSuggestionByKind: { ...s.lastSuggestionByKind, [localSuggestion.kind]: now } } : {}),
      ...(leveledUp ? { bubbleText: `升级啦！Lv.${nextLevel}` } : {}),
      pet: {
        ...s.pet,
        mood: Math.max(0, Math.min(100, s.pet.mood + moodDelta)),
        exp: nextExp,
        level: nextLevel,
        unlockedPets: getUnlockedPetsForLevel(nextLevel, s.pet.petType, s.pet.unlockedPets),
      },
    });
  },

  recordMiniGameResult(gameId, score) {
    const safeScore = Math.max(0, Math.floor(score));
    set(s => {
      const today = localDateKey();
      const nowIso = new Date().toISOString();
      const normalizedPet = resetDailyMiniGameStats(s.pet, today);
      const nextPet: PetState = { ...normalizedPet, miniGameStatsDate: today };
      if (gameId === 'snake') {
        nextPet.snakeLastScore = safeScore;
        nextPet.snakeBestScoreToday = Math.max(normalizedPet.snakeBestScoreToday ?? 0, safeScore);
        nextPet.snakeBestScore = Math.max(normalizedPet.snakeBestScore ?? 0, safeScore);
        nextPet.snakeLastPlayedAt = nowIso;
      } else if (gameId === 'twenty48') {
        nextPet.twenty48LastScore = safeScore;
        nextPet.twenty48BestScoreToday = Math.max(normalizedPet.twenty48BestScoreToday ?? 0, safeScore);
        nextPet.twenty48BestScore = Math.max(normalizedPet.twenty48BestScore ?? 0, safeScore);
        nextPet.twenty48LastPlayedAt = nowIso;
      } else if (gameId === 'sudoku') {
        nextPet.sudokuLastScore = safeScore;
        nextPet.sudokuBestScoreToday = Math.max(normalizedPet.sudokuBestScoreToday ?? 0, safeScore);
        nextPet.sudokuBestScore = Math.max(normalizedPet.sudokuBestScore ?? 0, safeScore);
        nextPet.sudokuLastPlayedAt = nowIso;
      } else {
        nextPet.flappyLastScore = safeScore;
        nextPet.flappyBestScoreToday = Math.max(normalizedPet.flappyBestScoreToday ?? 0, safeScore);
        nextPet.flappyBestScore = Math.max(normalizedPet.flappyBestScore ?? 0, safeScore);
        nextPet.flappyLastPlayedAt = nowIso;
      }
      return { pet: nextPet };
    });
    get().savePetState();
  },
}));
