export type SnakeDirection = 'up' | 'down' | 'left' | 'right';
export type SnakeGameStatus = 'running' | 'game_over';

export interface SnakePoint {
  x: number;
  y: number;
}

export interface SnakeGameState {
  width: number;
  height: number;
  snake: SnakePoint[];
  direction: SnakeDirection;
  food: SnakePoint;
  score: number;
  status: SnakeGameStatus;
}

function directionsAreOpposite(current: SnakeDirection, next: SnakeDirection): boolean {
  return (
    (current === 'up' && next === 'down') ||
    (current === 'down' && next === 'up') ||
    (current === 'left' && next === 'right') ||
    (current === 'right' && next === 'left')
  );
}

function getNextHead(head: SnakePoint, direction: SnakeDirection): SnakePoint {
  switch (direction) {
    case 'up':
      return { x: head.x, y: head.y - 1 };
    case 'down':
      return { x: head.x, y: head.y + 1 };
    case 'left':
      return { x: head.x - 1, y: head.y };
    case 'right':
    default:
      return { x: head.x + 1, y: head.y };
  }
}

function getDefaultFood(width: number, height: number, snake: SnakePoint[]): SnakePoint {
  const emptyCells: SnakePoint[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!snake.some(segment => segment.x === x && segment.y === y)) {
        emptyCells.push({ x, y });
      }
    }
  }
  if (emptyCells.length === 0) {
    return { x: 0, y: 0 };
  }
  const randomIndex = Math.min(
    emptyCells.length - 1,
    Math.floor(Math.random() * emptyCells.length),
  );
  return emptyCells[randomIndex]!;
}

export function createInitialSnakeGame(width = 12, height = 12): SnakeGameState {
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const snake = [
    { x: centerX, y: centerY },
    { x: centerX - 1, y: centerY },
    { x: centerX - 2, y: centerY },
  ];

  return {
    width,
    height,
    snake,
    direction: 'right',
    food: getDefaultFood(width, height, snake),
    score: 0,
    status: 'running',
  };
}

export function turnSnakeDirection(state: SnakeGameState, nextDirection: SnakeDirection): SnakeGameState {
  if (state.status !== 'running') { return state; }
  if (directionsAreOpposite(state.direction, nextDirection)) { return state; }
  if (state.direction === nextDirection) { return state; }
  return { ...state, direction: nextDirection };
}

export function advanceSnakeGame(
  state: SnakeGameState,
  nextFoodOverride?: SnakePoint,
): SnakeGameState {
  if (state.status !== 'running') { return state; }

  const currentHead = state.snake[0];
  if (!currentHead) { return { ...state, status: 'game_over' }; }

  const nextHead = getNextHead(currentHead, state.direction);
  const hitWall = nextHead.x < 0 || nextHead.x >= state.width || nextHead.y < 0 || nextHead.y >= state.height;
  if (hitWall) {
    return { ...state, status: 'game_over' };
  }

  const ateFood = nextHead.x === state.food.x && nextHead.y === state.food.y;
  const bodyToCheck = ateFood ? state.snake : state.snake.slice(0, -1);
  const hitSelf = bodyToCheck.some(segment => segment.x === nextHead.x && segment.y === nextHead.y);
  if (hitSelf) {
    return { ...state, status: 'game_over' };
  }

  const nextSnake = ateFood
    ? [nextHead, ...state.snake]
    : [nextHead, ...state.snake.slice(0, -1)];

  const nextFood = ateFood
    ? (nextFoodOverride ?? getDefaultFood(state.width, state.height, nextSnake))
    : state.food;

  return {
    ...state,
    snake: nextSnake,
    food: nextFood,
    score: ateFood ? state.score + 1 : state.score,
  };
}
