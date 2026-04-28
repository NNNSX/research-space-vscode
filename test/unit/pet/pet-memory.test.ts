import { mkdtemp, readFile, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback: unknown) => fallback,
    }),
  },
}));

import {
  appendPetMemoryRecord,
  clearPetLongTermMemory,
  pruneExpiredPetMemoryRecords,
  readPetMemoryRecords,
  readPetProfile,
  updatePetProfileFromSnapshot,
  writePetMemoryMarkdown,
} from '../../../src/pet/pet-memory';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rs-pet-memory-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('pet memory files', () => {
  it('updates lightweight profile without source document content', async () => {
    await updatePetProfileFromSnapshot(dir, {
      frequentEventTypes: ['node_added', 'tool_run_completed', 123],
      suggestionActivity: 'quiet',
      displayMode: 'canvas-follow',
    });

    const profile = await readPetProfile(dir);
    expect(profile).toMatchObject({
      version: 1,
      frequentEventTypes: ['node_added', 'tool_run_completed'],
      frequentNodeTypes: [],
      frequentTools: [],
      frequentScenes: [],
      suggestionStats: { shown: 0, accepted: 0, later: 0, muted: 0 },
      suggestionActivity: 'quiet',
      displayMode: 'canvas-follow',
    });
  });

  it('merges learned node, tool, scene and suggestion stats into profile', async () => {
    await updatePetProfileFromSnapshot(dir, {
      frequentNodeTypes: ['paper', 'mindmap'],
      frequentTools: ['文献综述'],
      frequentScenes: ['paper'],
      suggestionStats: { shown: 2, accepted: 1, later: 1, muted: 0 },
    });
    await updatePetProfileFromSnapshot(dir, {
      frequentNodeTypes: ['ai_output'],
      frequentTools: ['润色'],
      frequentScenes: ['proposal'],
      suggestionStats: { shown: 3, accepted: 2, muted: 1 },
    });

    const profile = await readPetProfile(dir);
    expect(profile.frequentNodeTypes).toEqual(['paper', 'mindmap', 'ai_output']);
    expect(profile.frequentTools).toEqual(['文献综述', '润色']);
    expect(profile.frequentScenes).toEqual(['paper', 'proposal']);
    expect(profile.suggestionStats).toEqual({ shown: 5, accepted: 3, later: 1, muted: 1 });
  });

  it('appends normalized jsonl memory records and clears long-term memory files', async () => {
    await writePetMemoryMarkdown(dir, '# 宠物记忆');
    await appendPetMemoryRecord(dir, {
      id: 'm1',
      type: 'session',
      importance: 9,
      text: '本次会话 30 分钟。',
    });

    const jsonl = await readFile(path.join(dir, 'pet', 'memory.jsonl'), 'utf-8');
    const record = JSON.parse(jsonl.trim());
    expect(record).toMatchObject({ id: 'm1', type: 'session', importance: 5, text: '本次会话 30 分钟。' });

    await clearPetLongTermMemory(dir);
    await expect(readFile(path.join(dir, 'pet', 'memory.jsonl'), 'utf-8')).rejects.toThrow();
    await expect(readFile(path.join(dir, 'pet', 'memory.md'), 'utf-8')).rejects.toThrow();
  });

  it('prunes expired jsonl records from memory summary', async () => {
    await appendPetMemoryRecord(dir, {
      id: 'old',
      type: 'session',
      importance: 2,
      text: '已过期',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    await appendPetMemoryRecord(dir, {
      id: 'new',
      type: 'session',
      importance: 2,
      text: '仍有效',
      expiresAt: '2999-01-01T00:00:00.000Z',
    });

    expect(await pruneExpiredPetMemoryRecords(dir)).toBe(1);
    const records = await readPetMemoryRecords(dir);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('new');
  });
});
