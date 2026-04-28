import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { PetState } from '../core/canvas-model';
import { normalizePetState } from '../core/pet-state';

const PET_DIR = 'pet';
const STATE_FILE = 'state.json';
const PROFILE_FILE = 'profile.json';
const MEMORY_FILE = 'memory.jsonl';
const MEMORY_MD_FILE = 'memory.md';

export interface PetUserProfile {
  version: 1;
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
  updatedAt: string;
}

export interface PetMemoryRecord {
  id: string;
  createdAt: string;
  type: 'event' | 'insight' | 'preference' | 'milestone' | 'session';
  importance: 1 | 2 | 3 | 4 | 5;
  text: string;
  expiresAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) { return []; }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 24);
}

function normalizePetProfile(raw: unknown): PetUserProfile {
  const now = new Date().toISOString();
  if (!isRecord(raw)) {
    return {
      version: 1,
      frequentEventTypes: [],
      frequentNodeTypes: [],
      frequentTools: [],
      frequentScenes: [],
      suggestionStats: { shown: 0, accepted: 0, later: 0, muted: 0 },
      suggestionActivity: 'balanced',
      displayMode: 'panel',
      updatedAt: now,
    };
  }
  const stats = isRecord(raw.suggestionStats) ? raw.suggestionStats : {};
  return {
    version: 1,
    frequentEventTypes: safeStringArray(raw.frequentEventTypes),
    frequentNodeTypes: safeStringArray(raw.frequentNodeTypes),
    frequentTools: safeStringArray(raw.frequentTools),
    frequentScenes: safeStringArray(raw.frequentScenes),
    suggestionStats: {
      shown: Math.max(0, Math.floor(Number(stats.shown) || 0)),
      accepted: Math.max(0, Math.floor(Number(stats.accepted) || 0)),
      later: Math.max(0, Math.floor(Number(stats.later) || 0)),
      muted: Math.max(0, Math.floor(Number(stats.muted) || 0)),
    },
    suggestionActivity: typeof raw.suggestionActivity === 'string' ? raw.suggestionActivity : 'balanced',
    displayMode: typeof raw.displayMode === 'string' ? raw.displayMode : 'panel',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

function mergeRecentStrings(...groups: string[][]): string[] {
  const merged = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      const normalized = item.trim();
      if (normalized) { merged.add(normalized); }
    }
  }
  return Array.from(merged).slice(-24);
}

function normalizeSuggestionStats(value: unknown): PetUserProfile['suggestionStats'] {
  if (!isRecord(value)) { return { shown: 0, accepted: 0, later: 0, muted: 0 }; }
  return {
    shown: Math.max(0, Math.floor(Number(value.shown) || 0)),
    accepted: Math.max(0, Math.floor(Number(value.accepted) || 0)),
    later: Math.max(0, Math.floor(Number(value.later) || 0)),
    muted: Math.max(0, Math.floor(Number(value.muted) || 0)),
  };
}

function normalizeMemoryRecord(raw: unknown): PetMemoryRecord | null {
  if (!isRecord(raw)) { return null; }
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 500) : '';
  if (!text) { return null; }
  const type = raw.type === 'event' || raw.type === 'insight' || raw.type === 'preference' || raw.type === 'milestone' || raw.type === 'session'
    ? raw.type
    : 'session';
  const importanceRaw = Number(raw.importance);
  const importance = Math.max(1, Math.min(5, Number.isFinite(importanceRaw) ? Math.floor(importanceRaw) : 2)) as PetMemoryRecord['importance'];
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `mem-${Date.now()}`,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    type,
    importance,
    text,
    ...(typeof raw.expiresAt === 'string' ? { expiresAt: raw.expiresAt } : {}),
  };
}

function isExpired(record: PetMemoryRecord, nowMs = Date.now()): boolean {
  if (!record.expiresAt) { return false; }
  const expiresAt = Date.parse(record.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= nowMs;
}

/**
 * Read the persisted pet state from pet/state.json in the canvas directory.
 * Returns null if file doesn't exist.
 */
export async function readPetState(canvasDir: string): Promise<PetState | null> {
  const filePath = path.join(canvasDir, PET_DIR, STATE_FILE);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return normalizePetState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Write pet state to pet/state.json, creating the directory if needed.
 */
export async function writePetState(canvasDir: string, state: unknown): Promise<void> {
  const dir = path.join(canvasDir, PET_DIR);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, STATE_FILE);
    const normalized = normalizePetState(state);
    if (!normalized) { return; }
    await fs.promises.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
  } catch (err) {
    console.error('[PetMemory] Failed to write state:', err);
  }
}

export async function readPetProfile(canvasDir: string): Promise<PetUserProfile> {
  const filePath = path.join(canvasDir, PET_DIR, PROFILE_FILE);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return normalizePetProfile(JSON.parse(raw));
  } catch {
    return normalizePetProfile(null);
  }
}

export async function writePetProfile(canvasDir: string, profile: PetUserProfile): Promise<void> {
  const dir = path.join(canvasDir, PET_DIR);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, PROFILE_FILE), JSON.stringify(normalizePetProfile(profile), null, 2), 'utf-8');
}

export async function updatePetProfileFromSnapshot(
  canvasDir: string,
  snapshot: {
    frequentEventTypes?: unknown;
    frequentNodeTypes?: unknown;
    frequentTools?: unknown;
    frequentScenes?: unknown;
    suggestionStats?: unknown;
    suggestionActivity?: unknown;
    displayMode?: unknown;
  },
): Promise<PetUserProfile> {
  const current = await readPetProfile(canvasDir);
  const incomingStats = normalizeSuggestionStats(snapshot.suggestionStats);
  const next = normalizePetProfile({
    ...current,
    frequentEventTypes: mergeRecentStrings(current.frequentEventTypes, safeStringArray(snapshot.frequentEventTypes)),
    frequentNodeTypes: mergeRecentStrings(current.frequentNodeTypes, safeStringArray(snapshot.frequentNodeTypes)),
    frequentTools: mergeRecentStrings(current.frequentTools, safeStringArray(snapshot.frequentTools)),
    frequentScenes: mergeRecentStrings(current.frequentScenes, safeStringArray(snapshot.frequentScenes)),
    suggestionStats: {
      shown: current.suggestionStats.shown + incomingStats.shown,
      accepted: current.suggestionStats.accepted + incomingStats.accepted,
      later: current.suggestionStats.later + incomingStats.later,
      muted: current.suggestionStats.muted + incomingStats.muted,
    },
    suggestionActivity: typeof snapshot.suggestionActivity === 'string' ? snapshot.suggestionActivity : current.suggestionActivity,
    displayMode: typeof snapshot.displayMode === 'string' ? snapshot.displayMode : current.displayMode,
    updatedAt: new Date().toISOString(),
  });
  await writePetProfile(canvasDir, next);
  return next;
}

export async function appendPetMemoryRecord(canvasDir: string, rawRecord: unknown): Promise<void> {
  const record = normalizeMemoryRecord(rawRecord);
  if (!record) { return; }
  const dir = path.join(canvasDir, PET_DIR);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.appendFile(path.join(dir, MEMORY_FILE), `${JSON.stringify(record)}\n`, 'utf-8');
}

export async function readPetMemoryRecords(canvasDir: string, limit = 20): Promise<PetMemoryRecord[]> {
  const filePath = path.join(canvasDir, PET_DIR, MEMORY_FILE);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const records = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try { return normalizeMemoryRecord(JSON.parse(line)); }
        catch { return null; }
      })
      .filter((record): record is PetMemoryRecord => !!record && !isExpired(record));
    return records.slice(-Math.max(1, limit));
  } catch {
    return [];
  }
}

export async function pruneExpiredPetMemoryRecords(canvasDir: string): Promise<number> {
  const filePath = path.join(canvasDir, PET_DIR, MEMORY_FILE);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const all = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try { return normalizeMemoryRecord(JSON.parse(line)); }
        catch { return null; }
      })
      .filter((record): record is PetMemoryRecord => !!record);
    const kept = all.filter(record => !isExpired(record));
    if (kept.length !== all.length) {
      await fs.promises.writeFile(filePath, kept.map(record => JSON.stringify(record)).join('\n') + (kept.length ? '\n' : ''), 'utf-8');
    }
    return all.length - kept.length;
  } catch {
    return 0;
  }
}

export async function readPetMemorySummary(canvasDir: string): Promise<{ profile: PetUserProfile; records: PetMemoryRecord[] }> {
  await pruneExpiredPetMemoryRecords(canvasDir);
  const [profile, records] = await Promise.all([
    readPetProfile(canvasDir),
    readPetMemoryRecords(canvasDir, 12),
  ]);
  return { profile, records };
}

export async function writePetMemoryMarkdown(canvasDir: string, content: string): Promise<void> {
  const dir = path.join(canvasDir, PET_DIR);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, MEMORY_MD_FILE), content, 'utf-8');
}

export async function clearPetLongTermMemory(canvasDir: string): Promise<void> {
  const dir = path.join(canvasDir, PET_DIR);
  await Promise.all([
    fs.promises.rm(path.join(dir, PROFILE_FILE), { force: true }),
    fs.promises.rm(path.join(dir, MEMORY_FILE), { force: true }),
    fs.promises.rm(path.join(dir, MEMORY_MD_FILE), { force: true }),
  ]);
}

/**
 * Read pet settings from VSCode configuration.
 */
export function readPetSettings(): {
  enabled: boolean;
  petType: string;
  petName: string;
  restReminderMin: number;
  groundTheme: string;
  suggestionActivity: string;
  displayMode: string;
  longTermMemory: boolean;
} {
  const cfg = vscode.workspace.getConfiguration('researchSpace.pet');
  return {
    enabled: cfg.get<boolean>('enabled', false),
    petType: cfg.get<string>('type', 'dog'),
    petName: cfg.get<string>('name', ''),
    restReminderMin: cfg.get<number>('restReminder', 45),
    groundTheme: cfg.get<string>('groundTheme', 'forest'),
    suggestionActivity: cfg.get<string>('suggestionActivity', 'balanced'),
    displayMode: cfg.get<string>('displayMode', 'panel'),
    longTermMemory: cfg.get<boolean>('longTermMemory', true),
  };
}

/**
 * Send pet init data to webview after canvas is ready.
 */
export async function sendPetInit(
  panel: vscode.WebviewPanel | { webview: vscode.Webview },
  canvasDir: string,
): Promise<void> {
  const settings = readPetSettings();
  const petState = await readPetState(canvasDir);

  (panel as any).webview.postMessage({
    type: 'petInit',
    petState,
    petEnabled: settings.enabled,
    restReminderMin: settings.restReminderMin,
    suggestionActivity: settings.suggestionActivity,
    displayMode: settings.displayMode,
    longTermMemory: settings.longTermMemory,
  });
}
