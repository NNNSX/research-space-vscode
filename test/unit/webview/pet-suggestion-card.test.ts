// @vitest-environment jsdom

import React from '../../../webview/node_modules/react';
import { act } from '../../../webview/node_modules/react';
import { createRoot, type Root } from '../../../webview/node_modules/react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PetSuggestionCard } from '../../../webview/src/components/pet/PetSuggestionCard';
import { usePetStore } from '../../../webview/src/stores/pet-store';

describe('PetSuggestionCard placement', () => {
  let container: HTMLDivElement;
  let root: Root;
  const initialState = usePetStore.getState();
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    usePetStore.setState({
      activeSuggestionCard: {
        id: 'card-1',
        kind: 'mindmap_structure',
        message: '建议内容',
        reason: '测试原因',
        actions: [],
      },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    usePetStore.setState(initialState, true);
  });

  it('flips the fixed-panel suggestion card left near the viewport right edge', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    usePetStore.setState({ widgetLeft: 360 });

    act(() => {
      root.render(React.createElement(PetSuggestionCard));
    });

    const card = container.firstElementChild as HTMLElement | null;
    expect(card?.style.right).toBe('calc(100% + 8px)');
    expect(card?.style.left).toBe('');
  });
});
