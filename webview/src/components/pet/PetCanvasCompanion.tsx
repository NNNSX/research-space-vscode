import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useViewport } from '@xyflow/react';
import { usePetStore } from '../../stores/pet-store';
import { useCanvasStore, type CanvasDetailLevel } from '../../stores/canvas-store';
import { PetCharacter } from './PetCharacter';
import { PetSuggestionCard } from './PetSuggestionCard';
import { clientToContainerPoint, resolvePetFollowPosition, resolvePetManualDragPosition } from '../../pet/pet-follow-position';

const FOLLOW_WIDTH = 96;
const FOLLOW_HEIGHT = 82;
const FOLLOW_LOW_DETAIL_WIDTH = 72;
const FOLLOW_LOW_DETAIL_HEIGHT = 60;

interface PetCanvasCompanionProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  detailLevel: CanvasDetailLevel;
}

export function PetCanvasCompanion({ containerRef, detailLevel }: PetCanvasCompanionProps) {
  const enabled = usePetStore(s => s.enabled);
  const hydrated = usePetStore(s => s.hydrated);
  const mode = usePetStore(s => s.mode);
  const displayMode = usePetStore(s => s.displayMode);
  const hovered = usePetStore(s => s.hovered);
  const setHovered = usePetStore(s => s.setHovered);
  const canvasPetLeft = usePetStore(s => s.canvasPetLeft);
  const canvasPetTop = usePetStore(s => s.canvasPetTop);
  const canvasPetManual = usePetStore(s => s.canvasPetManual);
  const setCanvasPetPosition = usePetStore(s => s.setCanvasPetPosition);
  const resetCanvasPetPosition = usePetStore(s => s.resetCanvasPetPosition);
  const selectedNodeIds = useCanvasStore(s => s.selectedNodeIds);
  const nodes = useCanvasStore(s => s.nodes);
  const viewport = useViewport();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [dragPosition, setDragPosition] = useState<{ left: number; top: number } | null>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) { return; }
    const update = () => setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  const selectedNode = useMemo(() => {
    const firstId = selectedNodeIds[0];
    if (!firstId) { return null; }
    return nodes.find(node => node.id === firstId)?.data ?? null;
  }, [nodes, selectedNodeIds]);

  const lowDetail = detailLevel !== 'full' || viewport.zoom <= 0.18;
  const widget = lowDetail
    ? { width: FOLLOW_LOW_DETAIL_WIDTH, height: FOLLOW_LOW_DETAIL_HEIGHT }
    : { width: FOLLOW_WIDTH, height: FOLLOW_HEIGHT };
  const autoPosition = resolvePetFollowPosition({
    selectedNode,
    viewport,
    container: containerSize,
    widget,
  });
  const maxLeft = Math.max(16, containerSize.width - widget.width - 16);
  const maxTop = Math.max(16, containerSize.height - widget.height - 16);
  const manualPosition = canvasPetManual && Number.isFinite(canvasPetLeft) && Number.isFinite(canvasPetTop)
    ? {
        left: Math.max(16, Math.min(canvasPetLeft ?? 16, maxLeft)),
        top: Math.max(16, Math.min(canvasPetTop ?? maxTop, maxTop)),
      }
    : null;
  const position = dragPosition ?? manualPosition ?? autoPosition;
  const target = manualPosition ? 'manual' : autoPosition.target;
  const opacity = hovered || draggingRef.current ? 0.94 : target === 'selection' ? 0.82 : 0.68;

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) { return; }
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    const pointer = clientToContainerPoint(
      { x: event.clientX, y: event.clientY },
      containerRef.current?.getBoundingClientRect(),
    );
    dragOffsetRef.current = {
      x: pointer.x - position.left,
      y: pointer.y - position.top,
    };
    setDragPosition({ left: position.left, top: position.top });
  }, [containerRef, position.left, position.top]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) { return; }
      setDragPosition(resolvePetManualDragPosition({
        client: { x: event.clientX, y: event.clientY },
        containerRect: containerRef.current?.getBoundingClientRect(),
        dragOffset: dragOffsetRef.current,
        maxLeft,
        maxTop,
      }));
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!draggingRef.current) { return; }
      draggingRef.current = false;
      const nextPosition = resolvePetManualDragPosition({
        client: { x: event.clientX, y: event.clientY },
        containerRect: containerRef.current?.getBoundingClientRect(),
        dragOffset: dragOffsetRef.current,
        maxLeft,
        maxTop,
      });
      setDragPosition(null);
      setCanvasPetPosition(nextPosition.left, nextPosition.top, true);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [containerRef, maxLeft, maxTop, setCanvasPetPosition]);

  if (!enabled || !hydrated || displayMode !== 'canvas-follow' || mode !== 'roaming') { return null; }
  if (containerSize.width <= 0 || containerSize.height <= 0) { return null; }

  return (
    <div
      style={{
        position: 'absolute',
        left: position.left,
        top: position.top,
        width: widget.width,
        height: widget.height,
        zIndex: 70,
        pointerEvents: 'none',
        opacity,
        transition: dragPosition ? 'opacity 0.25s ease' : 'left 0.18s ease-out, top 0.18s ease-out, opacity 0.25s ease',
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={manualPosition ? '拖动调整位置，双击恢复自动跟随' : '拖动到任意位置'}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          resetCanvasPetPosition();
        }}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          pointerEvents: 'auto',
          cursor: dragPosition ? 'grabbing' : 'grab',
          filter: lowDetail ? 'drop-shadow(0 3px 8px rgba(0,0,0,0.28))' : 'drop-shadow(0 4px 12px rgba(0,0,0,0.32))',
        }}
      >
        {manualPosition && !lowDetail && (
          <button
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              resetCanvasPetPosition();
            }}
            title="恢复自动跟随"
            style={{
              position: 'absolute',
              right: 2,
              top: 2,
              zIndex: 12,
              width: 18,
              height: 18,
              borderRadius: 999,
              border: '1px solid rgba(0,0,0,0.35)',
              background: 'rgba(255,255,255,0.92)',
              color: '#333',
              fontSize: 11,
              lineHeight: '16px',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            ↺
          </button>
        )}
        <PetSuggestionCard
          placement="canvas"
          anchor={{
            left: position.left,
            top: position.top,
            width: widget.width,
            height: widget.height,
            containerWidth: containerSize.width,
            containerHeight: containerSize.height,
          }}
        />
        <PetCharacter
          renderHeight={lowDetail ? 34 : 46}
          showBubble={!autoPosition.lowDetail}
          bubbleMaxWidth={180}
        />
      </div>
    </div>
  );
}
