import { PET_LEVEL_THRESHOLDS, getExpForNextLevel, getLevelFromExp } from '../../../src/core/pet-state';
export { getExpForNextLevel, getLevelFromExp } from '../../../src/core/pet-state';

// ── Pet types & definitions ────────────────────────────────────────────────

/** Animation state names */
export type PetAnimation =
  | 'idle' | 'idle-blink' | 'walk-left' | 'walk-right'
  | 'sit' | 'sleep' | 'happy' | 'think' | 'talk'
  | 'wave' | 'read' | 'stretch';

/** Behavior state machine states */
export type PetBehavior = 'idle' | 'walking' | 'sitting' | 'sleeping' | 'happy' | 'waving';

/** Pet type IDs — matching vscode-pets asset folders */
export type PetTypeId = 'dog' | 'fox' | 'rubber-duck' | 'turtle' | 'crab' | 'clippy' | 'cockatiel';

/** Time of day categories */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

// ── Ground theme definitions ──────────────────────────────────────────────

export type GroundThemeId = 'none' | 'forest' | 'castle' | 'autumn' | 'beach' | 'winter';

export interface GroundThemeDef {
  id: GroundThemeId;
  name: string;
  floor: number;        // px from panel bottom where pet stands
  bgFile: string;       // background PNG path relative to backgrounds/
  fgFile: string;       // foreground PNG path (empty = no foreground)
}

/** floor values from vscode-pets themes.ts (nano size) */
export const GROUND_THEMES: GroundThemeDef[] = [
  { id: 'none',   name: '无背景', floor: 6,  bgFile: '', fgFile: '' },
  { id: 'forest', name: '森林',   floor: 23, bgFile: 'forest/background-dark-nano.png', fgFile: 'forest/foreground-dark-nano.png' },
  { id: 'castle', name: '城堡',   floor: 45, bgFile: 'castle/background-dark-nano.png', fgFile: 'castle/foreground-dark-nano.png' },
  { id: 'autumn', name: '秋天',   floor: 7,  bgFile: 'autumn/background-dark-nano.png', fgFile: 'autumn/foreground-dark-nano.png' },
  { id: 'beach',  name: '海滩',   floor: 45, bgFile: 'beach/background-dark-nano.png',  fgFile: 'beach/foreground-dark-nano.png' },
  { id: 'winter', name: '冬天',   floor: 18, bgFile: 'winter/background-dark-nano.png', fgFile: 'winter/foreground-dark-nano.png' },
];

export function getGroundTheme(id: GroundThemeId): GroundThemeDef {
  return GROUND_THEMES.find(t => t.id === id) ?? GROUND_THEMES[0];
}

// ── Pet type definitions ───────────────────────────────────────────────────

/** GIF file name for a given animation state */
export type GifAction = 'idle' | 'walk' | 'walk_fast' | 'run' | 'lie' | 'swipe' | 'with_ball';

export interface PetTypeDef {
  id: PetTypeId;
  name: string;
  defaultName: string;
  personality: string;
  emoji: string;          // for status bar / fallback
  gifFolder: string;      // e.g. "dog"
  gifPrefix: string;      // e.g. "brown"
  hasLie: boolean;        // whether lie_8fps.gif exists
  unlockLevel: number;
}

/** Map our PetAnimation states to GIF action file names */
export function animationToGifAction(anim: PetAnimation, hasLie: boolean): GifAction {
  switch (anim) {
    case 'walk-left':
    case 'walk-right':
      return 'walk';
    case 'sit':
    case 'sleep':
      return hasLie ? 'lie' : 'idle';
    case 'happy':
    case 'wave':
    case 'stretch':
      return 'swipe';
    default: // idle, idle-blink, think, talk, read
      return 'idle';
  }
}

/** Build the full GIF filename (without folder path) */
export function getGifFilename(prefix: string, action: GifAction): string {
  return `${prefix}_${action}_8fps.gif`;
}

export const PET_TYPES: PetTypeDef[] = [
  {
    id: 'dog',
    name: '像素狗',
    defaultName: '旺财',
    personality: '热情积极，总想帮忙',
    emoji: '🐕',
    gifFolder: 'dog',
    gifPrefix: 'brown',
    hasLie: true,
    unlockLevel: 1,
  },
  {
    id: 'fox',
    name: '像素狐狸',
    defaultName: '灵灵',
    personality: '机灵好奇，爱探索',
    emoji: '🦊',
    gifFolder: 'fox',
    gifPrefix: 'red',
    hasLie: true,
    unlockLevel: 1,
  },
  {
    id: 'rubber-duck',
    name: '橡皮鸭',
    defaultName: '鸭鸭',
    personality: '呆萌可爱，帮你理清思路',
    emoji: '🦆',
    gifFolder: 'rubber-duck',
    gifPrefix: 'yellow',
    hasLie: false,
    unlockLevel: 3,
  },
  {
    id: 'turtle',
    name: '像素龟',
    defaultName: '稳稳',
    personality: '沉稳踏实，陪你慢慢来',
    emoji: '🐢',
    gifFolder: 'turtle',
    gifPrefix: 'green',
    hasLie: true,
    unlockLevel: 3,
  },
  {
    id: 'crab',
    name: '像素蟹',
    defaultName: '钳钳',
    personality: '横行霸道但内心温柔',
    emoji: '🦀',
    gifFolder: 'crab',
    gifPrefix: 'red',
    hasLie: true,
    unlockLevel: 5,
  },
  {
    id: 'clippy',
    name: '曲别针',
    defaultName: '小夹',
    personality: '热心助人，经典回归',
    emoji: '📎',
    gifFolder: 'clippy',
    gifPrefix: 'black',
    hasLie: false,
    unlockLevel: 5,
  },
  {
    id: 'cockatiel',
    name: '鹦鹉',
    defaultName: '啾啾',
    personality: '活泼健谈，爱学舌',
    emoji: '🐦',
    gifFolder: 'cockatiel',
    gifPrefix: 'gray',
    hasLie: false,
    unlockLevel: 8,
  },
];

export function getPetType(id: PetTypeId): PetTypeDef {
  return PET_TYPES.find(p => p.id === id) ?? PET_TYPES[0];
}

// ── Persistent pet state ───────────────────────────────────────────────────

export type WidgetAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface PetState {
  petType: PetTypeId;
  petName: string;
  mood: number;           // 0–100
  energy: number;         // 0–100
  exp: number;
  level: number;
  totalWorkMinutes: number;
  currentSessionStart: string;  // ISO
  lastInteraction: string;      // ISO
  unlockedPets: PetTypeId[];
  streakDays: number;
  // Floating widget position (persisted) — absolute left/top
  widgetAnchor?: WidgetAnchor;   // legacy, kept for migration
  widgetOffsetX?: number;        // legacy
  widgetOffsetY?: number;        // legacy
  widgetLeft?: number;
  widgetTop?: number;
  miniGameStatsDate?: string;
  snakeLastScore?: number;
  snakeBestScoreToday?: number;
  snakeBestScore?: number;
  snakeLastPlayedAt?: string;
  twenty48LastScore?: number;
  twenty48BestScoreToday?: number;
  twenty48BestScore?: number;
  twenty48LastPlayedAt?: string;
  sudokuLastScore?: number;
  sudokuBestScoreToday?: number;
  sudokuBestScore?: number;
  sudokuLastPlayedAt?: string;
  flappyLastScore?: number;
  flappyBestScoreToday?: number;
  flappyBestScore?: number;
  flappyLastPlayedAt?: string;
}

export function createDefaultPetState(): PetState {
  const now = new Date().toISOString();
  return {
    petType: 'dog',
    petName: '旺财',
    mood: 80,
    energy: 100,
    exp: 0,
    level: 1,
    totalWorkMinutes: 0,
    currentSessionStart: now,
    lastInteraction: now,
    unlockedPets: ['dog', 'fox'],
    streakDays: 0,
    miniGameStatsDate: now.slice(0, 10),
    snakeLastScore: 0,
    snakeBestScoreToday: 0,
    snakeBestScore: 0,
    snakeLastPlayedAt: now,
    twenty48LastScore: 0,
    twenty48BestScoreToday: 0,
    twenty48BestScore: 0,
    twenty48LastPlayedAt: now,
    sudokuLastScore: 0,
    sudokuBestScoreToday: 0,
    sudokuBestScore: 0,
    sudokuLastPlayedAt: now,
    flappyLastScore: 0,
    flappyBestScoreToday: 0,
    flappyBestScore: 0,
    flappyLastPlayedAt: now,
  };
}

// ── Dialogue / 台词库 ──────────────────────────────────────────────────────

export const DIALOGUES = {
  greetings: {
    morning: [
      '早上好呀~ 今天也要加油！',
      '新的一天，充满可能~',
      '早！今天的研究从哪里开始？',
    ],
    afternoon: [
      '下午了，要不要来杯咖啡？',
      '午后犯困？点点我提神~',
      '下午好~ 继续加油！',
    ],
    evening: [
      '晚上好~ 今天辛苦了',
      '傍晚了，注意休息哦',
      '晚上好！今天的进展不错呢~',
    ],
    night: [
      '夜深了，注意身体哦',
      '这么晚还在工作？注意休息~',
      '深夜了…要不明天继续？',
    ],
  } as Record<TimeOfDay, string[]>,
  idle: {
    happy: [
      '论文写得怎么样啦？',
      '有什么需要帮忙的吗？',
      '加油加油！',
      '你今天效率真高！',
    ],
    normal: [
      '...',
      '*伸懒腰*',
      '*摇摇尾巴*',
      '嗯…',
      '*左看看右看看*',
    ],
    sad: [
      '好久没理我了...',
      '点点我嘛~',
      '*可怜巴巴地看着你*',
      '我还在这里哦…',
    ],
  } as Record<string, string[]>,
  rest: [
    '你已经工作 {minutes} 分钟了，休息一下吧~',
    '站起来活动活动身体~',
    '*伸懒腰* 一起休息一下吧！',
    '眼睛也需要休息哦，看看远方~',
    '喝杯水吧~ 保持水分很重要',
  ],
  encouragement: [
    '遇到困难不要怕，一步一步来~',
    '你比你想象的更厉害！',
    '研究就是这样，柳暗花明~',
    '坚持一下，很快就能突破了！',
  ],
  aiTaskComplete: [
    'AI 完成啦！快去看看结果~',
    '新的输出生成了！',
    '又完成一个任务，你太棒了！',
  ],
  click: [
    '嘿嘿~',
    '你好呀！',
    '有什么事吗？',
    '*开心蹦跳*',
    '被发现了~',
    '点我干嘛~',
  ],
  fortune: [
    '今日运势：大吉！研究灵感源源不断~',
    '今日运势：中吉！适合整理文献~',
    '今日运势：小吉！慢慢来，不着急~',
    '今日运势：大吉！今天写论文手感超好~',
    '今日运势：中吉！适合做数据分析~',
  ],
  canvasEvents: {
    nodeAdded: [
      '哦，新素材！画布越来越丰富了~',
      '又添加了新内容，加油！',
      '新节点，让我看看~',
    ],
    nodeDeleted: [
      '整理画布也是好习惯~',
      '嗯，精简一下~',
      '删掉不需要的，清爽！',
    ],
    aiDone: [
      'AI 完成啦！快去看看结果~',
      '新的输出生成了！',
      '又完成一个任务，太棒了！',
    ],
    aiError: [
      '呜…AI 出错了，再试试？',
      '别灰心，再来一次~',
      '遇到问题了…检查一下设置？',
    ],
  } as Record<string, string[]>,
};

export function getTimeOfDay(): TimeOfDay {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) { return 'morning'; }
  if (h >= 12 && h < 18) { return 'afternoon'; }
  if (h >= 18 && h < 22) { return 'evening'; }
  return 'night';
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getMoodCategory(mood: number): 'happy' | 'normal' | 'sad' {
  if (mood > 70) { return 'happy'; }
  if (mood > 35) { return 'normal'; }
  return 'sad';
}

// ── Level thresholds ───────────────────────────────────────────────────────

export const LEVEL_THRESHOLDS = PET_LEVEL_THRESHOLDS;
