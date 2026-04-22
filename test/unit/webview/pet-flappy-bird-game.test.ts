import { describe, expect, it } from 'vitest';
import {
  FLAPPY_BIRD_DIFFICULTIES,
  advanceFlappyBirdGame,
  createInitialFlappyBirdGame,
  flapFlappyBird,
} from '../../../webview/src/pet/flappy-bird-game';

describe('pet flappy bird game', () => {
  it('starts in waiting state until the player flaps', () => {
    const game = createInitialFlappyBirdGame('easy', 268, 188);
    const started = flapFlappyBird(game, 'easy');

    expect(game.status).toBe('waiting');
    expect(started.status).toBe('running');
    expect(started.birdVelocity).toBe(FLAPPY_BIRD_DIFFICULTIES.easy.flapVelocity);
  });

  it('increments score after the bird clears a pipe', () => {
    const game = {
      ...createInitialFlappyBirdGame('easy', 268, 188),
      status: 'running' as const,
      birdY: 96,
      birdVelocity: 0,
      score: 0,
      pipes: [{ x: 40, gapY: 96, passed: false }],
    };

    const next = advanceFlappyBirdGame(game, {
      ...FLAPPY_BIRD_DIFFICULTIES.easy,
      pipeSpeed: 12,
      gravity: 0,
    });

    expect(next.score).toBe(1);
    expect(next.pipes[0]?.passed).toBe(true);
  });

  it('ends the game when the bird hits a pipe', () => {
    const game = {
      ...createInitialFlappyBirdGame('normal', 268, 188),
      status: 'running' as const,
      birdY: 40,
      birdVelocity: 0,
      pipes: [{ x: 60, gapY: 130, passed: false }],
    };

    const next = advanceFlappyBirdGame(game, {
      ...FLAPPY_BIRD_DIFFICULTIES.normal,
      gravity: 0,
      pipeSpeed: 0,
    });

    expect(next.status).toBe('game_over');
  });

  it('ends the game when the bird hits the boundary', () => {
    const game = {
      ...createInitialFlappyBirdGame('hard', 268, 188),
      status: 'running' as const,
      birdY: 12,
      birdVelocity: -4,
    };

    const next = advanceFlappyBirdGame(game, 'hard');

    expect(next.status).toBe('game_over');
  });
});
