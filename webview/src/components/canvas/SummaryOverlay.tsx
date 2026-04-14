import React, { useCallback, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import type { SummaryGroup } from '../../../../../src/core/canvas-model';
import { useCanvasStore } from '../../stores/canvas-store';
import { DEFAULT_GROUP_COLOR } from './SummaryNameDialog';

interface SummaryOverlayProps {
  group: SummaryGroup;
}

/**
 * Renders a single summary group as a dashed bounding rectangle
 * positioned in flow-space (moves/zooms with the canvas).
 * Header is draggable — drags all member nodes together.
 */
function SummaryOverlay({ group }: SummaryOverlayProps) {
  const { deleteSummary, moveSummary, setShowSummaryDialog, setEditingSummaryId } = useCanvasStore();
  const { screenToFlowPosition } = useReactFlow();
  const { bounds, name, id, nodeIds, color } = group;
  const [dragging, setDragging] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startScreenX: number; startScreenY: number; startFlowX: number; startFlowY: number } | null>(null);

  const groupColor = color || DEFAULT_GROUP_COLOR;

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSummary(id);
  }, [id, deleteSummary]);

  const handleEdit = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCtxMenu(null);
    setEditingSummaryId(id);
    setShowSummaryDialog(true);
  }, [id, setEditingSummaryId, setShowSummaryDialog]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Don't start drag on right-click
    if (e.button !== 0) { return; }
    e.stopPropagation();
    e.preventDefault();

    const startFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    dragRef.current = {
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startFlowX: startFlow.x,
      startFlowY: startFlow.y,
    };

    let lastFlowX = startFlow.x;
    let lastFlowY = startFlow.y;

    const handleMouseMove = (ev: MouseEvent) => {
      const currentFlow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = currentFlow.x - lastFlowX;
      const dy = currentFlow.y - lastFlowY;
      lastFlowX = currentFlow.x;
      lastFlowY = currentFlow.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        moveSummary(id, dx, dy);
      }
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      setDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    setDragging(true);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [id, screenToFlowPosition, moveSummary]);

  const HEADER_H = 26;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: bounds.x,
          top: bounds.y - HEADER_H,
          width: bounds.width,
          height: bounds.height + HEADER_H,
          pointerEvents: 'none',
        }}
      >
        {/* Header bar — draggable + right-clickable */}
        <div
          onMouseDown={handleDragStart}
          onContextMenu={handleContextMenu}
          style={{
            height: HEADER_H,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 8px',
            background: groupColor,
            color: '#fff',
            borderRadius: '6px 6px 0 0',
            fontSize: 11,
            fontWeight: 600,
            pointerEvents: 'auto',
            cursor: dragging ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
            {name}
          </span>
          <span style={{ fontSize: 10, opacity: 0.8, textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
            {nodeIds.length} 节点
          </span>
          {/* Edit button */}
          <button
            onClick={handleEdit}
            style={{
              background: 'transparent',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              padding: '0 2px',
              lineHeight: 1,
              opacity: 0.7,
              pointerEvents: 'auto',
            }}
            title="编辑归纳"
          >
            ✎
          </button>
          {/* Delete button */}
          <button
            onClick={handleDelete}
            style={{
              background: 'transparent',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              padding: '0 2px',
              lineHeight: 1,
              opacity: 0.7,
              pointerEvents: 'auto',
            }}
            title="删除归纳"
          >
            ×
          </button>
        </div>

        {/* Dashed bounding rectangle */}
        <div
          style={{
            width: '100%',
            height: bounds.height,
            border: `2px dashed ${groupColor}`,
            borderRadius: '0 0 6px 6px',
          }}
        />
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <SummaryContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

/* ── Right-click context menu for a summary group ── */

function SummaryContextMenu({ x, y, onEdit, onDelete, onClose }: {
  x: number;
  y: number;
  onEdit: (e?: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const close = () => onClose();
    const closeKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); } };
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

  const menu = (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        background: 'var(--vscode-menu-background, var(--vscode-editor-background))',
        border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        zIndex: 99999,
        minWidth: 140,
        overflow: 'hidden',
        fontSize: 12,
      }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      <CtxMenuItem label="✎ 编辑归纳" onClick={(e) => { e.stopPropagation(); onEdit(); }} />
      <CtxMenuItem label="🗑 删除归纳" onClick={onDelete} danger />
    </div>
  );

  return ReactDOM.createPortal(menu, document.body);
}

function CtxMenuItem({ label, onClick, danger }: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block',
        width: '100%',
        padding: '7px 14px',
        background: hovered
          ? (danger
            ? 'var(--vscode-inputValidation-errorBackground, rgba(180,0,0,0.3))'
            : 'var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground))')
          : 'none',
        border: 'none',
        color: danger
          ? 'var(--vscode-errorForeground, #f48771)'
          : 'var(--vscode-menu-foreground, var(--vscode-foreground))',
        fontSize: 12,
        textAlign: 'left',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/**
 * Renders all summary group overlays inside the ReactFlow viewport,
 * so they pan and zoom with the canvas.
 */
export function SummaryOverlays() {
  const { summaryGroups } = useCanvasStore();

  if (summaryGroups.length === 0) { return null; }

  return (
    <ViewportPortal>
      {summaryGroups.map(g => (
        <SummaryOverlay key={g.id} group={g} />
      ))}
    </ViewportPortal>
  );
}
