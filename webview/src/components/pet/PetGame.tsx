import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePetStore } from '../../stores/pet-store';
import { getPetType } from '../../pet/pet-types';
import { advanceSnakeGame, createInitialSnakeGame, turnSnakeDirection, type SnakeDirection, type SnakeGameState } from '../../pet/snake-game';
import { createInitialTwenty48Game, moveTwenty48Game, type Twenty48Direction, type Twenty48GameState } from '../../pet/twenty48-game';
import {
  FLAPPY_BIRD_DIFFICULTIES,
  advanceFlappyBirdGame,
  createInitialFlappyBirdGame,
  flapFlappyBird,
  type FlappyBirdDifficultyId,
  type FlappyBirdGameState,
} from '../../pet/flappy-bird-game';
import {
  createInitialSudokuGame,
  getSudokuCellValue,
  getSudokuScore,
  inputSudokuDigit,
  isSudokuCellWrong,
  moveSudokuSelection,
  selectSudokuCell,
  type SudokuDifficultyId,
  type SudokuGameState,
} from '../../pet/sudoku-game';

const GAME_WIDTH = 320;
const SNAKE_GRID_SIZE = 12;
const SNAKE_CELL_SIZE = 20;
const TWENTY48_GRID_SIZE = 4;
const TWENTY48_CELL_SIZE = 58;
const TWENTY48_GAP = 8;
const TWENTY48_BOARD_SIZE = TWENTY48_GRID_SIZE * TWENTY48_CELL_SIZE + (TWENTY48_GRID_SIZE - 1) * TWENTY48_GAP;
const SUDOKU_GRID_SIZE = 9;
const SUDOKU_CELL_SIZE = 26;
const SUDOKU_BOARD_SIZE = SUDOKU_GRID_SIZE * SUDOKU_CELL_SIZE;
const FLAPPY_BOARD_WIDTH = 268;
const FLAPPY_BOARD_HEIGHT = 188;

type ActivePetGame = 'launcher' | 'snake' | 'twenty48' | 'sudoku' | 'flappy';
type SnakeDifficultyId = 'easy' | 'normal' | 'hard';

const GAME_HEIGHT_BY_VIEW: Record<ActivePetGame, number> = {
  launcher: 418,
  snake: 534,
  twenty48: 468,
  flappy: 458,
  sudoku: 518,
};

const GAME_HEIGHT = GAME_HEIGHT_BY_VIEW.launcher;

interface PetGameProps {
  dragHandleProps: { onMouseDown: (e: React.MouseEvent) => void };
  onHeightChange?: (height: number) => void;
}

interface GameLauncherCardProps {
  title: string;
  hint: string;
  emoji: string;
  lastScore: number | undefined;
  bestToday: number | undefined;
  bestEver: number | undefined;
  lastPlayedAt?: string;
  onClick: () => void;
}

export const SNAKE_DIFFICULTIES: Record<SnakeDifficultyId, { label: string; tickMs: number; scoreWeight: number }> = {
  easy: { label: '轻松', tickMs: 220, scoreWeight: 1 },
  normal: { label: '标准', tickMs: 168, scoreWeight: 2 },
  hard: { label: '挑战', tickMs: 124, scoreWeight: 3 },
};

const SUDOKU_DIFFICULTIES: Record<SudokuDifficultyId, { label: string; scoreWeight: number }> = {
  easy: { label: '入门', scoreWeight: 1 },
  normal: { label: '标准', scoreWeight: 2 },
  hard: { label: '挑战', scoreWeight: 3 },
};

const TWENTY48_TILE_COLORS: Record<number, { bg: string; fg: string }> = {
  0: { bg: 'rgba(255,255,255,0.06)', fg: 'transparent' },
  2: { bg: '#eee4da', fg: '#4b4037' },
  4: { bg: '#ede0c8', fg: '#4b4037' },
  8: { bg: '#f2b179', fg: '#fffaf2' },
  16: { bg: '#f59563', fg: '#fffaf2' },
  32: { bg: '#f67c5f', fg: '#fffaf2' },
  64: { bg: '#f65e3b', fg: '#fffaf2' },
  128: { bg: '#edcf72', fg: '#fffaf2' },
  256: { bg: '#edcc61', fg: '#fffaf2' },
  512: { bg: '#edc850', fg: '#fffaf2' },
  1024: { bg: '#edc53f', fg: '#fffaf2' },
  2048: { bg: '#edc22e', fg: '#fffaf2' },
};

function SnakeBoard({ game }: { game: SnakeGameState }) {
  const cells = useMemo(() => {
    const snakeSegments = new Set(game.snake.map(segment => `${segment.x},${segment.y}`));
    const head = game.snake[0];
    return Array.from({ length: game.width * game.height }, (_, index) => {
      const x = index % game.width;
      const y = Math.floor(index / game.width);
      const key = `${x},${y}`;
      const isFood = game.food.x === x && game.food.y === y;
      const isHead = !!head && head.x === x && head.y === y;
      const isBody = snakeSegments.has(key);
      return { key, isFood, isHead, isBody };
    });
  }, [game]);

  return (
    <div
      style={{
        width: SNAKE_GRID_SIZE * SNAKE_CELL_SIZE,
        height: SNAKE_GRID_SIZE * SNAKE_CELL_SIZE,
        display: 'grid',
        gridTemplateColumns: `repeat(${SNAKE_GRID_SIZE}, ${SNAKE_CELL_SIZE}px)`,
        gridTemplateRows: `repeat(${SNAKE_GRID_SIZE}, ${SNAKE_CELL_SIZE}px)`,
        gap: 1,
        padding: 8,
        borderRadius: 10,
        background: 'color-mix(in srgb, var(--vscode-editor-background) 86%, #000 14%)',
        border: '1px solid var(--vscode-panel-border)',
        boxSizing: 'content-box',
      }}
    >
      {cells.map(cell => (
        <div
          key={cell.key}
          style={{
            width: SNAKE_CELL_SIZE,
            height: SNAKE_CELL_SIZE,
            borderRadius: cell.isHead ? 6 : cell.isBody ? 4 : cell.isFood ? 999 : 3,
            background: cell.isHead
              ? 'var(--vscode-button-background)'
              : cell.isBody
                ? 'color-mix(in srgb, var(--vscode-button-background) 72%, #111 28%)'
                : cell.isFood
                  ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
                  : 'color-mix(in srgb, var(--vscode-editor-background) 90%, #fff 10%)',
            boxShadow: cell.isFood ? '0 0 10px rgba(244,135,113,0.35)' : cell.isHead ? '0 0 10px rgba(59,130,246,0.18)' : 'none',
            animation: cell.isFood
              ? 'petGameFoodPulse 1s ease-in-out infinite'
              : cell.isHead
                ? 'petGameHeadPulse 1.4s ease-in-out infinite'
                : undefined,
            transition: 'background 140ms ease, box-shadow 140ms ease, transform 140ms ease',
          }}
        />
      ))}
    </div>
  );
}

function Twenty48Board(
  { game, moveDirection, moveTick }: { game: Twenty48GameState; moveDirection: Twenty48Direction | null; moveTick: number },
) {
  return (
    <div
      style={{
        position: 'relative',
        width: TWENTY48_BOARD_SIZE,
        height: TWENTY48_BOARD_SIZE,
        padding: 8,
        borderRadius: 12,
        background: 'color-mix(in srgb, var(--vscode-editor-background) 84%, #000 16%)',
        border: '1px solid var(--vscode-panel-border)',
        boxSizing: 'content-box',
        overflow: 'hidden',
      }}
    >
      <div
        key={moveTick > 0 && moveDirection ? `${moveDirection}-${moveTick}` : 'static'}
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          gridTemplateColumns: `repeat(${TWENTY48_GRID_SIZE}, ${TWENTY48_CELL_SIZE}px)`,
          gridTemplateRows: `repeat(${TWENTY48_GRID_SIZE}, ${TWENTY48_CELL_SIZE}px)`,
          gap: TWENTY48_GAP,
          animation: moveTick > 0 && moveDirection
            ? moveDirection === 'left'
              ? 'petGameSlideLeft 150ms ease-out'
              : moveDirection === 'right'
                ? 'petGameSlideRight 150ms ease-out'
                : moveDirection === 'up'
                  ? 'petGameSlideUp 150ms ease-out'
                  : 'petGameSlideDown 150ms ease-out'
            : undefined,
        }}
      >
        {game.board.flatMap((row, rowIndex) => row.map((value, colIndex) => {
          const tone = TWENTY48_TILE_COLORS[value] ?? { bg: '#3c3a32', fg: '#fffaf2' };
          return (
            <div
              key={`${rowIndex}-${colIndex}`}
              style={{
                width: TWENTY48_CELL_SIZE,
                height: TWENTY48_CELL_SIZE,
                borderRadius: 10,
                background: tone.bg,
                color: tone.fg,
                display: 'grid',
                placeItems: 'center',
                fontSize: value >= 1024 ? 16 : value >= 128 ? 18 : 20,
                fontWeight: 800,
                boxShadow: value === 0 ? 'none' : value >= 128 ? '0 0 14px rgba(237,194,46,0.18), 0 6px 14px rgba(0,0,0,0.14)' : '0 6px 14px rgba(0,0,0,0.14)',
                animation: value >= 128 ? 'petGameTileGlow 2.1s ease-in-out infinite' : undefined,
                transition: 'transform 140ms ease, box-shadow 140ms ease, background 140ms ease',
              }}
            >
              {value === 0 ? '' : value}
            </div>
          );
        }))}
      </div>
    </div>
  );
}

function FlappyBirdBoard({ game, difficultyId }: { game: FlappyBirdGameState; difficultyId: FlappyBirdDifficultyId }) {
  const difficultyDef = FLAPPY_BIRD_DIFFICULTIES[difficultyId];
  return (
    <div
      style={{
        position: 'relative',
        width: FLAPPY_BOARD_WIDTH,
        height: FLAPPY_BOARD_HEIGHT,
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid var(--vscode-panel-border)',
        background: 'linear-gradient(180deg, rgba(84,170,255,0.32) 0%, rgba(84,170,255,0.12) 58%, rgba(35,45,70,0.2) 100%)',
        boxShadow: 'inset 0 -28px 0 rgba(0,0,0,0.08)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '100% 28px, 28px 100%',
          opacity: 0.32,
          pointerEvents: 'none',
        }}
      />
      {game.pipes.map((pipe, index) => {
        const gapTop = pipe.gapY - difficultyDef.pipeGap / 2;
        const gapBottom = pipe.gapY + difficultyDef.pipeGap / 2;
        return (
          <React.Fragment key={`${index}-${Math.round(pipe.x)}-${Math.round(pipe.gapY)}`}>
            <div
              style={{
                position: 'absolute',
                left: pipe.x,
                top: 0,
                width: game.pipeWidth,
                height: Math.max(0, gapTop),
                borderRadius: '0 0 10px 10px',
                background: 'linear-gradient(180deg, #7ce778 0%, #4aa948 100%)',
                boxShadow: '0 6px 14px rgba(0,0,0,0.18)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: pipe.x,
                top: gapBottom,
                width: game.pipeWidth,
                height: Math.max(0, game.height - gapBottom),
                borderRadius: '10px 10px 0 0',
                background: 'linear-gradient(180deg, #4aa948 0%, #2b7c2a 100%)',
                boxShadow: '0 -6px 14px rgba(0,0,0,0.18)',
              }}
            />
          </React.Fragment>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: game.birdX - game.birdSize / 2,
          top: game.birdY - game.birdSize / 2,
          width: game.birdSize,
          height: game.birdSize,
          borderRadius: '50% 58% 44% 56%',
          background: 'linear-gradient(180deg, #ffe082 0%, #ffb74d 100%)',
          border: '1px solid rgba(122, 66, 0, 0.28)',
          boxShadow: '0 6px 14px rgba(0,0,0,0.22)',
          transform: `rotate(${Math.max(-24, Math.min(36, game.birdVelocity * 5))}deg)`,
          transition: game.status === 'running' ? 'transform 50ms linear' : 'transform 120ms ease',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: 4,
            top: 6,
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: '#3b2a12',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: -4,
            top: 10,
            width: 8,
            height: 5,
            borderRadius: '0 6px 6px 0',
            background: '#ff8f00',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 18,
          background: 'linear-gradient(180deg, #8bca5d 0%, #6ea844 100%)',
          borderTop: '1px solid rgba(255,255,255,0.18)',
        }}
      />
    </div>
  );
}

function SudokuBoard({ game, onSelect }: { game: SudokuGameState; onSelect: (row: number, col: number) => void }) {
  return (
    <div
      style={{
        width: SUDOKU_BOARD_SIZE,
        height: SUDOKU_BOARD_SIZE,
        display: 'grid',
        gridTemplateColumns: `repeat(${SUDOKU_GRID_SIZE}, ${SUDOKU_CELL_SIZE}px)`,
        gridTemplateRows: `repeat(${SUDOKU_GRID_SIZE}, ${SUDOKU_CELL_SIZE}px)`,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--vscode-panel-border)',
        background: 'color-mix(in srgb, var(--vscode-editor-background) 88%, #000 12%)',
      }}
    >
      {Array.from({ length: SUDOKU_GRID_SIZE * SUDOKU_GRID_SIZE }, (_, index) => {
        const row = Math.floor(index / SUDOKU_GRID_SIZE);
        const col = index % SUDOKU_GRID_SIZE;
        const value = getSudokuCellValue(game, row, col);
        const selected = game.selected?.row === row && game.selected?.col === col;
        const fixed = game.fixed[row]![col];
        const wrong = isSudokuCellWrong(game, row, col);
        return (
          <button
            key={`${row}-${col}`}
            type="button"
            onClick={() => onSelect(row, col)}
            style={{
              width: SUDOKU_CELL_SIZE,
              height: SUDOKU_CELL_SIZE,
              padding: 0,
              margin: 0,
              border: 'none',
              borderRight: col === 8 ? 'none' : col % 3 === 2 ? '2px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.08)',
              borderBottom: row === 8 ? 'none' : row % 3 === 2 ? '2px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.08)',
              background: selected
                ? 'color-mix(in srgb, var(--vscode-button-background) 26%, transparent)'
                : wrong
                  ? 'rgba(244,135,113,0.18)'
                  : fixed
                    ? 'color-mix(in srgb, var(--vscode-editor-background) 78%, #fff 22%)'
                    : 'transparent',
              color: wrong
                ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
                : fixed
                  ? 'var(--vscode-foreground)'
                  : 'var(--vscode-button-background)',
              fontSize: 14,
              fontWeight: fixed ? 800 : 700,
              cursor: 'pointer',
            }}
          >
            {value ?? ''}
          </button>
        );
      })}
    </div>
  );
}

function ControlButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        border: '1px solid var(--vscode-button-border, var(--vscode-widget-border))',
        background: 'var(--vscode-button-secondaryBackground, var(--vscode-button-background))',
        color: 'var(--vscode-button-secondaryForeground, var(--vscode-button-foreground))',
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 700,
      }}
    >
      {label}
    </button>
  );
}

function GameLauncherCard(props: GameLauncherCardProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        width: '100%',
        borderRadius: 12,
        border: '1px solid var(--vscode-widget-border)',
        background: 'color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-button-background) 12%)',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        display: 'grid',
        placeItems: 'center',
        background: 'color-mix(in srgb, var(--vscode-button-background) 18%, transparent)',
        fontSize: 22,
        flexShrink: 0,
      }}>
        {props.emoji}
      </div>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--vscode-foreground)' }}>{props.title}</div>
          <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', opacity: 0.82 }}>{props.hint}</div>
          <div style={{ marginTop: 3, fontSize: 10, color: 'var(--vscode-button-foreground)', opacity: 0.88 }}>点击开始</div>
        </div>
        <div style={{
          minWidth: 108,
          display: 'grid',
          gap: 4,
          justifyItems: 'end',
          textAlign: 'right',
          fontSize: 10,
          color: 'var(--vscode-descriptionForeground)',
          flexShrink: 0,
        }}>
          <div>最近分数：{props.lastScore ?? 0}</div>
          <div>今日最佳：{props.bestToday ?? 0}</div>
          <div>历史最佳：{props.bestEver ?? 0}</div>
          <div>最近一次：{formatPlayedAt(props.lastPlayedAt)}</div>
        </div>
      </div>
    </button>
  );
}

function GameStatusOverlay(props: { title: string; detail: string; actionLabel: string; onAction: () => void }) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.35)',
    }}>
      <div style={{
        padding: '14px 16px',
        borderRadius: 12,
        background: 'var(--vscode-editor-background)',
        border: '1px solid var(--vscode-widget-border)',
        boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{props.title}</div>
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>{props.detail}</div>
        <button
          type="button"
          onClick={props.onAction}
          style={{
            padding: '6px 12px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {props.actionLabel}
        </button>
      </div>
    </div>
  );
}

function formatPlayedAt(value?: string): string {
  if (!value) { return '—'; }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) { return '—'; }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function ScoreBurst({ text }: { text: string }) {
  return (
    <div style={{
      position: 'absolute',
      top: 18,
      right: 22,
      padding: '4px 10px',
      borderRadius: 999,
      background: 'color-mix(in srgb, var(--vscode-button-background) 72%, transparent)',
      color: 'var(--vscode-button-foreground)',
      fontSize: 11,
      fontWeight: 700,
      pointerEvents: 'none',
      boxShadow: '0 6px 14px rgba(0,0,0,0.18)',
      animation: 'petGameScoreBurst 700ms ease-out forwards',
    }}>
      {text}
    </div>
  );
}

function StartHintOverlay({ text }: { text: string }) {
  return (
    <div style={{
      position: 'absolute',
      top: 18,
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 12px',
      borderRadius: 999,
      border: '1px solid var(--vscode-widget-border)',
      background: 'color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-button-background) 16%)',
      color: 'var(--vscode-descriptionForeground)',
      fontSize: 11,
      fontWeight: 700,
      boxShadow: '0 8px 20px rgba(0,0,0,0.16)',
      pointerEvents: 'none',
      zIndex: 2,
      whiteSpace: 'nowrap',
    }}>
      {text}
    </div>
  );
}

export function PetGame({ dragHandleProps, onHeightChange }: PetGameProps) {
  const { pet, setMode, addExp, showBubble, recordMiniGameResult } = usePetStore();
  const typeDef = getPetType(pet.petType);
  const [activeGame, setActiveGame] = useState<ActivePetGame>('launcher');
  const [snakeGame, setSnakeGame] = useState<SnakeGameState>(() => createInitialSnakeGame(SNAKE_GRID_SIZE, SNAKE_GRID_SIZE));
  const [twenty48Game, setTwenty48Game] = useState<Twenty48GameState>(() => createInitialTwenty48Game(TWENTY48_GRID_SIZE));
  const [flappyDifficulty, setFlappyDifficulty] = useState<FlappyBirdDifficultyId>('easy');
  const [flappyGame, setFlappyGame] = useState<FlappyBirdGameState>(() => createInitialFlappyBirdGame('easy', FLAPPY_BOARD_WIDTH, FLAPPY_BOARD_HEIGHT));
  const [sudokuDifficulty, setSudokuDifficulty] = useState<SudokuDifficultyId>('easy');
  const [sudokuGame, setSudokuGame] = useState<SudokuGameState>(() => createInitialSudokuGame('easy'));
  const lastSnakeRewardedScoreRef = useRef(0);
  const last2048RewardedScoreRef = useRef(0);
  const lastFlappyRewardedScoreRef = useRef(0);
  const snakeResultRecordedRef = useRef(false);
  const twenty48ResultRecordedRef = useRef(false);
  const flappyResultRecordedRef = useRef(false);
  const sudokuResultRecordedRef = useRef(false);
  const activeGameRef = useRef<ActivePetGame>('launcher');
  const snakeScoreRef = useRef(0);
  const twenty48ScoreRef = useRef(0);
  const flappyScoreRef = useRef(0);
  const sudokuScoreRef = useRef(0);
  const snakeBurstTimerRef = useRef<number | null>(null);
  const twenty48BurstTimerRef = useRef<number | null>(null);
  const [snakeScoreBurst, setSnakeScoreBurst] = useState<string | null>(null);
  const [twenty48ScoreBurst, setTwenty48ScoreBurst] = useState<string | null>(null);
  const [snakeScorePulseKey, setSnakeScorePulseKey] = useState(0);
  const [twenty48ScorePulseKey, setTwenty48ScorePulseKey] = useState(0);
  const [twenty48MoveDirection, setTwenty48MoveDirection] = useState<Twenty48Direction | null>(null);
  const [twenty48MoveTick, setTwenty48MoveTick] = useState(0);
  const [snakeDifficulty, setSnakeDifficulty] = useState<SnakeDifficultyId>('easy');
  const [snakeStarted, setSnakeStarted] = useState(false);
  const snakeDifficultyDef = SNAKE_DIFFICULTIES[snakeDifficulty];
  const flappyDifficultyDef = FLAPPY_BIRD_DIFFICULTIES[flappyDifficulty];
  const sudokuDifficultyDef = SUDOKU_DIFFICULTIES[sudokuDifficulty];
  const snakeDisplayScore = snakeGame.score * snakeDifficultyDef.scoreWeight;
  const flappyDisplayScore = flappyGame.score * flappyDifficultyDef.scoreWeight;
  const sudokuDisplayScore = getSudokuScore(sudokuGame, sudokuDifficultyDef.scoreWeight);

  const triggerSnakeFx = useCallback((delta: number) => {
    setSnakeScorePulseKey(key => key + 1);
    setSnakeScoreBurst(`+${Math.max(1, delta)}`);
    if (snakeBurstTimerRef.current !== null) {
      window.clearTimeout(snakeBurstTimerRef.current);
    }
    snakeBurstTimerRef.current = window.setTimeout(() => {
      setSnakeScoreBurst(null);
      snakeBurstTimerRef.current = null;
    }, 700);
  }, []);

  const triggerTwenty48Fx = useCallback((delta: number) => {
    setTwenty48ScorePulseKey(key => key + 1);
    setTwenty48ScoreBurst(`+${Math.max(1, delta)}`);
    if (twenty48BurstTimerRef.current !== null) {
      window.clearTimeout(twenty48BurstTimerRef.current);
    }
    twenty48BurstTimerRef.current = window.setTimeout(() => {
      setTwenty48ScoreBurst(null);
      twenty48BurstTimerRef.current = null;
    }, 700);
  }, []);

  useEffect(() => {
    activeGameRef.current = activeGame;
  }, [activeGame]);

  useEffect(() => {
    snakeScoreRef.current = snakeGame.score;
  }, [snakeGame.score]);

  useEffect(() => {
    twenty48ScoreRef.current = twenty48Game.score;
  }, [twenty48Game.score]);

  useEffect(() => {
    flappyScoreRef.current = flappyDisplayScore;
  }, [flappyDisplayScore]);

  useEffect(() => {
    sudokuScoreRef.current = sudokuDisplayScore;
  }, [sudokuDisplayScore]);

  const finalizeSnakeResult = useCallback(() => {
    if (snakeResultRecordedRef.current) { return; }
    snakeResultRecordedRef.current = true;
    recordMiniGameResult('snake', snakeScoreRef.current * snakeDifficultyDef.scoreWeight);
  }, [recordMiniGameResult, snakeDifficultyDef.scoreWeight]);

  const finalizeTwenty48Result = useCallback(() => {
    if (twenty48ResultRecordedRef.current) { return; }
    twenty48ResultRecordedRef.current = true;
    recordMiniGameResult('twenty48', twenty48ScoreRef.current);
  }, [recordMiniGameResult]);

  const finalizeFlappyResult = useCallback(() => {
    if (flappyResultRecordedRef.current) { return; }
    flappyResultRecordedRef.current = true;
    recordMiniGameResult('flappy', flappyScoreRef.current);
  }, [recordMiniGameResult]);

  const finalizeSudokuResult = useCallback(() => {
    if (sudokuResultRecordedRef.current) { return; }
    sudokuResultRecordedRef.current = true;
    recordMiniGameResult('sudoku', sudokuScoreRef.current);
  }, [recordMiniGameResult]);

  const finalizeGameResult = useCallback((game: ActivePetGame) => {
    if (game === 'snake') {
      finalizeSnakeResult();
    } else if (game === 'twenty48') {
      finalizeTwenty48Result();
    } else if (game === 'flappy') {
      finalizeFlappyResult();
    } else if (game === 'sudoku') {
      finalizeSudokuResult();
    }
  }, [finalizeSnakeResult, finalizeTwenty48Result, finalizeFlappyResult, finalizeSudokuResult]);

  useEffect(() => () => {
    finalizeGameResult(activeGameRef.current);
    if (snakeBurstTimerRef.current !== null) {
      window.clearTimeout(snakeBurstTimerRef.current);
    }
    if (twenty48BurstTimerRef.current !== null) {
      window.clearTimeout(twenty48BurstTimerRef.current);
    }
  }, [finalizeGameResult]);

  useEffect(() => {
    if (activeGame !== 'snake' || !snakeStarted) { return; }
    const interval = window.setInterval(() => {
      setSnakeGame(prev => advanceSnakeGame(prev));
    }, snakeDifficultyDef.tickMs);
    return () => window.clearInterval(interval);
  }, [activeGame, snakeDifficultyDef.tickMs, snakeStarted]);

  useEffect(() => {
    if (activeGame !== 'flappy' || flappyGame.status !== 'running') { return; }
    const interval = window.setInterval(() => {
      setFlappyGame(prev => advanceFlappyBirdGame(prev, flappyDifficultyDef));
    }, flappyDifficultyDef.tickMs);
    return () => window.clearInterval(interval);
  }, [activeGame, flappyDifficultyDef, flappyGame.status]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeGame === 'launcher') {
          setMode('roaming');
        } else {
          finalizeGameResult(activeGame);
          setActiveGame('launcher');
        }
        return;
      }

      if (activeGame === 'snake') {
        const nextDirection: Record<string, SnakeDirection | undefined> = {
          ArrowUp: 'up',
          w: 'up',
          W: 'up',
          ArrowDown: 'down',
          s: 'down',
          S: 'down',
          ArrowLeft: 'left',
          a: 'left',
          A: 'left',
          ArrowRight: 'right',
          d: 'right',
          D: 'right',
        };
        const direction = nextDirection[event.key];
        if (!direction) { return; }
        event.preventDefault();
        if (!snakeStarted) {
          setSnakeStarted(true);
          setSnakeGame(prev => ({ ...prev, direction }));
          return;
        }
        setSnakeGame(prev => turnSnakeDirection(prev, direction));
        return;
      }

      if (activeGame === 'twenty48') {
        const nextDirection: Record<string, Twenty48Direction | undefined> = {
          ArrowUp: 'up',
          w: 'up',
          W: 'up',
          ArrowDown: 'down',
          s: 'down',
          S: 'down',
          ArrowLeft: 'left',
          a: 'left',
          A: 'left',
          ArrowRight: 'right',
          d: 'right',
          D: 'right',
        };
        const direction = nextDirection[event.key];
        if (!direction) { return; }
        event.preventDefault();
        setTwenty48Game(prev => moveTwenty48Game(prev, direction));
        return;
      }

      if (activeGame === 'flappy') {
        if (event.key !== ' ' && event.key !== 'ArrowUp' && event.key !== 'w' && event.key !== 'W') { return; }
        event.preventDefault();
        setFlappyGame(prev => flapFlappyBird(prev, flappyDifficultyDef));
        return;
      }

      if (activeGame === 'sudoku') {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSudokuGame(prev => moveSudokuSelection(prev, -1, 0));
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSudokuGame(prev => moveSudokuSelection(prev, 1, 0));
          return;
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setSudokuGame(prev => moveSudokuSelection(prev, 0, -1));
          return;
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          setSudokuGame(prev => moveSudokuSelection(prev, 0, 1));
          return;
        }
        if (/^[1-9]$/.test(event.key)) {
          event.preventDefault();
          setSudokuGame(prev => inputSudokuDigit(prev, Number(event.key)));
          return;
        }
        if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
          event.preventDefault();
          setSudokuGame(prev => inputSudokuDigit(prev, null));
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeGame, flappyDifficultyDef, setMode, snakeStarted, finalizeGameResult]);

  useEffect(() => {
    if (activeGame !== 'snake') { return; }
    if (snakeGame.score > lastSnakeRewardedScoreRef.current) {
      const delta = snakeGame.score - lastSnakeRewardedScoreRef.current;
      lastSnakeRewardedScoreRef.current = snakeGame.score;
      addExp(0.35 * snakeDifficultyDef.scoreWeight);
      triggerSnakeFx(delta * snakeDifficultyDef.scoreWeight);
    }
  }, [activeGame, addExp, snakeDifficultyDef.scoreWeight, snakeGame.score, triggerSnakeFx]);

  useEffect(() => {
    if (activeGame !== 'twenty48') { return; }
    if (twenty48Game.score > last2048RewardedScoreRef.current) {
      const delta = twenty48Game.score - last2048RewardedScoreRef.current;
      last2048RewardedScoreRef.current = twenty48Game.score;
      addExp(Math.max(0.15, Math.min(1.2, delta / 48)));
      triggerTwenty48Fx(delta);
    }
  }, [activeGame, addExp, triggerTwenty48Fx, twenty48Game.score]);

  useEffect(() => {
    if (activeGame !== 'flappy') { return; }
    if (flappyGame.score > lastFlappyRewardedScoreRef.current) {
      const delta = flappyGame.score - lastFlappyRewardedScoreRef.current;
      lastFlappyRewardedScoreRef.current = flappyGame.score;
      addExp(0.3 * delta * flappyDifficultyDef.scoreWeight);
    }
  }, [activeGame, addExp, flappyDifficultyDef.scoreWeight, flappyGame.score]);

  useEffect(() => {
    if (activeGame !== 'snake') { return; }
    if (snakeGame.status === 'game_over') {
      finalizeSnakeResult();
      showBubble(snakeDisplayScore > 0 ? `贪吃蛇得分 ${snakeDisplayScore}` : '再来一局？', 3200);
    }
  }, [activeGame, finalizeSnakeResult, showBubble, snakeDisplayScore, snakeGame.status]);

  useEffect(() => {
    if (activeGame !== 'twenty48') { return; }
    if (twenty48Game.status === 'won') {
      finalizeTwenty48Result();
      showBubble(`2048 达成，得分 ${twenty48Game.score}`, 3600);
    } else if (twenty48Game.status === 'game_over') {
      finalizeTwenty48Result();
      showBubble(twenty48Game.score > 0 ? `2048 得分 ${twenty48Game.score}` : '2048 再来一局？', 3200);
    }
  }, [activeGame, finalizeTwenty48Result, twenty48Game.score, twenty48Game.status, showBubble]);

  useEffect(() => {
    if (activeGame !== 'flappy' || flappyGame.status !== 'game_over') { return; }
    finalizeFlappyResult();
    showBubble(flappyDisplayScore > 0 ? `像素鸟得分 ${flappyDisplayScore}` : '像素鸟再来一局？', 3200);
  }, [activeGame, finalizeFlappyResult, flappyDisplayScore, flappyGame.status, showBubble]);

  useEffect(() => {
    if (activeGame !== 'sudoku' || sudokuGame.status !== 'solved') { return; }
    finalizeSudokuResult();
    addExp(0.6 * sudokuDifficultyDef.scoreWeight);
    showBubble(`数独完成，得分 ${sudokuDisplayScore}`, 3600);
  }, [activeGame, addExp, finalizeSudokuResult, showBubble, sudokuDifficultyDef.scoreWeight, sudokuDisplayScore, sudokuGame.status]);

  const restartSnakeGame = (opts?: { autoStart?: boolean }) => {
    if (activeGame === 'snake') {
      finalizeSnakeResult();
    }
    lastSnakeRewardedScoreRef.current = 0;
    snakeResultRecordedRef.current = false;
    setSnakeGame(createInitialSnakeGame(SNAKE_GRID_SIZE, SNAKE_GRID_SIZE));
    setSnakeStarted(opts?.autoStart ?? (activeGame === 'snake'));
  };

  const restartTwenty48Game = () => {
    if (activeGame === 'twenty48') {
      finalizeTwenty48Result();
    }
    last2048RewardedScoreRef.current = 0;
    twenty48ResultRecordedRef.current = false;
    setTwenty48Game(createInitialTwenty48Game(TWENTY48_GRID_SIZE));
  };

  const restartFlappyGame = (difficulty = flappyDifficulty) => {
    if (activeGame === 'flappy') {
      finalizeFlappyResult();
    }
    lastFlappyRewardedScoreRef.current = 0;
    flappyResultRecordedRef.current = false;
    setFlappyGame(createInitialFlappyBirdGame(difficulty, FLAPPY_BOARD_WIDTH, FLAPPY_BOARD_HEIGHT));
  };

  const restartSudokuGame = (difficulty = sudokuDifficulty) => {
    if (activeGame === 'sudoku') {
      finalizeSudokuResult();
    }
    sudokuResultRecordedRef.current = false;
    setSudokuGame(createInitialSudokuGame(difficulty));
  };

  const openSnakeGame = () => {
    restartSnakeGame({ autoStart: false });
    setActiveGame('snake');
  };

  const openTwenty48Game = () => {
    restartTwenty48Game();
    setActiveGame('twenty48');
  };

  const openFlappyGame = () => {
    restartFlappyGame(flappyDifficulty);
    setActiveGame('flappy');
  };

  const openSudokuGame = () => {
    restartSudokuGame(sudokuDifficulty);
    setActiveGame('sudoku');
  };

  const turnSnake = (direction: SnakeDirection) => {
    setSnakeGame(prev => turnSnakeDirection(prev, direction));
  };

  const move2048 = (direction: Twenty48Direction) => {
    setTwenty48Game(prev => {
      const next = moveTwenty48Game(prev, direction);
      if (next !== prev) {
        setTwenty48MoveDirection(direction);
        setTwenty48MoveTick(tick => tick + 1);
      }
      return next;
    });
  };

  const title = activeGame === 'launcher'
    ? '小游戏'
    : activeGame === 'snake'
      ? '贪吃蛇'
      : activeGame === 'twenty48'
        ? '2048'
        : activeGame === 'flappy'
          ? '像素鸟'
          : '数独';
  const score = activeGame === 'snake'
    ? snakeDisplayScore
    : activeGame === 'twenty48'
      ? twenty48Game.score
      : activeGame === 'flappy'
        ? flappyDisplayScore
      : activeGame === 'sudoku'
        ? sudokuDisplayScore
        : null;
  const gameHeight = GAME_HEIGHT_BY_VIEW[activeGame];

  useEffect(() => {
    onHeightChange?.(gameHeight);
  }, [gameHeight, onHeightChange]);

  return (
    <div style={{
      width: GAME_WIDTH,
      height: gameHeight,
      borderRadius: 12,
      overflow: 'hidden',
      background: 'var(--vscode-editor-background)',
      border: '1px solid var(--vscode-widget-border)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div
        {...dragHandleProps}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          height: 28,
          fontSize: 11,
          color: 'var(--vscode-foreground)',
          borderBottom: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-sideBar-background)',
          flexShrink: 0,
          userSelect: 'none',
          cursor: 'grab',
        }}
      >
        <span style={{ fontWeight: 600 }}>
          {typeDef.emoji} {pet.petName} · {title}
        </span>
        <div style={{ flex: 1 }} />
        {typeof score === 'number' && (
          <span
            key={activeGame === 'snake' ? `snake-score-${snakeScorePulseKey}` : activeGame === 'twenty48' ? `2048-score-${twenty48ScorePulseKey}` : `${activeGame}-score`}
            style={{
              fontSize: 10,
              opacity: 0.75,
              animation: score > 0 && (activeGame === 'snake' || activeGame === 'twenty48') ? 'petGameScorePulse 260ms ease-out' : undefined,
            }}
          >
            得分 {score}
          </span>
        )}
        {activeGame === 'snake' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); restartSnakeGame(); }}
            title="重新开始"
            style={{
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ↺
          </button>
        )}
        {activeGame === 'twenty48' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); restartTwenty48Game(); }}
            title="重新开始"
            style={{
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ↺
          </button>
        )}
        {activeGame === 'sudoku' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); restartSudokuGame(); }}
            title="重新开始"
            style={{
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ↺
          </button>
        )}
        {activeGame === 'flappy' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); restartFlappyGame(); }}
            title="重新开始"
            style={{
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ↺
          </button>
        )}
        {activeGame !== 'launcher' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); finalizeGameResult(activeGame); setActiveGame('launcher'); }}
            title="返回小游戏列表"
            style={{
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ←
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); finalizeGameResult(activeGame); setMode('roaming'); }}
          title="关闭小游戏"
          style={{
            background: 'transparent',
            color: 'var(--vscode-descriptionForeground)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 10,
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {activeGame === 'launcher' ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '14px',
          minHeight: 0,
          overflowY: 'auto',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vscode-foreground)' }}>休息一下</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <GameLauncherCard
              title="贪吃蛇"
              hint="方向键 / WASD 控制，难度在游戏内切换。"
              emoji="🐍"
              lastScore={pet.snakeLastScore}
              bestToday={pet.snakeBestScoreToday}
              bestEver={pet.snakeBestScore}
              lastPlayedAt={pet.snakeLastPlayedAt}
              onClick={openSnakeGame}
            />
            <GameLauncherCard
              title="2048"
              hint="方向键 / WASD 控制，合并分数也会给宠物增加经验。"
              emoji="🧩"
              lastScore={pet.twenty48LastScore}
              bestToday={pet.twenty48BestScoreToday}
              bestEver={pet.twenty48BestScore}
              lastPlayedAt={pet.twenty48LastPlayedAt}
              onClick={openTwenty48Game}
            />
            <GameLauncherCard
              title="数独"
              hint="点击格子后填入 1-9，方向键移动，难度在游戏内切换。"
              emoji="🔢"
              lastScore={pet.sudokuLastScore}
              bestToday={pet.sudokuBestScoreToday}
              bestEver={pet.sudokuBestScore}
              lastPlayedAt={pet.sudokuLastPlayedAt}
              onClick={openSudokuGame}
            />
            <GameLauncherCard
              title="像素鸟"
              hint="空格 / ↑ / W 拍翅穿过管道，难度在游戏内切换。"
              emoji="🐤"
              lastScore={pet.flappyLastScore}
              bestToday={pet.flappyBestScoreToday}
              bestEver={pet.flappyBestScore}
              lastPlayedAt={pet.flappyLastPlayedAt}
              onClick={openFlappyGame}
            />
          </div>

          <div style={{
            marginTop: 'auto',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--vscode-panel-border)',
            background: 'color-mix(in srgb, var(--vscode-editor-background) 92%, #fff 8%)',
            fontSize: 10,
            color: 'var(--vscode-descriptionForeground)',
            lineHeight: 1.55,
          }}>
            按 <strong>Esc</strong> 可直接返回宠物漫游。小游戏窗口保持独立，不影响画布工作流。
          </div>
        </div>
      ) : activeGame === 'snake' ? (
        <>
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '12px 14px 8px',
            minHeight: 0,
            position: 'relative',
          }}>
            <SnakeBoard game={snakeGame} />
            {snakeScoreBurst && <ScoreBurst text={snakeScoreBurst} />}

            {snakeGame.status === 'game_over' && (
              <GameStatusOverlay
                title="游戏结束"
                detail={`本局得分 ${snakeDisplayScore}`}
                actionLabel="再来一局"
                onAction={() => restartSnakeGame({ autoStart: true })}
              />
            )}

            {!snakeStarted && snakeGame.status === 'running' && (
              <StartHintOverlay text="按任意方向键 / WASD 开始" />
            )}

            <div style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--vscode-panel-border)',
              background: 'color-mix(in srgb, var(--vscode-editor-background) 92%, #fff 8%)',
            }}>
              <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                贪吃蛇难度 · 当前 {snakeDifficultyDef.label} · 每次得分 ×{snakeDifficultyDef.scoreWeight}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(Object.keys(SNAKE_DIFFICULTIES) as SnakeDifficultyId[]).map(id => (
                  <button
                    key={id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSnakeDifficulty(id);
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      border: id === snakeDifficulty ? '1px solid var(--vscode-button-background)' : '1px solid var(--vscode-widget-border)',
                      background: id === snakeDifficulty
                        ? 'color-mix(in srgb, var(--vscode-button-background) 20%, transparent)'
                        : 'transparent',
                      color: id === snakeDifficulty ? 'var(--vscode-button-background)' : 'var(--vscode-descriptionForeground)',
                      cursor: 'pointer',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {SNAKE_DIFFICULTIES[id].label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              justifyContent: 'space-between',
            }}>
              <div style={{
                fontSize: 10,
                lineHeight: 1.5,
                color: 'var(--vscode-descriptionForeground)',
              }}>
                <div>当前难度：{snakeDifficultyDef.label}</div>
                <div>{snakeStarted ? '方向键 / WASD 控制' : '按任意方向键 / WASD 开始'}</div>
                <div>每次得分 ×{snakeDifficultyDef.scoreWeight}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 34px)', gap: 6, alignItems: 'center', justifyItems: 'center' }}>
                <span />
                <ControlButton label="↑" onClick={() => { if (!snakeStarted) { setSnakeStarted(true); setSnakeGame(prev => ({ ...prev, direction: 'up' })); return; } turnSnake('up'); }} />
                <span />
                <ControlButton label="←" onClick={() => { if (!snakeStarted) { setSnakeStarted(true); setSnakeGame(prev => ({ ...prev, direction: 'left' })); return; } turnSnake('left'); }} />
                <ControlButton label="↓" onClick={() => { if (!snakeStarted) { setSnakeStarted(true); setSnakeGame(prev => ({ ...prev, direction: 'down' })); return; } turnSnake('down'); }} />
                <ControlButton label="→" onClick={() => { if (!snakeStarted) { setSnakeStarted(true); setSnakeGame(prev => ({ ...prev, direction: 'right' })); return; } turnSnake('right'); }} />
              </div>
            </div>
          </div>

          <div
            {...dragHandleProps}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              height: 20,
              fontSize: 9,
              color: 'var(--vscode-descriptionForeground)',
              borderTop: '1px solid var(--vscode-panel-border)',
              background: 'var(--vscode-sideBar-background)',
              flexShrink: 0,
              userSelect: 'none',
              cursor: 'grab',
            }}
          >
            <span>🎮 科研间隙放松一下</span>
            <div style={{ flex: 1 }} />
            <span style={{ opacity: 0.45 }}>Esc 返回列表</span>
          </div>
        </>
      ) : activeGame === 'twenty48' ? (
        <>
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '12px 14px 8px',
            minHeight: 0,
            position: 'relative',
          }}>
            <Twenty48Board game={twenty48Game} moveDirection={twenty48MoveDirection} moveTick={twenty48MoveTick} />
            {twenty48ScoreBurst && <ScoreBurst text={twenty48ScoreBurst} />}

            {twenty48Game.status === 'won' && (
              <GameStatusOverlay
                title="2048 达成"
                detail={`本局得分 ${twenty48Game.score}`}
                actionLabel="再来一局"
                onAction={restartTwenty48Game}
              />
            )}
            {twenty48Game.status === 'game_over' && (
              <GameStatusOverlay
                title="无路可走"
                detail={`本局得分 ${twenty48Game.score}`}
                actionLabel="再来一局"
                onAction={restartTwenty48Game}
              />
            )}

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              justifyContent: 'space-between',
            }}>
              <div style={{
                fontSize: 10,
                lineHeight: 1.5,
                color: 'var(--vscode-descriptionForeground)',
              }}>
                <div>方向键 / WASD 控制</div>
                <div>合并数字会给宠物少量经验</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 34px)', gap: 6, alignItems: 'center', justifyItems: 'center' }}>
                <span />
                <ControlButton label="↑" onClick={() => move2048('up')} />
                <span />
                <ControlButton label="←" onClick={() => move2048('left')} />
                <ControlButton label="↓" onClick={() => move2048('down')} />
                <ControlButton label="→" onClick={() => move2048('right')} />
              </div>
            </div>
          </div>

          <div
            {...dragHandleProps}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              height: 20,
              fontSize: 9,
              color: 'var(--vscode-descriptionForeground)',
              borderTop: '1px solid var(--vscode-panel-border)',
              background: 'var(--vscode-sideBar-background)',
              flexShrink: 0,
              userSelect: 'none',
              cursor: 'grab',
            }}
          >
            <span>🧩 合并到 2048 就算通关</span>
            <div style={{ flex: 1 }} />
            <span style={{ opacity: 0.45 }}>Esc 返回列表</span>
          </div>
        </>
      ) : activeGame === 'flappy' ? (
        <>
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '12px 14px 8px',
            minHeight: 0,
            position: 'relative',
          }}>
            <FlappyBirdBoard game={flappyGame} difficultyId={flappyDifficulty} />

            {flappyGame.status === 'waiting' && (
              <StartHintOverlay text="按空格 / ↑ / W 开始" />
            )}

            {flappyGame.status === 'game_over' && (
              <GameStatusOverlay
                title="撞上了"
                detail={`本局得分 ${flappyDisplayScore}`}
                actionLabel="再来一局"
                onAction={() => restartFlappyGame()}
              />
            )}

            <div style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--vscode-panel-border)',
              background: 'color-mix(in srgb, var(--vscode-editor-background) 92%, #fff 8%)',
            }}>
              <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                像素鸟难度 · 当前 {flappyDifficultyDef.label} · 每通过一组管道 ×{flappyDifficultyDef.scoreWeight}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(Object.keys(FLAPPY_BIRD_DIFFICULTIES) as FlappyBirdDifficultyId[]).map(id => (
                  <button
                    key={id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setFlappyDifficulty(id);
                      restartFlappyGame(id);
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      border: id === flappyDifficulty ? '1px solid var(--vscode-button-background)' : '1px solid var(--vscode-widget-border)',
                      background: id === flappyDifficulty
                        ? 'color-mix(in srgb, var(--vscode-button-background) 20%, transparent)'
                        : 'transparent',
                      color: id === flappyDifficulty ? 'var(--vscode-button-background)' : 'var(--vscode-descriptionForeground)',
                      cursor: 'pointer',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {FLAPPY_BIRD_DIFFICULTIES[id].label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              justifyContent: 'space-between',
            }}>
              <div style={{
                fontSize: 10,
                lineHeight: 1.5,
                color: 'var(--vscode-descriptionForeground)',
              }}>
                <div>{flappyGame.status === 'waiting' ? '按空格 / ↑ / W 开始' : '空格 / ↑ / W 拍翅'}</div>
                <div>穿过管道得分，碰到边界或管道就结束</div>
                <div>当前难度：{flappyDifficultyDef.label}</div>
              </div>

              <button
                type="button"
                onClick={() => setFlappyGame(prev => flapFlappyBird(prev, flappyDifficultyDef))}
                style={{
                  padding: '8px 14px',
                  borderRadius: 10,
                  border: '1px solid var(--vscode-button-background)',
                  background: 'color-mix(in srgb, var(--vscode-button-background) 18%, transparent)',
                  color: 'var(--vscode-button-background)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                拍一下翅膀
              </button>
            </div>
          </div>

          <div
            {...dragHandleProps}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              height: 20,
              fontSize: 9,
              color: 'var(--vscode-descriptionForeground)',
              borderTop: '1px solid var(--vscode-panel-border)',
              background: 'var(--vscode-sideBar-background)',
              flexShrink: 0,
              userSelect: 'none',
              cursor: 'grab',
            }}
          >
            <span>🐤 轻量点击或键盘操作，适合短暂切换注意力</span>
            <div style={{ flex: 1 }} />
            <span style={{ opacity: 0.45 }}>Esc 返回列表</span>
          </div>
        </>
      ) : (
        <>
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 8,
            padding: '12px 14px 8px',
            minHeight: 0,
            position: 'relative',
            overflowY: 'auto',
          }}>
            <SudokuBoard game={sudokuGame} onSelect={(row, col) => setSudokuGame(prev => selectSudokuCell(prev, row, col))} />

            {sudokuGame.status === 'solved' && (
              <GameStatusOverlay
                title="数独完成"
                detail={`本局得分 ${sudokuDisplayScore}`}
                actionLabel="再来一局"
                onAction={() => restartSudokuGame()}
              />
            )}

            <div style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--vscode-panel-border)',
              background: 'color-mix(in srgb, var(--vscode-editor-background) 92%, #fff 8%)',
            }}>
              <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                数独难度 · 当前 {sudokuDifficultyDef.label} · 完成奖励 ×{sudokuDifficultyDef.scoreWeight}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(Object.keys(SUDOKU_DIFFICULTIES) as SudokuDifficultyId[]).map(id => (
                  <button
                    key={id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSudokuDifficulty(id);
                      restartSudokuGame(id);
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      border: id === sudokuDifficulty ? '1px solid var(--vscode-button-background)' : '1px solid var(--vscode-widget-border)',
                      background: id === sudokuDifficulty
                        ? 'color-mix(in srgb, var(--vscode-button-background) 20%, transparent)'
                        : 'transparent',
                      color: id === sudokuDifficulty ? 'var(--vscode-button-background)' : 'var(--vscode-descriptionForeground)',
                      cursor: 'pointer',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {SUDOKU_DIFFICULTIES[id].label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              width: '100%',
              justifyContent: 'space-between',
            }}>
              <div style={{
                fontSize: 10,
                lineHeight: 1.5,
                color: 'var(--vscode-descriptionForeground)',
              }}>
                <div>点击格子后，用键盘 1-9 填数</div>
                <div>方向键移动，Delete / Backspace 清空</div>
                <div>当前难度：{sudokuDifficultyDef.label}</div>
              </div>
              <div style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--vscode-panel-border)',
                background: 'color-mix(in srgb, var(--vscode-editor-background) 92%, #fff 8%)',
                fontSize: 10,
                color: 'var(--vscode-descriptionForeground)',
                lineHeight: 1.5,
                flexShrink: 0,
              }}>
                <div>当前选中：{sudokuGame.selected ? `${sudokuGame.selected.row + 1} 行 ${sudokuGame.selected.col + 1} 列` : '未选中'}</div>
                <div>错误格会直接高亮</div>
              </div>
            </div>
          </div>

          <div
            {...dragHandleProps}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              height: 20,
              fontSize: 9,
              color: 'var(--vscode-descriptionForeground)',
              borderTop: '1px solid var(--vscode-panel-border)',
              background: 'var(--vscode-sideBar-background)',
              flexShrink: 0,
              userSelect: 'none',
              cursor: 'grab',
            }}
          >
            <span>🔢 数字填空，适合慢节奏放松</span>
            <div style={{ flex: 1 }} />
            <span style={{ opacity: 0.45 }}>Esc 返回列表</span>
          </div>
        </>
      )}
      <style>{`
        @keyframes petGameFoodPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 10px rgba(244,135,113,0.35); }
          50% { transform: scale(1.12); box-shadow: 0 0 18px rgba(244,135,113,0.48); }
        }
        @keyframes petGameHeadPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        @keyframes petGameScorePulse {
          0% { transform: scale(1); opacity: 0.75; }
          40% { transform: scale(1.16); opacity: 1; }
          100% { transform: scale(1); opacity: 0.75; }
        }
        @keyframes petGameScoreBurst {
          0% { opacity: 0; transform: translateY(8px) scale(0.92); }
          18% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-14px) scale(1.04); }
        }
        @keyframes petGameTileGlow {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @keyframes petGameSlideLeft {
          0% { transform: translateX(8px); }
          100% { transform: translateX(0); }
        }
        @keyframes petGameSlideRight {
          0% { transform: translateX(-8px); }
          100% { transform: translateX(0); }
        }
        @keyframes petGameSlideUp {
          0% { transform: translateY(8px); }
          100% { transform: translateY(0); }
        }
        @keyframes petGameSlideDown {
          0% { transform: translateY(-8px); }
          100% { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export { GAME_WIDTH, GAME_HEIGHT };
