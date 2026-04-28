import type { PetState, PetTypeId } from './canvas-model';

export const PET_LEVEL_THRESHOLDS = [
  0,
  100,
  300,
  500,
  800,
  1100,
  1500,
  2000,
  2500,
  3200,
];

export function getLevelFromExp(exp: number): number {
  for (let i = PET_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (exp >= PET_LEVEL_THRESHOLDS[i]) { return i + 1; }
  }
  return 1;
}

export function getExpForNextLevel(level: number): number {
  if (level >= PET_LEVEL_THRESHOLDS.length) { return Infinity; }
  return PET_LEVEL_THRESHOLDS[level];
}

export const PET_UNLOCK_LEVELS: Record<PetTypeId, number> = {
  dog: 1,
  fox: 1,
  'rubber-duck': 3,
  turtle: 3,
  crab: 5,
  clippy: 5,
  cockatiel: 8,
};

const VALID_PET_TYPES = Object.keys(PET_UNLOCK_LEVELS) as PetTypeId[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPetTypeId(value: unknown): value is PetTypeId {
  return typeof value === 'string' && (VALID_PET_TYPES as string[]).includes(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function isoOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== 'string') { return fallback; }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createDefaultSharedPetState(seed?: { petType?: PetTypeId; petName?: string }): PetState {
  const now = new Date().toISOString();
  return {
    petType: seed?.petType ?? 'dog',
    petName: seed?.petName?.trim() || '旺财',
    mood: 80,
    energy: 100,
    exp: 0,
    level: 1,
    totalWorkMinutes: 0,
    currentSessionStart: now,
    lastInteraction: now,
    unlockedPets: ['dog', 'fox'],
    streakDays: 0,
    miniGameStatsDate: localDateKey(),
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

export function getUnlockedPetsForLevel(level: number, currentPetType?: PetTypeId, currentUnlocked: unknown[] = []): PetTypeId[] {
  const unlocked = new Set<PetTypeId>(['dog', 'fox']);
  for (const petType of VALID_PET_TYPES) {
    if (level >= PET_UNLOCK_LEVELS[petType]) {
      unlocked.add(petType);
    }
  }
  for (const maybeType of currentUnlocked) {
    if (isPetTypeId(maybeType)) {
      unlocked.add(maybeType);
    }
  }
  if (currentPetType && isPetTypeId(currentPetType)) {
    unlocked.add(currentPetType);
  }
  return Array.from(unlocked);
}

export function normalizePetState(raw: unknown, seed?: { petType?: PetTypeId; petName?: string }): PetState | null {
  if (!isRecord(raw)) { return null; }
  const base = createDefaultSharedPetState(seed);
  const petType = isPetTypeId(raw.petType) ? raw.petType : base.petType;
  const petName = typeof raw.petName === 'string' && raw.petName.trim() ? raw.petName.trim() : base.petName;
  const exp = Math.max(0, finiteNumber(raw.exp, base.exp));
  const level = getLevelFromExp(Math.floor(exp));
  const widgetLeft = Number.isFinite(raw.widgetLeft) ? Number(raw.widgetLeft) : undefined;
  const widgetTop = Number.isFinite(raw.widgetTop) ? Number(raw.widgetTop) : undefined;
  const canvasPetLeft = Number.isFinite(raw.canvasPetLeft) ? Number(raw.canvasPetLeft) : undefined;
  const canvasPetTop = Number.isFinite(raw.canvasPetTop) ? Number(raw.canvasPetTop) : undefined;

  return {
    petType,
    petName,
    mood: clamp(finiteNumber(raw.mood, base.mood), 0, 100),
    energy: clamp(finiteNumber(raw.energy, base.energy), 0, 100),
    exp,
    level,
    totalWorkMinutes: Math.max(0, finiteNumber(raw.totalWorkMinutes, base.totalWorkMinutes)),
    currentSessionStart: isoOrFallback(raw.currentSessionStart, base.currentSessionStart),
    lastInteraction: isoOrFallback(raw.lastInteraction, base.lastInteraction),
    unlockedPets: getUnlockedPetsForLevel(
      level,
      petType,
      Array.isArray(raw.unlockedPets) ? raw.unlockedPets : [],
    ),
    streakDays: Math.max(0, Math.floor(finiteNumber(raw.streakDays, base.streakDays))),
    widgetAnchor: raw.widgetAnchor === 'top-left' || raw.widgetAnchor === 'top-right' || raw.widgetAnchor === 'bottom-left' || raw.widgetAnchor === 'bottom-right'
      ? raw.widgetAnchor
      : undefined,
    widgetOffsetX: Number.isFinite(raw.widgetOffsetX) ? Number(raw.widgetOffsetX) : undefined,
    widgetOffsetY: Number.isFinite(raw.widgetOffsetY) ? Number(raw.widgetOffsetY) : undefined,
    widgetLeft,
    widgetTop,
    canvasPetLeft,
    canvasPetTop,
    canvasPetManual: raw.canvasPetManual === true && canvasPetLeft !== undefined && canvasPetTop !== undefined,
    miniGameStatsDate: typeof raw.miniGameStatsDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.miniGameStatsDate)
      ? raw.miniGameStatsDate
      : base.miniGameStatsDate,
    snakeLastScore: Math.max(0, Math.floor(finiteNumber(raw.snakeLastScore, base.snakeLastScore ?? 0))),
    snakeBestScoreToday: Math.max(0, Math.floor(finiteNumber(raw.snakeBestScoreToday, base.snakeBestScoreToday ?? 0))),
    snakeBestScore: Math.max(0, Math.floor(finiteNumber(raw.snakeBestScore, base.snakeBestScore ?? 0))),
    snakeLastPlayedAt: isoOrFallback(raw.snakeLastPlayedAt, base.snakeLastPlayedAt ?? base.currentSessionStart),
    twenty48LastScore: Math.max(0, Math.floor(finiteNumber(raw.twenty48LastScore, base.twenty48LastScore ?? 0))),
    twenty48BestScoreToday: Math.max(0, Math.floor(finiteNumber(raw.twenty48BestScoreToday, base.twenty48BestScoreToday ?? 0))),
    twenty48BestScore: Math.max(0, Math.floor(finiteNumber(raw.twenty48BestScore, base.twenty48BestScore ?? 0))),
    twenty48LastPlayedAt: isoOrFallback(raw.twenty48LastPlayedAt, base.twenty48LastPlayedAt ?? base.currentSessionStart),
    sudokuLastScore: Math.max(0, Math.floor(finiteNumber(raw.sudokuLastScore, base.sudokuLastScore ?? 0))),
    sudokuBestScoreToday: Math.max(0, Math.floor(finiteNumber(raw.sudokuBestScoreToday, base.sudokuBestScoreToday ?? 0))),
    sudokuBestScore: Math.max(0, Math.floor(finiteNumber(raw.sudokuBestScore, base.sudokuBestScore ?? 0))),
    sudokuLastPlayedAt: isoOrFallback(raw.sudokuLastPlayedAt, base.sudokuLastPlayedAt ?? base.currentSessionStart),
    flappyLastScore: Math.max(0, Math.floor(finiteNumber(raw.flappyLastScore, base.flappyLastScore ?? 0))),
    flappyBestScoreToday: Math.max(0, Math.floor(finiteNumber(raw.flappyBestScoreToday, base.flappyBestScoreToday ?? 0))),
    flappyBestScore: Math.max(0, Math.floor(finiteNumber(raw.flappyBestScore, base.flappyBestScore ?? 0))),
    flappyLastPlayedAt: isoOrFallback(raw.flappyLastPlayedAt, base.flappyLastPlayedAt ?? base.currentSessionStart),
  };
}

export interface PetLevelProgress {
  level: number;
  totalExp: number;
  currentLevelBaseExp: number;
  nextLevelExp: number;
  currentLevelExp: number;
  neededExpInLevel: number;
  remainingToNextLevel: number;
  percent: number;
  isMaxLevel: boolean;
}

export function getPetLevelProgress(exp: number, explicitLevel?: number): PetLevelProgress {
  const totalExp = Math.max(0, exp);
  const level = explicitLevel ?? getLevelFromExp(Math.floor(totalExp));
  const currentLevelBaseExp = PET_LEVEL_THRESHOLDS[Math.max(0, level - 1)] ?? 0;
  const nextLevelExp = getExpForNextLevel(level);
  if (nextLevelExp === Infinity) {
    return {
      level,
      totalExp,
      currentLevelBaseExp,
      nextLevelExp,
      currentLevelExp: totalExp - currentLevelBaseExp,
      neededExpInLevel: 0,
      remainingToNextLevel: 0,
      percent: 100,
      isMaxLevel: true,
    };
  }

  const neededExpInLevel = Math.max(1, nextLevelExp - currentLevelBaseExp);
  const currentLevelExp = clamp(totalExp - currentLevelBaseExp, 0, neededExpInLevel);
  const remainingToNextLevel = Math.max(0, nextLevelExp - totalExp);

  return {
    level,
    totalExp,
    currentLevelBaseExp,
    nextLevelExp,
    currentLevelExp,
    neededExpInLevel,
    remainingToNextLevel,
    percent: clamp((currentLevelExp / neededExpInLevel) * 100, 0, 100),
    isMaxLevel: false,
  };
}
