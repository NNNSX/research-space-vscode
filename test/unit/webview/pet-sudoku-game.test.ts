import { describe, expect, it } from 'vitest';
import {
  createInitialSudokuGame,
  getSudokuScore,
  inputSudokuDigit,
  isSudokuCellWrong,
  type SudokuGameState,
} from '../../../webview/src/pet/sudoku-game';

describe('pet sudoku game', () => {
  it('creates a 9x9 board with blanks for the chosen difficulty', () => {
    const game = createInitialSudokuGame('normal');
    const blankCount = game.puzzle.flat().filter(cell => cell === 0).length;

    expect(game.puzzle).toHaveLength(9);
    expect(game.puzzle.every(row => row.length === 9)).toBe(true);
    expect(blankCount).toBe(42);
    expect(game.status).toBe('playing');
  });

  it('marks a wrong editable value without solving the board', () => {
    const game = createInitialSudokuGame('easy');
    const row = game.fixed.findIndex(entryRow => entryRow.includes(false));
    const col = game.fixed[row]!.findIndex(value => !value);
    const wrongDigit = game.solution[row]![col] === 9 ? 8 : game.solution[row]![col]! + 1;

    const selected = { ...game, selected: { row, col } };
    const next = inputSudokuDigit(selected, wrongDigit);

    expect(isSudokuCellWrong(next, row, col)).toBe(true);
    expect(next.status).toBe('playing');
  });

  it('detects a solved board and awards completion bonus', () => {
    const solvedState: SudokuGameState = {
      puzzle: [
        [1, 2, 3, 4, 5, 6, 7, 8, 0],
        [4, 5, 6, 7, 8, 9, 1, 2, 3],
        [7, 8, 9, 1, 2, 3, 4, 5, 6],
        [2, 3, 4, 5, 6, 7, 8, 9, 1],
        [5, 6, 7, 8, 9, 1, 2, 3, 4],
        [8, 9, 1, 2, 3, 4, 5, 6, 7],
        [3, 4, 5, 6, 7, 8, 9, 1, 2],
        [6, 7, 8, 9, 1, 2, 3, 4, 5],
        [9, 1, 2, 3, 4, 5, 6, 7, 8],
      ],
      solution: [
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
        [4, 5, 6, 7, 8, 9, 1, 2, 3],
        [7, 8, 9, 1, 2, 3, 4, 5, 6],
        [2, 3, 4, 5, 6, 7, 8, 9, 1],
        [5, 6, 7, 8, 9, 1, 2, 3, 4],
        [8, 9, 1, 2, 3, 4, 5, 6, 7],
        [3, 4, 5, 6, 7, 8, 9, 1, 2],
        [6, 7, 8, 9, 1, 2, 3, 4, 5],
        [9, 1, 2, 3, 4, 5, 6, 7, 8],
      ],
      fixed: [
        [true, true, true, true, true, true, true, true, false],
        [true, true, true, true, true, true, true, true, true],
        [true, true, true, true, true, true, true, true, true],
        [true, true, true, true, true, true, true, true, true],
        [true, true, true, true, true, true, true, true, true],
        [true, true, true, true, true, true, true, true, true],
        [true, true, true, true, true, true, true, true, true],
        [true, true, true, true, true, true, true, true, true],
        [true, true, true, true, true, true, true, true, true],
      ],
      entries: [
        [1, 2, 3, 4, 5, 6, 7, 8, null],
        [4, 5, 6, 7, 8, 9, 1, 2, 3],
        [7, 8, 9, 1, 2, 3, 4, 5, 6],
        [2, 3, 4, 5, 6, 7, 8, 9, 1],
        [5, 6, 7, 8, 9, 1, 2, 3, 4],
        [8, 9, 1, 2, 3, 4, 5, 6, 7],
        [3, 4, 5, 6, 7, 8, 9, 1, 2],
        [6, 7, 8, 9, 1, 2, 3, 4, 5],
        [9, 1, 2, 3, 4, 5, 6, 7, 8],
      ],
      selected: { row: 0, col: 8 },
      status: 'playing',
    };

    const solved = inputSudokuDigit(solvedState, 9);

    expect(solved.status).toBe('solved');
    expect(getSudokuScore(solved, 2)).toBe(102);
  });
});
