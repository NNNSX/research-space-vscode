import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceSnakeGame, createInitialSnakeGame, turnSnakeDirection } from '../../../webview/src/pet/snake-game';

describe('pet snake game', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('moves forward one cell on each tick', () => {
    const game = createInitialSnakeGame(12, 12);
    const advanced = advanceSnakeGame(game);

    expect(advanced.snake[0]).toEqual({ x: game.snake[0]!.x + 1, y: game.snake[0]!.y });
    expect(advanced.snake).toHaveLength(game.snake.length);
    expect(advanced.score).toBe(0);
    expect(advanced.status).toBe('running');
  });

  it('rejects direct reverse turns', () => {
    const game = createInitialSnakeGame(12, 12);
    const turned = turnSnakeDirection(game, 'left');

    expect(turned.direction).toBe('right');
  });

  it('grows and increments score after eating food', () => {
    const game = createInitialSnakeGame(12, 12);
    const head = game.snake[0]!;
    const withFoodAhead = {
      ...game,
      food: { x: head.x + 1, y: head.y },
    };

    const advanced = advanceSnakeGame(withFoodAhead, { x: 0, y: 0 });

    expect(advanced.snake).toHaveLength(game.snake.length + 1);
    expect(advanced.score).toBe(1);
    expect(advanced.food).toEqual({ x: 0, y: 0 });
  });

  it('ends the game when the snake hits a wall', () => {
    const game = createInitialSnakeGame(4, 4);
    const crashing = {
      ...game,
      snake: [{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }],
      direction: 'right' as const,
    };

    const advanced = advanceSnakeGame(crashing);

    expect(advanced.status).toBe('game_over');
  });

  it('chooses food from empty cells randomly instead of always taking the first slot', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const game = createInitialSnakeGame(4, 4);

    expect(game.food).toEqual({ x: 3, y: 3 });
  });
});
