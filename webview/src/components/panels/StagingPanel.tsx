import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '../../stores/canvas-store';

export const STAGING_NODE_KEY = 'application/rs-staging-node';

// ── Inject keyframe animations once ───────────────────────────────────────

const STYLE_ID = 'rs-staging-animations';
function ensureAnimations() {
  if (document.getElementById(STYLE_ID)) { return; }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes stagingSlideIn {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
    @keyframes stagingNodeFlash {
      0%   { background: var(--vscode-list-activeSelectionBackground); }
      100% { background: transparent; }
    }
    .rs-staging-node-flash {
      animation: stagingNodeFlash 0.7s ease forwards;
    }
    @keyframes stagingGlow {
      0%   { box-shadow: 0 4px 16px rgba(0,0,0,0.35), 0 0 8px 2px rgba(59,130,246,0.5); }
      50%  { box-shadow: 0 4px 16px rgba(0,0,0,0.35), 0 0 14px 4px rgba(99,102,241,0.6); }
      100% { box-shadow: 0 4px 16px rgba(0,0,0,0.35), 0 0 8px 2px rgba(59,130,246,0.5); }
    }
    @keyframes stagingBorderFlow {
      0%   { border-color: rgba(59,130,246,0.6); }
      33%  { border-color: rgba(139,92,246,0.6); }
      66%  { border-color: rgba(236,72,153,0.6); }
      100% { border-color: rgba(59,130,246,0.6); }
    }
  `;
  document.head.appendChild(style);
}

// ── Node type display helpers ──────────────────────────────────────────────

function nodeIcon(type: string): string {
  switch (type) {
    case 'paper':          return '📄';
    case 'note':           return '📝';
    case 'code':           return '💻';
    case 'image':          return '🖼';
    case 'ai_output':      return '🤖';
    case 'audio':          return '🎵';
    case 'video':          return '🎬';
    case 'experiment_log': return '🧪';
    case 'task':           return '✅';
    case 'data':           return '📊';
    case 'mindmap':        return '🧠';
    case 'board':          return '📋';
    case 'function':       return '⚡';
    case 'blueprint':      return '📦';
    default:               return '📎';
  }
}

// ── StagingPanel ───────────────────────────────────────────────────────────

export function StagingPanel() {
  const stagingNodes = useCanvasStore(s => s.stagingNodes);
  const pendingStagingMaterializations = useCanvasStore(s => s.pendingStagingMaterializations);
  const removeFromStaging = useCanvasStore(s => s.removeFromStaging);
  const requestDeleteConfirm = useCanvasStore(s => s.requestDeleteConfirm);

  // Only show data nodes + boards — function/blueprint nodes go directly to canvas
  const fileNodes = stagingNodes.filter(n =>
    n.node_type === 'paper' || n.node_type === 'note' ||
    n.node_type === 'code'  || n.node_type === 'image' ||
    n.node_type === 'ai_output' || n.node_type === 'audio' ||
    n.node_type === 'video' || n.node_type === 'experiment_log' ||
    n.node_type === 'task' || n.node_type === 'data' ||
    n.node_type === 'mindmap' ||
    (n.node_type as string) === 'board'
  );

  // ── Flash animation for newly added nodes ─────────────────────────────────
  const prevIdsRef = useRef<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    ensureAnimations();
  }, []);

  useEffect(() => {
    const prevIds = prevIdsRef.current;
    const newIds = fileNodes.map(n => n.id).filter(id => !prevIds.has(id));
    prevIdsRef.current = new Set(fileNodes.map(n => n.id));
    if (newIds.length > 0) {
      setFlashIds(new Set(newIds));
      const t = setTimeout(() => setFlashIds(new Set()), 700);
      return () => clearTimeout(t);
    }
  // fileNodes identity changes on every render — compare by serialized ids
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileNodes.map(n => n.id).join(',')]);

  // Whether this is a fresh mount (panel appearing for the first time)
  const mountedRef = useRef(false);

  // Window position — top-right, below the toolbar (toolbar height = 40px)
  const [pos, setPos] = useState<{ right: number; top: number }>({ right: 16, top: 56 });
  // During drag we track absolute left/top
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
  const draggingWindow = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Window drag handlers
  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingWindow.current = true;
    // Convert current right/bottom to left/top for absolute positioning
    const el = (e.currentTarget as HTMLElement).closest('[data-staging-panel]') as HTMLElement;
    const rect = el.getBoundingClientRect();
    setDragPos({ left: rect.left, top: rect.top });
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingWindow.current) { return; }
      setDragPos({
        left: e.clientX - dragOffset.current.x,
        top: e.clientY - dragOffset.current.y,
      });
    };
    const onUp = (e: MouseEvent) => {
      if (!draggingWindow.current) { return; }
      draggingWindow.current = false;
      // Commit final absolute position back into right/top relative coords
      const left = e.clientX - dragOffset.current.x;
      const top  = e.clientY - dragOffset.current.y;
      setPos({ right: window.innerWidth - left - 220, top });
      setDragPos(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (fileNodes.length === 0) { return null; }

  // Play slide-in only on first appearance
  const isFirstMount = !mountedRef.current;
  mountedRef.current = true;

  const panelStyle: React.CSSProperties = dragPos
    ? { position: 'fixed', left: dragPos.left, top: dragPos.top }
    : { position: 'fixed', right: pos.right, top: pos.top };

  return (
    <div
      data-staging-panel=""
      style={{
        ...panelStyle,
        width: 220,
        background: 'var(--vscode-sideBar-background)',
        border: '1.5px solid rgba(59,130,246,0.6)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35), 0 0 10px 2px rgba(59,130,246,0.45)',
        zIndex: 1000,
        overflow: 'hidden',
        userSelect: 'none',
        animation: [
          isFirstMount ? 'stagingSlideIn 0.2s ease' : '',
          'stagingGlow 2.5s ease-in-out infinite',
          'stagingBorderFlow 3s linear infinite',
        ].filter(Boolean).join(', '),
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          background: 'var(--vscode-titleBar-activeBackground)',
          cursor: 'grab',
          borderBottom: '1px solid var(--vscode-panel-border)',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 12 }}>📦</span>
        <span style={{
          flex: 1,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--vscode-titleBar-activeForeground)',
        }}>
          暂存架
        </span>
        <span style={{
          fontSize: 10,
          color: 'var(--vscode-descriptionForeground)',
          fontWeight: 400,
        }}>
          拖至画布放置
        </span>
      </div>

      {/* Node cards */}
      <div style={{ padding: '6px 6px', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
        {fileNodes.map(node => (
          <div
            key={node.id}
            draggable
            onDragStart={e => {
              if (pendingStagingMaterializations[node.id]) {
                e.preventDefault();
                return;
              }
              e.dataTransfer.setData(STAGING_NODE_KEY, node.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            className={flashIds.has(node.id) ? 'rs-staging-node-flash' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 8px',
              background: 'var(--vscode-input-background)',
              border: '1px solid var(--vscode-input-border, transparent)',
              borderRadius: 5,
              cursor: pendingStagingMaterializations[node.id] ? 'progress' : 'grab',
              fontSize: 12,
              opacity: pendingStagingMaterializations[node.id] ? 0.7 : 1,
            }}
          >
            <span style={{ flexShrink: 0, fontSize: 14 }}>{nodeIcon(node.node_type)}</span>
            <span style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--vscode-foreground)',
              fontSize: 12,
            }}>
              {node.title}
            </span>
            {pendingStagingMaterializations[node.id] && (
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  color: 'var(--vscode-descriptionForeground)',
                }}
              >
                创建中…
              </span>
            )}
            <button
              onClick={() => requestDeleteConfirm({
                title: '确认从暂存架移除',
                message: `确认将“${node.title}”从暂存架移除？`,
                confirmLabel: '移除',
                onConfirm: () => removeFromStaging(node.id),
              })}
              disabled={!!pendingStagingMaterializations[node.id]}
              title="从暂存架移除"
              style={{
                flexShrink: 0,
                background: 'none',
                border: 'none',
                color: 'var(--vscode-descriptionForeground)',
                cursor: pendingStagingMaterializations[node.id] ? 'not-allowed' : 'pointer',
                fontSize: 12,
                padding: '0 2px',
                lineHeight: 1,
                opacity: pendingStagingMaterializations[node.id] ? 0.4 : 1,
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
