import React, { useEffect, useState } from 'react';

interface PetBubbleProps {
  text: string;
  /** Max width constraint — defaults to 200, should be smaller for roaming */
  maxWidth?: number;
  /** If provided, clicking the bubble calls this */
  onClick?: () => void;
  onAccept?: () => void;
  onLater?: () => void;
  onMute?: () => void;
}

/**
 * Speech bubble that appears above the pet.
 * Styled after vscode-pets: white background, dark border, CSS triangle tail.
 */
export function PetBubble({ text, maxWidth = 200, onClick, onAccept, onLater, onMute }: PetBubbleProps) {
  const [visible, setVisible] = useState(false);
  const hasActions = !!onAccept || !!onLater || !!onMute;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: 6,
        padding: '5px 8px',
        background: '#fff',
        color: '#333',
        border: '2px solid #333',
        borderRadius: 8,
        fontSize: 11,
        lineHeight: 1.4,
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        width: 'max-content',
        maxWidth,
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
        pointerEvents: onClick || hasActions ? 'auto' : 'none',
        cursor: onClick ? 'pointer' : undefined,
        zIndex: 10,
        textAlign: 'center',
      }}
    >
      <div>{text}</div>
      {hasActions && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            justifyContent: 'center',
            marginTop: 5,
            paddingTop: 4,
            borderTop: '1px solid rgba(0,0,0,0.12)',
          }}
        >
          {onAccept && (
            <button
              onClick={(e) => { e.stopPropagation(); onAccept(); }}
              style={bubbleActionButtonStyle}
            >
              采纳
            </button>
          )}
          {onLater && (
            <button
              onClick={(e) => { e.stopPropagation(); onLater(); }}
              style={bubbleActionButtonStyle}
            >
              稍后
            </button>
          )}
          {onMute && (
            <button
              onClick={(e) => { e.stopPropagation(); onMute(); }}
              style={bubbleActionButtonStyle}
            >
              不再提醒
            </button>
          )}
        </div>
      )}
      {/* Tail — outer (border color) */}
      <div
        style={{
          position: 'absolute',
          bottom: -10,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '8px solid #333',
        }}
      />
      {/* Tail — inner (fill color) */}
      <div
        style={{
          position: 'absolute',
          bottom: -6,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderTop: '6px solid #fff',
        }}
      />
    </div>
  );
}

const bubbleActionButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(0,0,0,0.25)',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.9)',
  color: '#333',
  fontSize: 10,
  lineHeight: 1.2,
  padding: '2px 6px',
  cursor: 'pointer',
};
