import { describe, expect, it } from 'vitest';
import { createInitialTwenty48Game, moveTwenty48Game } from '../../../webview/src/pet/twenty48-game';

describe('pet twenty48 game', () => {
  it('creates an initial board with two deterministic tiles', () => {
    const game = createInitialTwenty48Game(4, [
      { index: 0, value: 2 },
      { index: 3, value: 4 },
    ]);

    expect(game.board).toEqual([
      [2, 0, 0, 0],
      [4, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(game.score).toBe(0);
    expect(game.status).toBe('running');
  });

  it('merges tiles once per move and adds score', () => {
    const game = {
      size: 4,
      board: [
        [2, 2, 2, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      score: 0,
      status: 'running' as const,
    };

    const moved = moveTwenty48Game(game, 'left', { index: 1, value: 2 });

    expect(moved.board).toEqual([
      [4, 2, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(moved.score).toBe(4);
  });

  it('does not spawn or change score when the move is invalid', () => {
    const game = {
      size: 4,
      board: [
        [2, 4, 8, 16],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      score: 12,
      status: 'running' as const,
    };

    const moved = moveTwenty48Game(game, 'left', { index: 0, value: 4 });

    expect(moved).toEqual(game);
  });

  it('marks the game as won when 2048 appears', () => {
    const game = {
      size: 4,
      board: [
        [1024, 1024, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      score: 0,
      status: 'running' as const,
    };

    const moved = moveTwenty48Game(game, 'left', { index: 0, value: 2 });

    expect(moved.board[0]?.[0]).toBe(2048);
    expect(moved.status).toBe('won');
    expect(moved.score).toBe(2048);
  });

  it('marks the game as over when no moves remain', () => {
    const game = {
      size: 4,
      board: [
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [8, 16, 8, 16],
        [2, 4, 0, 2],
      ],
      score: 32,
      status: 'running' as const,
    };

    const moved = moveTwenty48Game(game, 'left', { index: 0, value: 32 });

    expect(moved.board).toEqual([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [8, 16, 8, 16],
      [2, 4, 2, 32],
    ]);
    expect(moved.status).toBe('game_over');
    expect(moved.score).toBe(32);
  });
});
