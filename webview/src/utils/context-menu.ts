import { useEffect, type RefObject } from 'react';

const CLOSE_ALL_CANVAS_CONTEXT_MENUS_EVENT = 'rs:close-all-canvas-context-menus';

export function closeAllCanvasContextMenus() {
  if (typeof window === 'undefined') { return; }
  window.dispatchEvent(new CustomEvent(CLOSE_ALL_CANVAS_CONTEXT_MENUS_EVENT));
}

export function useCanvasContextMenuAutoClose(
  open: boolean,
  onClose: () => void,
  containerRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open || typeof window === 'undefined') { return; }

    const shouldIgnoreTarget = (eventTarget: EventTarget | null): boolean => {
      const container = containerRef?.current;
      return !!(container && eventTarget instanceof Node && container.contains(eventTarget));
    };

    const close = (event?: Event) => {
      if (event && shouldIgnoreTarget(event.target)) { return; }
      onClose();
    };
    const closeOnKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const wheelListener: EventListener = (event) => close(event);
    const customCloseListener: EventListener = () => onClose();

    const timer = window.setTimeout(() => {
      window.addEventListener('click', close, true);
      window.addEventListener('contextmenu', close, true);
      window.addEventListener('wheel', wheelListener, { capture: true, passive: true });
      window.addEventListener('keydown', closeOnKeydown, true);
      window.addEventListener(CLOSE_ALL_CANVAS_CONTEXT_MENUS_EVENT, customCloseListener);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('click', close, true);
      window.removeEventListener('contextmenu', close, true);
      window.removeEventListener('wheel', wheelListener, true);
      window.removeEventListener('keydown', closeOnKeydown, true);
      window.removeEventListener(CLOSE_ALL_CANVAS_CONTEXT_MENUS_EVENT, customCloseListener);
    };
  }, [open, onClose, containerRef]);
}
