// @vitest-environment jsdom

import React from '../../../webview/node_modules/react';
import { act } from '../../../webview/node_modules/react';
import { createRoot, type Root } from '../../../webview/node_modules/react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePetStore } from '../../../webview/src/stores/pet-store';

vi.mock('../../../webview/src/pet/use-draggable', () => ({
  useDraggable: ({ left, top }: { left: number; top: number }) => ({
    style: { position: 'fixed', left, top },
    handleProps: { onMouseDown: () => undefined },
    isDragging: false,
  }),
}));

vi.mock('../../../webview/src/components/pet/PetMinimized', () => ({
  PetMinimized: () => React.createElement('div', null, 'minimized'),
}));

vi.mock('../../../webview/src/components/pet/PetRoaming', () => ({
  ROAMING_WIDTH: 140,
  ROAMING_HEIGHT: 140,
  PetRoaming: () => React.createElement('div', null, 'roaming'),
}));

vi.mock('../../../webview/src/components/pet/PetChat', () => ({
  CHAT_WIDTH: 320,
  CHAT_HEIGHT: 480,
  PetChat: () => React.createElement('div', null, 'chat'),
}));

vi.mock('../../../webview/src/components/pet/PetGame', () => ({
  GAME_WIDTH: 320,
  GAME_HEIGHT: 420,
  PetGame: () => React.createElement('div', null, 'game'),
}));

import { PetWidget } from '../../../webview/src/components/pet/PetWidget';
import { createDefaultPetState } from '../../../webview/src/pet/pet-types';

describe('PetWidget expanded position restore', () => {
  let container: HTMLDivElement;
  let root: Root;
  const initialState = usePetStore.getState();
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
    usePetStore.setState(initialState, true);
    vi.restoreAllMocks();
  });

  it('does not persist auto-clamped position while the game panel is open', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    const setAnchor = vi.fn();

    usePetStore.setState({
      enabled: true,
      hydrated: true,
      mode: 'game',
      widgetLeft: 16,
      widgetTop: 520,
      hovered: false,
      pet: createDefaultPetState(),
      setAnchor,
      setHovered: vi.fn(),
      tickEngine: vi.fn(),
      savePetState: vi.fn(),
      saveMemory: vi.fn(),
      addChatResponse: vi.fn(),
    });

    act(() => {
      root.render(React.createElement(PetWidget));
    });

    expect(setAnchor).not.toHaveBeenCalled();
  });
});
