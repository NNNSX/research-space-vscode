import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import type { CanvasNode } from '../../../../src/core/canvas-model';
import { useCanvasStore } from '../../stores/canvas-store';

interface NodeGroupNodeData {
  hub_group_id?: string;
}

const HEADER_H = 38;
const COLLAPSED_WIDTH = 220;
const COLLAPSED_HEIGHT = 72;
const PORT_SIZE = 10;

export function NodeGroupNode({ id, data }: NodeProps) {
  const hubData = data as unknown as NodeGroupNodeData & CanvasNode;
  const groupId = hubData.meta?.hub_group_id ?? hubData.hub_group_id;
  const group = useCanvasStore(s =>
    groupId
      ? s.nodeGroups.find(g => g.id === groupId)
      : s.nodeGroups.find(g => g.hubNodeId === id)
  );
  const {
    nodes,
    deleteNodeGroup,
    toggleNodeGroupCollapse,
    setSelectedNodeIds,
  } = useCanvasStore();
  const renameNodeGroup = useCanvasStore(s => s.renameNodeGroup);
  const updateNodeInternals = useUpdateNodeInternals();

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(group?.name ?? hubData.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameDraft(group?.name ?? hubData.title);
  }, [group?.name, hubData.title]);

  useEffect(() => {
    updateNodeInternals(id);
    const raf = window.requestAnimationFrame(() => updateNodeInternals(id));
    return () => window.cancelAnimationFrame(raf);
  }, [id, group?.bounds.height, group?.bounds.width, group?.collapsed, group?.nodeIds.length, updateNodeInternals]);

  const handleGroupClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNodeIds([]);
  }, [setSelectedNodeIds]);

  const openRename = useCallback(() => {
    if (!group) { return; }
    setCtxMenu(null);
    setNameDraft(group.name);
    setRenameOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [group]);

  const confirmRename = useCallback(() => {
    if (!group) { return; }
    renameNodeGroup(group.id, nameDraft);
    setRenameOpen(false);
  }, [group, nameDraft, renameNodeGroup]);

  const portStyle = useMemo<React.CSSProperties>(() => ({
    width: PORT_SIZE,
    height: PORT_SIZE,
    border: 'none',
    background: group?.borderColor ?? '#d8b648',
    borderRadius: '50%',
    cursor: 'crosshair',
    pointerEvents: 'all',
    zIndex: 120,
  }), [group?.borderColor]);

  if (!group) { return null; }

  const memberCount = group.nodeIds.length;
  const title = `${group.name} (${memberCount})`;
  const isCollapsed = !!group.collapsed;
  const width = isCollapsed ? COLLAPSED_WIDTH : group.bounds.width;
  const height = isCollapsed ? COLLAPSED_HEIGHT : group.bounds.height;
  const borderColor = group.borderColor ?? '#d8b648';
  const visibleMembers = group.nodeIds.filter(id => nodes.some(n => n.id === id));

  if (visibleMembers.length === 0) { return null; }

  return (
    <>
      <div
        style={{
          width,
          height,
          position: 'relative',
          pointerEvents: 'none',
          overflow: 'visible',
          zIndex: 60,
        }}
      >
        {isCollapsed ? (
          <div
            onDoubleClick={() => toggleNodeGroupCollapse(group.id)}
            onClick={handleGroupClick}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu({ x: e.clientX, y: e.clientY });
            }}
            className="rs-group-header"
            style={{
              pointerEvents: 'auto',
              position: 'relative',
              zIndex: 80,
              width: COLLAPSED_WIDTH,
              height: COLLAPSED_HEIGHT,
              borderRadius: 10,
              border: `2px solid ${borderColor}`,
              background: 'transparent',
              boxShadow: '0 8px 20px rgba(0,0,0,0.22)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
              gap: 10,
              cursor: 'grab',
              boxSizing: 'border-box',
              color: 'var(--vscode-foreground)',
            }}
          >
            <span style={{ fontSize: 19, lineHeight: 1 }}>◫</span>
            <span style={{
              fontSize: 16,
              fontWeight: 800,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            >
              {title}
            </span>
          </div>
        ) : (
          <>
            <div
              onClick={handleGroupClick}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCtxMenu({ x: e.clientX, y: e.clientY });
              }}
              className="rs-group-header"
              style={{
                pointerEvents: 'auto',
                position: 'relative',
                zIndex: 80,
                height: HEADER_H,
                borderRadius: '8px 8px 0 0',
                border: `2px dashed ${borderColor}`,
                borderBottom: 'none',
                background: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 10px',
                cursor: 'grab',
                userSelect: 'none',
                color: 'var(--vscode-foreground)',
                boxSizing: 'border-box',
              }}
            >
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
              >
                <span style={{ fontSize: 19, lineHeight: 1 }}>◫</span>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{title}</span>
              </span>
              <span className="nodrag" style={{ display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'auto' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleNodeGroupCollapse(group.id);
                  }}
                  style={iconBtnStyle}
                  title="折叠"
                >
                  -
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNodeGroup(group.id);
                  }}
                  style={iconBtnStyle}
                  title="删除"
                >
                  x
                </button>
              </span>
            </div>
            <div
              style={{
                pointerEvents: 'none',
                position: 'relative',
                zIndex: 40,
                width,
                height: Math.max(0, height - HEADER_H),
                borderRadius: '0 0 8px 8px',
                border: `2px dashed ${borderColor}`,
                borderTop: 'none',
                background: 'transparent',
                boxSizing: 'border-box',
              }}
            />
          </>
        )}

        <Handle
          type="target"
          position={Position.Left}
          id="in"
          isConnectable
          isConnectableStart={false}
          isConnectableEnd
          style={portStyle}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          isConnectable
          isConnectableStart
          isConnectableEnd={false}
          style={portStyle}
        />
      </div>

      {ctxMenu && (
        <GroupMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onRename={openRename}
          onToggle={() => {
            toggleNodeGroupCollapse(group.id);
            setCtxMenu(null);
          }}
          onDelete={() => {
            deleteNodeGroup(group.id);
            setCtxMenu(null);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {renameOpen && (
        <RenameDialog
          inputRef={inputRef}
          name={nameDraft}
          setName={setNameDraft}
          onConfirm={confirmRename}
          onCancel={() => setRenameOpen(false)}
        />
      )}
    </>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(0,0,0,0.15)',
  color: 'var(--vscode-foreground)',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: '22px',
  padding: 0,
};

function GroupMenu({ x, y, onRename, onToggle, onDelete, onClose }: {
  x: number;
  y: number;
  onRename: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const close = () => onClose();
    const timer = setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
      window.addEventListener('keydown', close);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed',
      left: x,
      top: y,
      zIndex: 10020,
      background: 'var(--vscode-menu-background, var(--vscode-editor-background))',
      border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
      borderRadius: 6,
      boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
      minWidth: 130,
      overflow: 'hidden',
    }}>
      <MenuItem label="重命名" onClick={onRename} />
      <MenuItem label="折叠/展开" onClick={onToggle} />
      <MenuItem label="删除组" onClick={onDelete} danger />
    </div>,
    document.body
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        border: 'none',
        padding: '7px 10px',
        background: 'transparent',
        textAlign: 'left',
        fontSize: 12,
        color: danger ? 'var(--vscode-errorForeground)' : 'var(--vscode-foreground)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function RenameDialog({ inputRef, name, setName, onConfirm, onCancel }: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  name: string;
  setName: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return ReactDOM.createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10030,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 320,
          padding: 14,
          borderRadius: 8,
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700 }}>重命名节点组</div>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onConfirm(); }
            if (e.key === 'Escape') { onCancel(); }
          }}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            fontSize: 12,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={dlgBtnStyle}>取消</button>
          <button onClick={onConfirm} style={{ ...dlgBtnStyle, background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)' }}>确认</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const dlgBtnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 4,
  padding: '4px 12px',
  fontSize: 12,
  cursor: 'pointer',
  background: 'var(--vscode-button-secondaryBackground)',
  color: 'var(--vscode-button-secondaryForeground)',
};
