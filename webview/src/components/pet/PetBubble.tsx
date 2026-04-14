import React, { useEffect, useState } from 'react';

interface PetBubbleProps {
  text: string;
  /** Max width constraint — defaults to 200, should be smaller for roaming */
  maxWidth?: number;
  /** If provided, clicking the bubble calls this */
  onClick?: () => void;
}

/**
 * Speech bubble that appears above the pet.
 * Styled after vscode-pets: white background, dark border, CSS triangle tail.
 */
export function PetBubble({ text, maxWidth = 200, onClick }: PetBubbleProps) {
  const [visible, setVisible] = useState(false);

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
        pointerEvents: onClick ? 'auto' : 'none',
        cursor: onClick ? 'pointer' : undefined,
        zIndex: 10,
        textAlign: 'center',
      }}
    >
      {text}
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
