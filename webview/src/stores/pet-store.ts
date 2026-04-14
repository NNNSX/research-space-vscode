import { create } from 'zustand';
import type { PetTypeId, PetState, GroundThemeId } from '../pet/pet-types';
import {
  createDefaultPetState, getPetType, getTimeOfDay, pickRandom,
  getMoodCategory, getLevelFromExp, getExpForNextLevel, DIALOGUES,
} from '../pet/pet-types';
import {
  createInitialEngine, tick, forceState,
  type EngineState, type TickResult,
} from '../pet/pet-engine';
import { postMessage } from '../bridge';

// ── Types ─────────────────────────────────────────────────────────────────

export type PetMode = 'minimized' | 'roaming' | 'chat';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

// ── Pet store interface ────────────────────────────────────────────────────

interface PetStore {
  // Feature toggle
  enabled: boolean;

  // Widget mode (replaces collapsed + chatOpen)
  mode: PetMode;

  // Floating widget position (absolute left/top)
  widgetLeft: number;
  widgetTop: number;
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

  // Chat state (managed in store, not local component state)
  chatMessages: ChatMessage[];
  chatLoading: boolean;

  // Canvas event awareness
  lastCanvasReaction: number;  // Date.now() of last event reaction (30s throttle)

  // Greeting shown this session?
  greetingShown: boolean;

  // Actions
  setAssetsBaseUri(uri: string): void;
  init(state: PetState | null, enabled: boolean, restReminderMin: number, groundTheme?: GroundThemeId): void;
  setEnabled(enabled: boolean): void;
  setMode(mode: PetMode): void;
  setAnchor(left: number, top: number): void;
  setHovered(hovered: boolean): void;
  setGroundTheme(id: GroundThemeId): void;
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
  savePetState(): void;
  saveMemory(): void;
  // Chat actions
  sendChatMessage(text: string): void;
  addChatResponse(text: string): void;
  clearChat(): void;
  // Canvas event awareness
  notifyCanvasEvent(eventType: 'nodeAdded' | 'nodeDeleted' | 'aiDone' | 'aiError'): void;
}

// ── Store ──────────────────────────────────────────────────────────────────

export const usePetStore = create<PetStore>((set, get) => ({
  enabled: false,
  mode: 'roaming',
  widgetLeft: 16,
  widgetTop: -1,  // -1 = needs initial placement (bottom-left default)
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
  chatMessages: [],
  chatLoading: false,
  lastCanvasReaction: 0,
  greetingShown: false,

  setAssetsBaseUri(uri) {
    set({ assetsBaseUri: uri });
  },

  init(state, enabled, restReminderMin, groundTheme) {
    const pet = state ?? createDefaultPetState();
    // Ensure unlockedPets exists (older saves may not have it)
    if (!pet.unlockedPets || !Array.isArray(pet.unlockedPets)) {
      pet.unlockedPets = ['dog', 'fox'];
    }
    const now = Date.now();
    set({
      pet: { ...pet, currentSessionStart: new Date().toISOString() },
      enabled,
      restReminderMin,
      groundTheme: groundTheme ?? 'forest',
      sessionStartTime: now,
      lastInteractionTime: now,
      lastRestRemind: now,
      engine: createInitialEngine(),
      greetingShown: false,
      // Restore widget position from persisted state (migrate from anchor-based if needed)
      widgetLeft: pet.widgetLeft ?? 16,
      widgetTop: pet.widgetTop ?? -1,  // -1 = needs initial placement
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
    if (mode === 'chat') {
      updates.preChatLeft = s.widgetLeft;
      updates.preChatTop = s.widgetTop;
      // When entering chat mode with empty messages, add greeting
      if (s.chatMessages.length === 0) {
        updates.chatMessages = [{ role: 'assistant', text: `你好！我是${s.pet.petName}~ 有什么可以帮你的吗？` }];
      }
    } else if (s.mode === 'chat' && s.preChatLeft !== null && s.preChatTop !== null) {
      // Leaving chat → restore original position
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

  setHovered(hovered) {
    set({ hovered });
  },

  setGroundTheme(id) {
    set({ groundTheme: id });
    postMessage({ type: 'petSettingChanged', key: 'pet.groundTheme', value: id });
  },

  tickEngine() {
    const s = get();
    // In minimized mode, still decay mood/energy but skip behavior engine
    if (!s.enabled) { return; }

    const now = Date.now();
    const idleMinutes = (now - s.lastInteractionTime) / 60_000;
    const sessionMinutes = (now - s.sessionStartTime) / 60_000;

    if (s.mode === 'minimized') {
      // Only decay mood/energy, no animation/behavior updates
      const moodDelta = idleMinutes > 1 ? -0.002 : 0;
      const energyDelta = -0.0025;
      set(prev => ({
        pet: {
          ...prev.pet,
          mood: Math.max(0, Math.min(100, prev.pet.mood + moodDelta)),
          energy: Math.max(0, Math.min(100, prev.pet.energy + energyDelta)),
          exp: prev.pet.exp + 0.025,
          totalWorkMinutes: prev.pet.totalWorkMinutes + 0.05,
        },
      }));
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

    // Check for level-up unlocks
    let newUnlocked = [...s.pet.unlockedPets];
    if (newLevel >= 3 && !newUnlocked.includes('rubber-duck')) { newUnlocked.push('rubber-duck'); }
    if (newLevel >= 3 && !newUnlocked.includes('turtle')) { newUnlocked.push('turtle'); }
    if (newLevel >= 5 && !newUnlocked.includes('crab')) { newUnlocked.push('crab'); }
    if (newLevel >= 5 && !newUnlocked.includes('clippy')) { newUnlocked.push('clippy'); }
    if (newLevel >= 8 && !newUnlocked.includes('cockatiel')) { newUnlocked.push('cockatiel'); }

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
      } as any);
    }

    // Update work minutes (~0.05 per 3s tick)
    const newTotalWork = s.pet.totalWorkMinutes + 0.05;

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
      pet: { ...s.pet, petType: id, petName: s.pet.petName || typeDef.defaultName },
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
      return { pet: { ...s.pet, exp: newExp, level: newLevel } };
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
    set({ engine, bubbleText: text });
  },

  savePetState() {
    const { pet, widgetLeft, widgetTop } = get();
    const stateToSave = {
      ...pet,
      widgetLeft,
      widgetTop,
    };
    postMessage({ type: 'savePetState', state: stateToSave });
  },

  saveMemory() {
    const { pet, sessionStartTime } = get();
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
      ``,
    ].join('\n');

    postMessage({ type: 'petSaveMemory', content });
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
      messages: newMessages.map(m => ({ role: m.role, text: m.text })),
      mode: 'chat',
    } as any);
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

  notifyCanvasEvent(eventType) {
    const s = get();
    if (!s.enabled || s.mode === 'minimized') { return; }
    const now = Date.now();
    if (now - s.lastCanvasReaction < 30_000) { return; } // 30s throttle

    const phrases = (DIALOGUES as any).canvasEvents?.[eventType] as string[] | undefined;
    if (!phrases?.length) { return; }

    s.showBubble(pickRandom(phrases), 4000);

    // Mood/exp adjustments for different events
    let moodDelta = 0;
    let expDelta = 0;
    if (eventType === 'nodeAdded')  { moodDelta = 2; expDelta = 3; }
    if (eventType === 'aiDone')     { moodDelta = 5; expDelta = 8; }
    if (eventType === 'aiError')    { moodDelta = -2; }

    set({
      lastCanvasReaction: now,
      pet: {
        ...s.pet,
        mood: Math.max(0, Math.min(100, s.pet.mood + moodDelta)),
        exp: s.pet.exp + expDelta,
      },
    });
  },
}));
