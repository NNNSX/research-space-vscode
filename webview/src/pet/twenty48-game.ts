export type Twenty48Direction = 'up' | 'down' | 'left' | 'right';
export type Twenty48Status = 'running' | 'won' | 'game_over';

export interface Twenty48Spawn {
  index: number;
  value?: 2 | 4;
}

export interface Twenty48GameState {
  size: number;
  board: number[][];
  score: number;
  status: Twenty48Status;
}

function cloneBoard(board: number[][]): number[][] {
  return board.map(row => [...row]);
}

function createEmptyBoard(size: number): number[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
}

function getEmptyCells(board: number[][]): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board[y]!.length; x += 1) {
      if (board[y]![x] === 0) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

function addRandomTile(board: number[][], spawn?: Twenty48Spawn): number[][] {
  const emptyCells = getEmptyCells(board);
  if (emptyCells.length === 0) { return board; }

  const selected = spawn
    ? emptyCells[Math.max(0, Math.min(emptyCells.length - 1, spawn.index))]
    : emptyCells[Math.floor(Math.random() * emptyCells.length)];
  if (!selected) { return board; }

  const next = cloneBoard(board);
  next[selected.y]![selected.x] = spawn?.value ?? (Math.random() < 0.9 ? 2 : 4);
  return next;
}

function slideRowLeft(row: number[]): { row: number[]; scoreGained: number; moved: boolean } {
  const compressed = row.filter(value => value !== 0);
  const merged: number[] = [];
  let scoreGained = 0;

  for (let index = 0; index < compressed.length; index += 1) {
    const current = compressed[index]!;
    const next = compressed[index + 1];
    if (next !== undefined && next === current) {
      const mergedValue = current * 2;
      merged.push(mergedValue);
      scoreGained += mergedValue;
      index += 1;
      continue;
    }
    merged.push(current);
  }

  while (merged.length < row.length) {
    merged.push(0);
  }

  return {
    row: merged,
    scoreGained,
    moved: merged.some((value, index) => value !== row[index]),
  };
}

function transpose(board: number[][]): number[][] {
  return board[0]!.map((_, colIndex) => board.map(row => row[colIndex]!));
}

function reverseRows(board: number[][]): number[][] {
  return board.map(row => [...row].reverse());
}

function normalizeBoardForDirection(board: number[][], direction: Twenty48Direction): number[][] {
  if (direction === 'left') { return cloneBoard(board); }
  if (direction === 'right') { return reverseRows(board); }
  if (direction === 'up') { return transpose(board); }
  return reverseRows(transpose(board));
}

function denormalizeBoardFromDirection(board: number[][], direction: Twenty48Direction): number[][] {
  if (direction === 'left') { return cloneBoard(board); }
  if (direction === 'right') { return reverseRows(board); }
  if (direction === 'up') { return transpose(board); }
  return transpose(reverseRows(board));
}

function has2048(board: number[][]): boolean {
  return board.some(row => row.some(value => value >= 2048));
}

function hasAvailableMoves(board: number[][]): boolean {
  if (getEmptyCells(board).length > 0) { return true; }
  const size = board.length;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = board[y]![x]!;
      if ((x + 1 < size && board[y]![x + 1] === value) || (y + 1 < size && board[y + 1]![x] === value)) {
        return true;
      }
    }
  }
  return false;
}

function resolveStatus(board: number[][]): Twenty48Status {
  if (has2048(board)) { return 'won'; }
  return hasAvailableMoves(board) ? 'running' : 'game_over';
}

export function createInitialTwenty48Game(size = 4, spawns: Twenty48Spawn[] = []): Twenty48GameState {
  let board = createEmptyBoard(size);
  board = addRandomTile(board, spawns[0]);
  board = addRandomTile(board, spawns[1]);
  return {
    size,
    board,
    score: 0,
    status: resolveStatus(board),
  };
}

export function moveTwenty48Game(
  state: Twenty48GameState,
  direction: Twenty48Direction,
  spawn?: Twenty48Spawn,
): Twenty48GameState {
  if (state.status !== 'running') { return state; }

  const normalized = normalizeBoardForDirection(state.board, direction);
  let moved = false;
  let scoreGained = 0;
  const movedBoard = normalized.map(row => {
    const result = slideRowLeft(row);
    moved = moved || result.moved;
    scoreGained += result.scoreGained;
    return result.row;
  });

  if (!moved) { return state; }

  const denormalized = denormalizeBoardFromDirection(movedBoard, direction);
  const withSpawn = addRandomTile(denormalized, spawn);

  return {
    ...state,
    board: withSpawn,
    score: state.score + scoreGained,
    status: resolveStatus(withSpawn),
  };
}
