import type React from 'react';

export const NODE_PORT_SIZE = 10;

export function buildNodePortStyle(color: string): React.CSSProperties {
  return {
    width: NODE_PORT_SIZE,
    height: NODE_PORT_SIZE,
    background: color,
    borderRadius: '50%',
    border: 'none',
  };
}
