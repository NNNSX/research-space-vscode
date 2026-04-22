export type FlappyBirdDifficultyId = 'easy' | 'normal' | 'hard';
export type FlappyBirdStatus = 'waiting' | 'running' | 'game_over';

export interface FlappyBirdPipe {
  x: number;
  gapY: number;
  passed: boolean;
}

export interface FlappyBirdDifficultyDef {
  label: string;
  tickMs: number;
  gravity: number;
  flapVelocity: number;
  pipeSpeed: number;
  pipeGap: number;
  spawnDistance: number;
  scoreWeight: number;
}

export interface FlappyBirdGameState {
  width: number;
  height: number;
  birdX: number;
  birdY: number;
  birdVelocity: number;
  birdSize: number;
  pipeWidth: number;
  pipes: FlappyBirdPipe[];
  score: number;
  status: FlappyBirdStatus;
  tick: number;
}

export const FLAPPY_BIRD_DIFFICULTIES: Record<FlappyBirdDifficultyId, FlappyBirdDifficultyDef> = {
  easy: {
    label: '轻松',
    tickMs: 24,
    gravity: 0.46,
    flapVelocity: -5.9,
    pipeSpeed: 2.9,
    pipeGap: 92,
    spawnDistance: 150,
    scoreWeight: 1,
  },
  normal: {
    label: '标准',
    tickMs: 18,
    gravity: 0.54,
    flapVelocity: -6.2,
    pipeSpeed: 3.7,
    pipeGap: 82,
    spawnDistance: 144,
    scoreWeight: 2,
  },
  hard: {
    label: '挑战',
    tickMs: 14,
    gravity: 0.62,
    flapVelocity: -6.5,
    pipeSpeed: 4.5,
    pipeGap: 72,
    spawnDistance: 138,
    scoreWeight: 3,
  },
};

function getDifficultyDef(difficulty: FlappyBirdDifficultyId | FlappyBirdDifficultyDef = 'normal'): FlappyBirdDifficultyDef {
  return typeof difficulty === 'string' ? FLAPPY_BIRD_DIFFICULTIES[difficulty] : difficulty;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createPipe(
  width: number,
  height: number,
  difficulty: FlappyBirdDifficultyDef,
  x = width + 36,
): FlappyBirdPipe {
  const margin = difficulty.pipeGap / 2 + 22;
  const minGapY = margin;
  const maxGapY = Math.max(minGapY, height - margin);
  return {
    x,
    gapY: clamp(minGapY + Math.random() * (maxGapY - minGapY), minGapY, maxGapY),
    passed: false,
  };
}

export function createInitialFlappyBirdGame(
  difficulty: FlappyBirdDifficultyId | FlappyBirdDifficultyDef = 'normal',
  width = 268,
  height = 188,
): FlappyBirdGameState {
  const difficultyDef = getDifficultyDef(difficulty);
  return {
    width,
    height,
    birdX: 72,
    birdY: Math.round(height * 0.46),
    birdVelocity: 0,
    birdSize: 22,
    pipeWidth: 42,
    pipes: [createPipe(width, height, difficultyDef)],
    score: 0,
    status: 'waiting',
    tick: 0,
  };
}

function collidesWithPipe(state: FlappyBirdGameState, pipe: FlappyBirdPipe, difficulty: FlappyBirdDifficultyDef): boolean {
  const halfBird = state.birdSize / 2;
  const birdLeft = state.birdX - halfBird;
  const birdRight = state.birdX + halfBird;
  const pipeLeft = pipe.x;
  const pipeRight = pipe.x + state.pipeWidth;
  if (birdRight <= pipeLeft || birdLeft >= pipeRight) {
    return false;
  }
  const gapTop = pipe.gapY - difficulty.pipeGap / 2;
  const gapBottom = pipe.gapY + difficulty.pipeGap / 2;
  const birdTop = state.birdY - halfBird;
  const birdBottom = state.birdY + halfBird;
  return birdTop < gapTop || birdBottom > gapBottom;
}

export function flapFlappyBird(
  state: FlappyBirdGameState,
  difficulty: FlappyBirdDifficultyId | FlappyBirdDifficultyDef = 'normal',
): FlappyBirdGameState {
  if (state.status === 'game_over') {
    return state;
  }
  const difficultyDef = getDifficultyDef(difficulty);
  return {
    ...state,
    status: 'running',
    birdVelocity: difficultyDef.flapVelocity,
  };
}

export function advanceFlappyBirdGame(
  state: FlappyBirdGameState,
  difficulty: FlappyBirdDifficultyId | FlappyBirdDifficultyDef = 'normal',
): FlappyBirdGameState {
  if (state.status !== 'running') {
    return state;
  }

  const difficultyDef = getDifficultyDef(difficulty);
  const nextTick = state.tick + 1;
  const nextVelocity = state.birdVelocity + difficultyDef.gravity;
  const nextBirdY = state.birdY + nextVelocity;
  const halfBird = state.birdSize / 2;

  if (nextBirdY - halfBird <= 0 || nextBirdY + halfBird >= state.height) {
    return {
      ...state,
      birdY: clamp(nextBirdY, halfBird, state.height - halfBird),
      birdVelocity: nextVelocity,
      tick: nextTick,
      status: 'game_over',
    };
  }

  let scored = 0;
  const nextPipes = state.pipes
    .map(pipe => {
      const nextPipe = { ...pipe, x: pipe.x - difficultyDef.pipeSpeed };
      if (!nextPipe.passed && nextPipe.x + state.pipeWidth < state.birdX) {
        nextPipe.passed = true;
        scored += 1;
      }
      return nextPipe;
    })
    .filter(pipe => pipe.x + state.pipeWidth > -12);

  const lastPipe = nextPipes[nextPipes.length - 1];
  if (!lastPipe || lastPipe.x <= state.width - difficultyDef.spawnDistance) {
    nextPipes.push(createPipe(state.width, state.height, difficultyDef));
  }

  const nextState: FlappyBirdGameState = {
    ...state,
    birdY: nextBirdY,
    birdVelocity: nextVelocity,
    pipes: nextPipes,
    score: state.score + scored,
    tick: nextTick,
  };

  if (nextPipes.some(pipe => collidesWithPipe(nextState, pipe, difficultyDef))) {
    return {
      ...nextState,
      status: 'game_over',
    };
  }

  return nextState;
}
