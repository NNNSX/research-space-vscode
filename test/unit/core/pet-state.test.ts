import { describe, expect, it } from 'vitest';
import { createDefaultSharedPetState, normalizePetState } from '../../../src/core/pet-state';

describe('pet state mini-game stats', () => {
  it('creates default mini-game stats fields', () => {
    const state = createDefaultSharedPetState();

    expect(state.miniGameStatsDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state.snakeLastScore).toBe(0);
    expect(state.snakeBestScoreToday).toBe(0);
    expect(state.snakeBestScore).toBe(0);
    expect(state.snakeLastPlayedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.twenty48LastScore).toBe(0);
    expect(state.twenty48BestScoreToday).toBe(0);
    expect(state.twenty48BestScore).toBe(0);
    expect(state.twenty48LastPlayedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.sudokuLastScore).toBe(0);
    expect(state.sudokuBestScoreToday).toBe(0);
    expect(state.sudokuBestScore).toBe(0);
    expect(state.sudokuLastPlayedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.flappyLastScore).toBe(0);
    expect(state.flappyBestScoreToday).toBe(0);
    expect(state.flappyBestScore).toBe(0);
    expect(state.flappyLastPlayedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('normalizes persisted mini-game stats defensively', () => {
    const state = normalizePetState({
      petType: 'dog',
      petName: '旺财',
      miniGameStatsDate: '2026-04-22',
      snakeLastScore: 12.7,
      snakeBestScoreToday: 21.4,
      snakeBestScore: -3,
      snakeLastPlayedAt: '2026-04-22T09:30:00.000Z',
      twenty48LastScore: 256.4,
      twenty48BestScoreToday: -8,
      twenty48BestScore: 1024.8,
      twenty48LastPlayedAt: 'bad-date',
      sudokuLastScore: 88.8,
      sudokuBestScoreToday: 120.4,
      sudokuBestScore: -2,
      sudokuLastPlayedAt: '2026-04-22T11:00:00.000Z',
      flappyLastScore: 14.9,
      flappyBestScoreToday: 18.2,
      flappyBestScore: -1,
      flappyLastPlayedAt: 'bad-date',
    });

    expect(state).toMatchObject({
      miniGameStatsDate: '2026-04-22',
      snakeLastScore: 12,
      snakeBestScoreToday: 21,
      snakeBestScore: 0,
      snakeLastPlayedAt: '2026-04-22T09:30:00.000Z',
      twenty48LastScore: 256,
      twenty48BestScoreToday: 0,
      twenty48BestScore: 1024,
      sudokuLastScore: 88,
      sudokuBestScoreToday: 120,
      sudokuBestScore: 0,
      sudokuLastPlayedAt: '2026-04-22T11:00:00.000Z',
      flappyLastScore: 14,
      flappyBestScoreToday: 18,
      flappyBestScore: 0,
    });
    expect(state?.twenty48LastPlayedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state?.flappyLastPlayedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
