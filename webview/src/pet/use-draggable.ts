import { useCallback, useEffect, useRef, useState } from 'react';

interface DraggableOptions {
  left: number;
  top: number;
  widgetWidth: number;
  widgetHeight: number;
  onDrop: (left: number, top: number) => void;
}

interface DraggableResult {
  style: React.CSSProperties;
  handleProps: { onMouseDown: (e: React.MouseEvent) => void };
  isDragging: boolean;
}

/**
 * Custom hook for free-placement drag behaviour.
 * Widget stays where the user drops it, clamped to viewport.
 */
export function useDraggable(opts: DraggableOptions): DraggableResult {
  const { left, top, widgetWidth, widgetHeight, onDrop } = opts;

  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragOffset.current = { x: e.clientX - left, y: e.clientY - top };
    setDragPos({ left, top });
    dragging.current = true;
  }, [left, top]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) { return; }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const newLeft = clamp(e.clientX - dragOffset.current.x, 0, vw - Math.min(widgetWidth, vw));
      const newTop = clamp(e.clientY - dragOffset.current.y, 0, vh - Math.min(widgetHeight, vh));
      setDragPos({ left: newLeft, top: newTop });
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!dragging.current) { return; }
      dragging.current = false;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const finalLeft = clamp(e.clientX - dragOffset.current.x, 0, vw - Math.min(widgetWidth, vw));
      const finalTop = clamp(e.clientY - dragOffset.current.y, 0, vh - Math.min(widgetHeight, vh));
      setDragPos(null);
      onDrop(finalLeft, finalTop);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [widgetWidth, widgetHeight, onDrop]);

  const style: React.CSSProperties = dragPos
    ? { position: 'fixed', left: dragPos.left, top: dragPos.top }
    : { position: 'fixed', left, top };

  return {
    style,
    handleProps: { onMouseDown },
    isDragging: dragging.current,
  };
}
