import React, { useCallback, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import type { Board } from '../../../../src/core/canvas-model';
import { useCanvasStore, startBoardDrag, endBoardDrag } from '../../stores/canvas-store';

// ── Color presets (shared with BoardDropdown) ────────────────────────────────

export const BOARD_COLOR_PRESETS = [
  { value: '#4fc3f7', label: '蓝' },
  { value: '#81c784', label: '绿' },
  { value: '#ffb74d', label: '橙' },
  { value: '#e57373', label: '红' },
  { value: '#ba68c8', label: '紫' },
  { value: '#fff176', label: '黄' },
  { value: '#4dd0e1', label: '青' },
  { value: '#f06292', label: '粉' },
];

// ── Resize handle positions ──────────────────────────────────────────────────

type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_SIZE = 8;

function getHandleStyle(pos: HandlePos, bounds: Board['bounds']): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: '#fff',
    border: '1.5px solid var(--vscode-focusBorder, #007fd4)',
    borderRadius: 2,
    pointerEvents: 'auto',
    zIndex: 2,
  };
  const half = HANDLE_SIZE / 2;
  const w = bounds.width;
  const h = bounds.height;

  switch (pos) {
    case 'nw': return { ...base, left: -half, top: -half, cursor: 'nwse-resize' };
    case 'n':  return { ...base, left: w / 2 - half, top: -half, cursor: 'ns-resize' };
    case 'ne': return { ...base, left: w - half, top: -half, cursor: 'nesw-resize' };
    case 'e':  return { ...base, left: w - half, top: h / 2 - half, cursor: 'ew-resize' };
    case 'se': return { ...base, left: w - half, top: h - half, cursor: 'nwse-resize' };
    case 's':  return { ...base, left: w / 2 - half, top: h - half, cursor: 'ns-resize' };
    case 'sw': return { ...base, left: -half, top: h - half, cursor: 'nesw-resize' };
    case 'w':  return { ...base, left: -half, top: h / 2 - half, cursor: 'ew-resize' };
  }
}

// ── Single Board Overlay ─────────────────────────────────────────────────────

interface BoardOverlayProps {
  board: Board;
}

function BoardOverlay({ board }: BoardOverlayProps) {
  const deleteBoard = useCanvasStore(s => s.deleteBoard);
  const moveBoard = useCanvasStore(s => s.moveBoard);
  const resizeBoard = useCanvasStore(s => s.resizeBoard);
  const updateBoard = useCanvasStore(s => s.updateBoard);
  const activeBoardId = useCanvasStore(s => s.activeBoardId);
  const setActiveBoardId = useCanvasStore(s => s.setActiveBoardId);
  const { screenToFlowPosition } = useReactFlow();
  const { bounds, name, id, color, borderColor } = board;
  const [dragging, setDragging] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [editColor, setEditColor] = useState(borderColor);
  const editInputRef = useRef<HTMLInputElement>(null);
  const isActive = activeBoardId === id;

  const HEADER_H = 44;

  // Adaptive text color based on borderColor luminance
  const textColor = contrastTextColor(borderColor);
  const textShadow = contrastTextShadow(borderColor);

  // ── Header drag ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Snapshot which nodes are inside the board RIGHT NOW (before moving)
    const state = useCanvasStore.getState();
    startBoardDrag(id, state.nodes, state.boards);

    const startFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    let lastFlowX = startFlow.x;
    let lastFlowY = startFlow.y;

    const handleMouseMove = (ev: MouseEvent) => {
      const currentFlow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = currentFlow.x - lastFlowX;
      const dy = currentFlow.y - lastFlowY;
      lastFlowX = currentFlow.x;
      lastFlowY = currentFlow.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        moveBoard(id, dx, dy);
      }
    };

    const handleMouseUp = () => {
      setDragging(false);
      endBoardDrag();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    setDragging(true);
    setActiveBoardId(id);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [id, screenToFlowPosition, moveBoard, setActiveBoardId]);

  // ── Resize handle drag ──────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent, pos: HandlePos) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const startFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const startBounds = { ...bounds };

    const handleMouseMove = (ev: MouseEvent) => {
      const cur = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = cur.x - startFlow.x;
      const dy = cur.y - startFlow.y;

      let { x, y, width, height } = startBounds;

      // Compute new bounds based on handle position
      if (pos.includes('w')) { x += dx; width -= dx; }
      if (pos.includes('e')) { width += dx; }
      if (pos.includes('n')) { y += dy; height -= dy; }
      if (pos.includes('s')) { height += dy; }

      resizeBoard(id, { x, y, width, height });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [id, bounds, screenToFlowPosition, resizeBoard]);

  // ── Context menu ────────────────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleDelete = useCallback(() => {
    setCtxMenu(null);
    deleteBoard(id);
  }, [id, deleteBoard]);

  const handleEditStart = useCallback(() => {
    setCtxMenu(null);
    setEditName(name);
    setEditColor(borderColor);
    setEditing(true);
    setTimeout(() => editInputRef.current?.select(), 50);
  }, [name, borderColor]);

  const handleEditConfirm = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed) {
      const newBorderColor = editColor;
      const newColor = hexToRgbaLocal(newBorderColor, 0.12);
      updateBoard(id, { name: trimmed, color: newColor, borderColor: newBorderColor });
    }
    setEditing(false);
  }, [id, editName, editColor, updateBoard]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveBoardId(id);
  }, [id, setActiveBoardId]);

  const handles: HandlePos[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  return (
    <>
      <div
        onClick={handleClick}
        style={{
          position: 'absolute',
          left: bounds.x,
          top: bounds.y - HEADER_H,
          width: bounds.width,
          height: bounds.height + HEADER_H,
          pointerEvents: 'none',
        }}
      >
        {/* Header bar */}
        <div
          onMouseDown={handleDragStart}
          onContextMenu={handleContextMenu}
          style={{
            height: HEADER_H,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 14px',
            background: borderColor,
            color: textColor,
            borderRadius: '6px 6px 0 0',
            fontSize: 28,
            fontWeight: 700,
            pointerEvents: 'auto',
            cursor: dragging ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
        >
          <span style={{ fontSize: 22 }}>📋</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow }}>
            {name}
          </span>
          <button onClick={(e) => { e.stopPropagation(); handleEditStart(); }} style={{ ...headerBtnStyle, color: textColor }} title="编辑画板">✎</button>
          <button onClick={(e) => { e.stopPropagation(); handleDelete(); }} style={{ ...headerBtnStyle, color: textColor, fontSize: 28 }} title="删除画板">×</button>
        </div>

        {/* Body — semi-transparent fill, pointer-events:none so nodes on top are clickable */}
        <div
          onContextMenu={handleContextMenu}
          style={{
            width: '100%',
            height: bounds.height,
            background: color,
            border: `1.5px solid ${borderColor}`,
            borderRadius: '0 0 6px 6px',
            position: 'relative',
            pointerEvents: 'none',
          }}
        >
          {/* Resize handles — show on active/hover */}
          {isActive && handles.map(pos => (
            <div
              key={pos}
              onMouseDown={(e) => handleResizeStart(e, pos)}
              style={getHandleStyle(pos, bounds)}
            />
          ))}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <BoardContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onEdit={handleEditStart}
          onDelete={handleDelete}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Inline edit dialog */}
      {editing && (
        <BoardEditDialog
          name={editName}
          setName={setEditName}
          color={editColor}
          setColor={setEditColor}
          inputRef={editInputRef}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditing(false)}
        />
      )}
    </>
  );
}

const headerBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontSize: 24,
  padding: '0 4px',
  lineHeight: 1,
  opacity: 0.8,
  pointerEvents: 'auto',
  textShadow: '0 1px 2px rgba(0,0,0,0.4)',
};

// ── Board context menu ───────────────────────────────────────────────────────

function BoardContextMenu({ x, y, onEdit, onDelete, onClose }: {
  x: number; y: number;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const close = () => onClose();
    const closeKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const tid = setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
      window.addEventListener('keydown', closeKey);
    }, 0);
    return () => {
      clearTimeout(tid);
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', closeKey);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', left: x, top: y,
      background: 'var(--vscode-menu-background, var(--vscode-editor-background))',
      border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
      borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      zIndex: 99999, minWidth: 140, overflow: 'hidden', fontSize: 12,
    }} onClick={e => e.stopPropagation()}>
      <CtxItem label="✎ 编辑画板" onClick={() => { onEdit(); onClose(); }} />
      <CtxItem label="🗑 删除画板" onClick={() => { onDelete(); onClose(); }} danger />
    </div>,
    document.body
  );
}

function CtxItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block', width: '100%', padding: '7px 14px',
        background: hovered
          ? (danger ? 'var(--vscode-inputValidation-errorBackground, rgba(180,0,0,0.3))' : 'var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground))')
          : 'none',
        border: 'none', fontSize: 12, textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap',
        color: danger ? 'var(--vscode-errorForeground, #f48771)' : 'var(--vscode-menu-foreground, var(--vscode-foreground))',
      }}
    >{label}</button>
  );
}

// ── Inline edit dialog ───────────────────────────────────────────────────────

function BoardEditDialog({ name, setName, color, setColor, inputRef, onConfirm, onCancel }: {
  name: string; setName: (v: string) => void;
  color: string; setColor: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return ReactDOM.createPortal(
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--vscode-editor-background)',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: 8, padding: 16, width: 320,
        display: 'flex', flexDirection: 'column', gap: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>编辑画板</div>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }}
          placeholder="画板名称"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '6px 8px',
            background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
            borderRadius: 4, fontSize: 13,
          }}
        />
        <div>
          <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginBottom: 6 }}>边框颜色</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {BOARD_COLOR_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => setColor(p.value)}
                title={p.label}
                style={{
                  width: 24, height: 24, borderRadius: 4,
                  background: p.value,
                  border: color === p.value ? '2px solid var(--vscode-foreground)' : '2px solid transparent',
                  cursor: 'pointer',
                  outline: color === p.value ? '1px solid var(--vscode-focusBorder)' : 'none',
                }}
              />
            ))}
          </div>
        </div>
        {/* Preview */}
        <div style={{
          height: 40, borderRadius: 4,
          background: hexToRgbaLocal(color, 0.12),
          border: `1.5px solid ${color}`,
        }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={dlgBtnStyle}>取消</button>
          <button onClick={onConfirm} style={{ ...dlgBtnStyle, background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)' }}>确认</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const dlgBtnStyle: React.CSSProperties = {
  padding: '4px 14px', fontSize: 12, border: 'none', borderRadius: 4, cursor: 'pointer',
  background: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)',
};

// ── Helper ───────────────────────────────────────────────────────────────────

function hexToRgbaLocal(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Return contrasting text color: dark text for light backgrounds, light text for dark */
function contrastTextColor(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  // Relative luminance (sRGB)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? 'rgba(0,0,0,0.85)' : '#fff';
}

/** Text shadow adapts: light shadow for dark text, dark shadow for light text */
function contrastTextShadow(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55
    ? '0 1px 3px rgba(255,255,255,0.6)'
    : '0 1px 3px rgba(0,0,0,0.5)';
}

// ── Render all boards ────────────────────────────────────────────────────────

export function BoardOverlays() {
  const boards = useCanvasStore(s => s.boards);
  if (boards.length === 0) return null;
  return (
    <ViewportPortal>
      <div style={{ position: 'absolute', inset: 0, zIndex: -1 }}>
        {boards.map(b => <BoardOverlay key={b.id} board={b} />)}
      </div>
    </ViewportPortal>
  );
}
