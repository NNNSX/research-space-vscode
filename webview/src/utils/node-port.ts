import type React from 'react';

export const NODE_PORT_SIZE = 11;
export const NODE_PORT_HIT_SIZE = 18;
export const NODE_PORT_CLASSNAME = 'rs-node-port';
export const NODE_PORT_IDS = {
  in: 'in',
  out: 'out',
} as const;

export function normalizeNodePortId(id?: string | null): string | undefined {
  if (!id) { return undefined; }
  if (id === 'in-main') { return NODE_PORT_IDS.in; }
  return id;
}

export function buildNodePortStyle(color: string): React.CSSProperties {
  return {
    width: NODE_PORT_HIT_SIZE,
    height: NODE_PORT_HIT_SIZE,
    background: 'transparent',
    border: 'none',
    boxShadow: 'none',
    borderRadius: '50%',
    cursor: 'crosshair',
    pointerEvents: 'all',
    zIndex: 120,
    ['--rs-port-color' as string]: color,
    ['--rs-port-size' as string]: `${NODE_PORT_SIZE}px`,
  };
}
