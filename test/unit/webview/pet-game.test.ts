// @vitest-environment jsdom

import React from '../../../webview/node_modules/react';
import { act } from '../../../webview/node_modules/react';
import { createRoot, type Root } from '../../../webview/node_modules/react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PetGame, SNAKE_DIFFICULTIES } from '../../../webview/src/components/pet/PetGame';
import { FLAPPY_BIRD_DIFFICULTIES } from '../../../webview/src/pet/flappy-bird-game';
import { createDefaultPetState } from '../../../webview/src/pet/pet-types';
import { usePetStore } from '../../../webview/src/stores/pet-store';

describe('PetGame mini-game stats', () => {
  let container: HTMLDivElement;
  let root: Root;
  const initialState = usePetStore.getState();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    usePetStore.setState({
      hydrated: true,
      enabled: true,
      mode: 'game',
      pet: createDefaultPetState(),
      setMode: vi.fn(),
      addExp: vi.fn(),
      showBubble: vi.fn(),
      recordMiniGameResult: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    if (vi.isFakeTimers()) {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
    usePetStore.setState(initialState, true);
  });

  it('records the current snake score when leaving mid-game with Escape', () => {
    act(() => {
      root.render(React.createElement(PetGame, {
        dragHandleProps: { onMouseDown: () => undefined },
      }));
    });

    expect(container.textContent).not.toContain('今日放松次数');

    const snakeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('贪吃蛇'));
    expect(snakeButton).toBeTruthy();

    act(() => {
      snakeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(usePetStore.getState().recordMiniGameResult).toHaveBeenCalledTimes(1);
    expect(usePetStore.getState().recordMiniGameResult).toHaveBeenCalledWith('snake', 0);
  });

  it('keeps the launcher content scrollable and shows scores beside each game name', () => {
    act(() => {
      root.render(React.createElement(PetGame, {
        dragHandleProps: { onMouseDown: () => undefined },
      }));
    });

    const launcherButtons = Array.from(container.querySelectorAll('button')).filter(button =>
      button.textContent?.includes('最近：0')
      && (button.textContent.includes('贪吃蛇') || button.textContent.includes('2048') || button.textContent.includes('数独') || button.textContent.includes('像素鸟')),
    );
    expect(launcherButtons).toHaveLength(4);

    const scrollContainer = Array.from(container.querySelectorAll('div')).find(div => div.style.overflowY === 'auto');
    expect(scrollContainer).toBeTruthy();
  });

  it('frames games as a short break instead of the pet main line', () => {
    act(() => {
      root.render(React.createElement(PetGame, {
        dragHandleProps: { onMouseDown: () => undefined },
      }));
    });

    expect(container.textContent).toContain('短休息');
    expect(container.textContent).toContain('不会替代画布主线');
    expect(container.textContent).toContain('画布工作流不会被自动改变');
    expect(container.textContent).not.toContain('科研间隙放松一下');
  });

  it('does not auto-start snake until the user presses a direction key', () => {
    vi.useFakeTimers();

    act(() => {
      root.render(React.createElement(PetGame, {
        dragHandleProps: { onMouseDown: () => undefined },
      }));
    });

    const snakeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('贪吃蛇'));
    expect(snakeButton).toBeTruthy();

    act(() => {
      snakeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('按任意方向键 / WASD 开始');

    act(() => {
      vi.advanceTimersByTime(2200);
    });

    expect(container.textContent).not.toContain('游戏结束');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      vi.advanceTimersByTime(600);
    });

    expect(container.textContent).not.toContain('按任意方向键 / WASD 开始');
    expect(container.textContent).toContain('方向键 / WASD 控制');
  });

  it('reports different heights for different mini-game views instead of keeping one fixed height', () => {
    const onHeightChange = vi.fn();

    act(() => {
      root.render(React.createElement(PetGame, {
        dragHandleProps: { onMouseDown: () => undefined },
        onHeightChange,
      }));
    });

    expect(onHeightChange).toHaveBeenLastCalledWith(418);

    const snakeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('贪吃蛇'));
    expect(snakeButton).toBeTruthy();

    act(() => {
      snakeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onHeightChange).toHaveBeenLastCalledWith(534);

    const backButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '←');
    expect(backButton).toBeTruthy();

    act(() => {
      backButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const sudokuButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('数独'));
    expect(sudokuButton).toBeTruthy();

    act(() => {
      sudokuButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onHeightChange).toHaveBeenLastCalledWith(518);
  });

  it('keeps start hints absolutely overlaid so starting a game does not push the layout', () => {
    act(() => {
      root.render(React.createElement(PetGame, {
        dragHandleProps: { onMouseDown: () => undefined },
      }));
    });

    const snakeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('贪吃蛇'));
    expect(snakeButton).toBeTruthy();

    act(() => {
      snakeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const hint = Array.from(container.querySelectorAll('div')).find(div => div.textContent === '按任意方向键 / WASD 开始');
    expect(hint).toBeTruthy();
    expect(hint?.style.position).toBe('absolute');
  });

  it('keeps snake and flappy difficulty speeds clearly separated', () => {
    expect(SNAKE_DIFFICULTIES.easy.tickMs).toBeGreaterThan(SNAKE_DIFFICULTIES.normal.tickMs);
    expect(SNAKE_DIFFICULTIES.normal.tickMs).toBeGreaterThan(SNAKE_DIFFICULTIES.hard.tickMs);

    expect(FLAPPY_BIRD_DIFFICULTIES.easy.tickMs).toBeGreaterThan(FLAPPY_BIRD_DIFFICULTIES.normal.tickMs);
    expect(FLAPPY_BIRD_DIFFICULTIES.normal.tickMs).toBeGreaterThan(FLAPPY_BIRD_DIFFICULTIES.hard.tickMs);
    expect(FLAPPY_BIRD_DIFFICULTIES.easy.pipeSpeed).toBeLessThan(FLAPPY_BIRD_DIFFICULTIES.normal.pipeSpeed);
    expect(FLAPPY_BIRD_DIFFICULTIES.normal.pipeSpeed).toBeLessThan(FLAPPY_BIRD_DIFFICULTIES.hard.pipeSpeed);
  });
});
