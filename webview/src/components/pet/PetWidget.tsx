import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePetStore } from '../../stores/pet-store';
import { useDraggable } from '../../pet/use-draggable';
import { PetMinimized } from './PetMinimized';
import { PetRoaming, ROAMING_WIDTH, ROAMING_HEIGHT } from './PetRoaming';
import { PetChat, CHAT_WIDTH, CHAT_HEIGHT } from './PetChat';
import { PetGame, GAME_WIDTH, GAME_HEIGHT } from './PetGame';

const TICK_INTERVAL = 3000; // ms
const MINIMIZED_SIZE = 32;

/**
 * Top-level floating pet overlay.
 * Manages three modes (minimized/roaming/chat), tick lifecycle,
 * drag positioning, and hover opacity.
 */
export function PetWidget() {
  const { enabled, hydrated, mode, widgetLeft, widgetTop, hovered, setAnchor, setHovered } = usePetStore();
  const tickEngine = usePetStore(s => s.tickEngine);
  const savePetState = usePetStore(s => s.savePetState);
  const saveMemory = usePetStore(s => s.saveMemory);
  const addChatResponse = usePetStore(s => s.addChatResponse);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const memorySaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Entrance animation — fade in on first render
  const [mounted, setMounted] = useState(false);
  const [gameHeight, setGameHeight] = useState(GAME_HEIGHT);
  useEffect(() => {
    if (enabled) {
      requestAnimationFrame(() => setMounted(true));
    } else {
      setMounted(false);
    }
  }, [enabled]);

  // Compute widget dimensions based on mode
  const widgetWidth = mode === 'minimized'
    ? MINIMIZED_SIZE
    : mode === 'roaming'
      ? ROAMING_WIDTH
      : mode === 'chat'
        ? CHAT_WIDTH
        : GAME_WIDTH;
  const widgetHeight = mode === 'minimized'
    ? MINIMIZED_SIZE
    : mode === 'roaming'
      ? ROAMING_HEIGHT
      : mode === 'chat'
        ? CHAT_HEIGHT
        : gameHeight;

  // Resolve initial position: widgetTop === -1 means "place at bottom-left"
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const clampedLeft = Math.max(0, Math.min(widgetLeft, vw - widgetWidth));
  const clampedTop = widgetTop >= 0
    ? Math.max(0, Math.min(widgetTop, vh - widgetHeight))
    : vh - widgetHeight - 16;

  // Auto-clamp position when mode changes (e.g. roaming→chat/game makes widget bigger)
  // In chat/game mode, skip persisting — the visual clamp (clampedLeft/clampedTop) handles display,
  // and setMode will restore the original position when the expanded panel closes.
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || mode === 'chat' || mode === 'game') { return; }
    const maxLeft = window.innerWidth - widgetWidth;
    const maxTop = window.innerHeight - widgetHeight;
    if (widgetLeft > maxLeft || (widgetTop >= 0 && widgetTop > maxTop)) {
      setAnchor(
        Math.max(0, Math.min(widgetLeft, maxLeft)),
        Math.max(0, Math.min(widgetTop >= 0 ? widgetTop : 0, maxTop)),
      );
    }
  }, [mode, widgetWidth, widgetHeight]);

  // Drop callback — persist position
  const onDrop = useCallback((left: number, top: number) => {
    setAnchor(left, top);
  }, [setAnchor]);

  const { style: dragStyle, handleProps, isDragging } = useDraggable({
    left: clampedLeft,
    top: clampedTop,
    widgetWidth,
    widgetHeight,
    onDrop,
  });

  // Start/stop tick loop
  useEffect(() => {
    if (!enabled || !hydrated) { return; }

    tickRef.current = setInterval(() => {
      tickEngine();
    }, TICK_INTERVAL);

    stateSaveRef.current = setInterval(() => {
      savePetState();
    }, 10_000);

    memorySaveRef.current = setInterval(() => {
      saveMemory();
    }, 60_000);

    const flushPersist = () => {
      savePetState();
      saveMemory();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        flushPersist();
      }
    };

    window.addEventListener('beforeunload', flushPersist);
    window.addEventListener('pagehide', flushPersist);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); }
      if (stateSaveRef.current) { clearInterval(stateSaveRef.current); }
      if (memorySaveRef.current) { clearInterval(memorySaveRef.current); }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', flushPersist);
      window.removeEventListener('pagehide', flushPersist);
      flushPersist();
    };
  }, [enabled, hydrated, tickEngine, savePetState, saveMemory]);

  // Listen for AI chat responses (centralised — no per-component listener needed)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'petAiChatResponse' && msg.requestId?.startsWith('chat-') && msg.text) {
        addChatResponse(msg.text);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [addChatResponse]);

  // Hover opacity management
  const onMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setHovered(true);
  }, [setHovered]);

  const onMouseLeave = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => {
      setHovered(false);
      hoverTimerRef.current = null;
    }, 1000);
  }, [setHovered]);

  if (!enabled || !hydrated) { return null; }

  // Opacity: roaming uses hover-based opacity; minimized/chat always full
  // Entrance fade-in: start from 0
  const baseOpacity = mode === 'roaming' ? (hovered || isDragging ? 0.9 : 0.65) : 1;
  const opacity = mounted ? baseOpacity : 0;

  return (
    <>
      {/* Full-viewport pointer-events:none overlay */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 800,
        pointerEvents: 'none',
      }}>
        {/* Widget container — pointer-events:auto */}
        <div
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          style={{
            ...dragStyle,
            pointerEvents: 'auto',
            width: widgetWidth,
            height: widgetHeight,
            minWidth: widgetWidth,
            minHeight: mode === 'minimized' ? widgetHeight : undefined,
            maxHeight: mode === 'chat' ? '80vh' : undefined,
            opacity,
            transition: [
              'opacity 0.3s ease',
              'width 0.25s ease-out',
              'height 0.25s ease-out',
              (dragStyle.transition as string) || '',
            ].filter(Boolean).join(', '),
            // Ensure overflow is visible for bubbles in roaming mode
            overflow: 'visible',
          }}
        >
          {mode === 'minimized' && <PetMinimized />}
          {mode === 'roaming' && <PetRoaming dragHandleProps={handleProps} />}
          {mode === 'chat' && <PetChat dragHandleProps={handleProps} />}
          {mode === 'game' && <PetGame dragHandleProps={handleProps} onHeightChange={setGameHeight} />}
        </div>
      </div>

      {/* CSS animations (injected once) */}
      <PetAnimStyles />
    </>
  );
}

/** Inject keyframe animations for pet (minimal — GIF assets self-animate) */
function PetAnimStyles() {
  return (
    <style>{`
      .pet-anim-breathe {
        animation: pet-breathe 3s ease-in-out infinite;
      }
      .pet-anim-zzz {
        animation: pet-zzz 2s ease-in-out infinite;
      }

      @keyframes pet-breathe {
        0%, 100% { transform: translateY(0); }
        50%      { transform: translateY(-2px); }
      }
      @keyframes pet-zzz {
        0%   { opacity: 0; transform: translateY(0) translateX(0); }
        50%  { opacity: 0.8; }
        100% { opacity: 0; transform: translateY(-12px) translateX(6px); }
      }
    `}</style>
  );
}
