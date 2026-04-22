export type SudokuDifficultyId = 'easy' | 'normal' | 'hard';
export type SudokuStatus = 'playing' | 'solved';

export interface SudokuSelection {
  row: number;
  col: number;
}

export interface SudokuGameState {
  puzzle: number[][];
  solution: number[][];
  entries: Array<Array<number | null>>;
  fixed: boolean[][];
  selected: SudokuSelection | null;
  status: SudokuStatus;
}

const SUDOKU_SIZE = 9;
const SUDOKU_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const BLANK_COUNT_BY_DIFFICULTY: Record<SudokuDifficultyId, number> = {
  easy: 30,
  normal: 42,
  hard: 52,
};

function pattern(row: number, col: number): number {
  return ((row * 3) + Math.floor(row / 3) + col) % SUDOKU_SIZE;
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
  }
  return next;
}

function buildSolvedBoard(): number[][] {
  const rowBands = shuffle([0, 1, 2]);
  const colBands = shuffle([0, 1, 2]);
  const rows = rowBands.flatMap(band => shuffle([0, 1, 2]).map(offset => band * 3 + offset));
  const cols = colBands.flatMap(band => shuffle([0, 1, 2]).map(offset => band * 3 + offset));
  const digits = shuffle(SUDOKU_DIGITS);

  return rows.map(row =>
    cols.map(col => digits[pattern(row, col)]!),
  );
}

function cloneBoard(board: number[][]): number[][] {
  return board.map(row => [...row]);
}

function buildPuzzle(solution: number[][], blankCount: number): number[][] {
  const puzzle = cloneBoard(solution);
  const indexes = shuffle(Array.from({ length: SUDOKU_SIZE * SUDOKU_SIZE }, (_, index) => index));
  for (let index = 0; index < Math.min(blankCount, indexes.length); index += 1) {
    const flatIndex = indexes[index]!;
    const row = Math.floor(flatIndex / SUDOKU_SIZE);
    const col = flatIndex % SUDOKU_SIZE;
    puzzle[row]![col] = 0;
  }
  return puzzle;
}

function isSolved(state: SudokuGameState): boolean {
  for (let row = 0; row < SUDOKU_SIZE; row += 1) {
    for (let col = 0; col < SUDOKU_SIZE; col += 1) {
      const value = state.fixed[row]![col]
        ? state.puzzle[row]![col]
        : state.entries[row]![col];
      if (value !== state.solution[row]![col]) {
        return false;
      }
    }
  }
  return true;
}

export function createInitialSudokuGame(difficulty: SudokuDifficultyId = 'easy'): SudokuGameState {
  const solution = buildSolvedBoard();
  const puzzle = buildPuzzle(solution, BLANK_COUNT_BY_DIFFICULTY[difficulty]);
  const fixed = puzzle.map(row => row.map(cell => cell !== 0));
  const entries = puzzle.map(row => row.map(cell => (cell === 0 ? null : cell)));
  return {
    puzzle,
    solution,
    fixed,
    entries,
    selected: { row: 0, col: 0 },
    status: 'playing',
  };
}

export function selectSudokuCell(state: SudokuGameState, row: number, col: number): SudokuGameState {
  if (row < 0 || row >= SUDOKU_SIZE || col < 0 || col >= SUDOKU_SIZE) {
    return state;
  }
  return { ...state, selected: { row, col } };
}

export function moveSudokuSelection(state: SudokuGameState, rowDelta: number, colDelta: number): SudokuGameState {
  const selected = state.selected ?? { row: 0, col: 0 };
  const nextRow = (selected.row + rowDelta + SUDOKU_SIZE) % SUDOKU_SIZE;
  const nextCol = (selected.col + colDelta + SUDOKU_SIZE) % SUDOKU_SIZE;
  return { ...state, selected: { row: nextRow, col: nextCol } };
}

export function inputSudokuDigit(state: SudokuGameState, digit: number | null): SudokuGameState {
  if (state.status !== 'playing' || !state.selected) { return state; }
  const { row, col } = state.selected;
  if (state.fixed[row]![col]) { return state; }
  if (digit !== null && (digit < 1 || digit > 9)) { return state; }

  const nextEntries = state.entries.map((entryRow, rowIndex) =>
    rowIndex === row
      ? entryRow.map((value, colIndex) => (colIndex === col ? digit : value))
      : [...entryRow],
  );
  const nextState: SudokuGameState = {
    ...state,
    entries: nextEntries,
  };
  if (isSolved(nextState)) {
    nextState.status = 'solved';
  }
  return nextState;
}

export function getSudokuCellValue(state: SudokuGameState, row: number, col: number): number | null {
  return state.fixed[row]![col] ? state.puzzle[row]![col]! : state.entries[row]![col];
}

export function isSudokuCellWrong(state: SudokuGameState, row: number, col: number): boolean {
  if (state.fixed[row]![col]) { return false; }
  const value = state.entries[row]![col];
  return value !== null && value !== state.solution[row]![col];
}

export function getSudokuScore(state: SudokuGameState, scoreWeight = 1): number {
  let correctEditableCells = 0;
  for (let row = 0; row < SUDOKU_SIZE; row += 1) {
    for (let col = 0; col < SUDOKU_SIZE; col += 1) {
      if (state.fixed[row]![col]) { continue; }
      if (state.entries[row]![col] === state.solution[row]![col]) {
        correctEditableCells += 1;
      }
    }
  }
  const solvedBonus = state.status === 'solved' ? 50 * scoreWeight : 0;
  return correctEditableCells * scoreWeight + solvedBonus;
}
