import type React from 'react';

export const NODE_RADIUS = 10;
export const NODE_BORDER_WIDTH = 1.5;
export const NODE_SELECTED_BORDER_WIDTH = 2;
export const NODE_HEADER_ICON_SIZE = 15;
export const NODE_CONTENT_GUTTER = 10;
export const NODE_RESIZE_HIT_THICKNESS = 10;
export const NODE_RESIZE_HANDLE_SIZE = 12;

export const NODE_HEADER_TITLE_STYLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--vscode-editor-foreground)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const NODE_CHROME_STYLE_ID = 'rs-node-chrome-style';

export function ensureNodeChromeStyles() {
  if (typeof document === 'undefined' || document.getElementById(NODE_CHROME_STYLE_ID)) { return; }
  const style = document.createElement('style');
  style.id = NODE_CHROME_STYLE_ID;
  style.textContent = `
    .rs-node-surface {
      transition: border-color 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
    }
    .rs-node-surface.rs-node-surface--interactive:hover {
      box-shadow: 0 10px 22px rgba(0,0,0,0.22);
    }
    .rs-group-shell,
    .rs-group-header {
      transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease, opacity 160ms ease;
    }
    .rs-group-header:hover {
      box-shadow: 0 10px 22px rgba(0,0,0,0.18);
    }
    .rs-node-port {
      position: absolute;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      pointer-events: all;
      overflow: visible;
    }
    .rs-node-port::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: var(--rs-port-size, 11px);
      height: var(--rs-port-size, 11px);
      transform: translate(-50%, -50%);
      border-radius: 999px;
      background: var(--rs-port-color, var(--vscode-editor-foreground));
      border: 2px solid var(--vscode-editor-background);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.12);
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(style);
}

export function withAlpha(color: string, alpha: number, fallback = 'transparent'): string {
  const normalized = color.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
    const hex = normalized.slice(1);
    const [r, g, b] = hex.length === 3
      ? hex.split('').map(ch => parseInt(ch + ch, 16))
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map(part => parseInt(part, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return fallback;
}
