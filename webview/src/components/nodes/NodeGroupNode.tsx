import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import type { CanvasNode } from '../../../../src/core/canvas-model';
import { useCanvasStore } from '../../stores/canvas-store';
import { buildNodePortStyle, getNodePortLabel, NODE_PORT_CLASSNAME, NODE_PORT_IDS } from '../../utils/node-port';
import { closeAllCanvasContextMenus, useCanvasContextMenuAutoClose } from '../../utils/context-menu';
import {
  ensureNodeChromeStyles,
  NODE_BORDER_WIDTH,
  NODE_HEADER_ICON_SIZE,
  NODE_HEADER_TITLE_STYLE,
  NODE_RADIUS,
  NODE_SELECTED_BORDER_WIDTH,
  withAlpha,
} from '../../utils/node-chrome';

interface NodeGroupNodeData {
  hub_group_id?: string;
}

const HEADER_H = 38;
const COLLAPSED_WIDTH = 220;
const COLLAPSED_HEIGHT = 72;

export function NodeGroupNode({ id, data, selected }: NodeProps) {
  const hubData = data as unknown as NodeGroupNodeData & CanvasNode;
  const groupId = hubData.meta?.hub_group_id ?? hubData.hub_group_id;
  const group = useCanvasStore(s =>
    groupId
      ? s.nodeGroups.find(g => g.id === groupId)
      : s.nodeGroups.find(g => g.hubNodeId === id)
  );
  const nodes = useCanvasStore(s => s.nodes);
  const deleteNodeGroup = useCanvasStore(s => s.deleteNodeGroup);
  const toggleNodeGroupCollapse = useCanvasStore(s => s.toggleNodeGroupCollapse);
  const renameNodeGroup = useCanvasStore(s => s.renameNodeGroup);
  const selectExclusiveNode = useCanvasStore(s => s.selectExclusiveNode);
  const updateNodeInternals = useUpdateNodeInternals();
  const rootRef = useRef<HTMLDivElement>(null);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(group?.name ?? hubData.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ensureNodeChromeStyles();
  }, []);

  useEffect(() => {
    setNameDraft(group?.name ?? hubData.title);
  }, [group?.name, hubData.title]);

  useEffect(() => {
    updateNodeInternals(id);
    const raf = window.requestAnimationFrame(() => updateNodeInternals(id));
    return () => window.cancelAnimationFrame(raf);
  }, [id, group?.bounds.height, group?.bounds.width, group?.collapsed, group?.nodeIds.length, updateNodeInternals]);

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
    ...buildNodePortStyle(group?.borderColor ?? '#d8b648', 'out'),
  }), [group?.borderColor]);

  if (!group) { return null; }

  const memberCount = group.nodeIds.length;
  const title = `${group.name} (${memberCount})`;
  const isCollapsed = !!group.collapsed;
  const width = isCollapsed ? COLLAPSED_WIDTH : group.bounds.width;
  const height = isCollapsed ? COLLAPSED_HEIGHT : group.bounds.height;
  const borderColor = group.borderColor ?? '#d8b648';
  const selectedShadow = `0 0 0 1px ${withAlpha(borderColor, 0.18, 'transparent')}, 0 10px 24px ${withAlpha(borderColor, 0.14, 'rgba(0,0,0,0.16)')}`;
  const visibleMembers = group.nodeIds.filter(id => nodes.some(n => n.id === id));

  if (visibleMembers.length === 0) { return null; }

  return (
    <>
      <div
        ref={rootRef}
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
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeAllCanvasContextMenus();
              selectExclusiveNode(id);
              const rect = rootRef.current?.getBoundingClientRect();
              setCtxMenu({
                x: rect ? e.clientX - rect.left + 8 : 12,
                y: rect ? e.clientY - rect.top + 8 : 12,
              });
            }}
            className="rs-group-header"
            style={{
              pointerEvents: 'auto',
              position: 'relative',
              zIndex: 80,
              width: COLLAPSED_WIDTH,
              height: COLLAPSED_HEIGHT,
              borderRadius: NODE_RADIUS,
              border: `${selected ? NODE_SELECTED_BORDER_WIDTH : NODE_BORDER_WIDTH}px solid ${borderColor}`,
              background: 'transparent',
              boxShadow: selected ? selectedShadow : '0 3px 10px rgba(0,0,0,0.16)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
              gap: 10,
              cursor: 'grab',
              boxSizing: 'border-box',
              color: 'var(--vscode-foreground)',
            }}
          >
            <span style={{ fontSize: NODE_HEADER_ICON_SIZE + 1, lineHeight: 1, color: borderColor }}>◫</span>
            <span style={{
              ...NODE_HEADER_TITLE_STYLE,
              color: 'var(--vscode-foreground)',
            }}
            >
              {title}
            </span>
          </div>
        ) : (
          <>
            <div
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closeAllCanvasContextMenus();
                selectExclusiveNode(id);
                const rect = rootRef.current?.getBoundingClientRect();
                setCtxMenu({
                  x: rect ? e.clientX - rect.left + 8 : 12,
                  y: rect ? e.clientY - rect.top + 8 : 12,
                });
              }}
              className="rs-group-header"
              style={{
              pointerEvents: 'auto',
              position: 'relative',
              zIndex: 80,
              height: HEADER_H,
              borderRadius: `${NODE_RADIUS}px ${NODE_RADIUS}px 0 0`,
              border: `${selected ? NODE_SELECTED_BORDER_WIDTH : NODE_BORDER_WIDTH}px dashed ${borderColor}`,
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
                <span style={{ fontSize: NODE_HEADER_ICON_SIZE + 1, lineHeight: 1, color: borderColor }}>◫</span>
                <span style={{ ...NODE_HEADER_TITLE_STYLE, color: 'var(--vscode-foreground)' }}>{title}</span>
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
                borderRadius: `0 0 ${NODE_RADIUS}px ${NODE_RADIUS}px`,
                border: `${selected ? NODE_SELECTED_BORDER_WIDTH : NODE_BORDER_WIDTH}px dashed ${borderColor}`,
                borderTop: 'none',
                background: 'transparent',
                boxSizing: 'border-box',
                boxShadow: selected ? selectedShadow : '0 2px 10px rgba(0,0,0,0.08)',
              }}
            />
          </>
        )}

        <Handle
          className={NODE_PORT_CLASSNAME}
          type="target"
          position={Position.Left}
          id={NODE_PORT_IDS.in}
          title={getNodePortLabel('in')}
          aria-label={getNodePortLabel('in')}
          data-rs-port-label={getNodePortLabel('in')}
          isConnectable
          isConnectableStart={false}
          isConnectableEnd
          style={buildNodePortStyle(group?.borderColor ?? '#d8b648', 'in')}
        />
        <Handle
          className={NODE_PORT_CLASSNAME}
          type="source"
          position={Position.Right}
          id={NODE_PORT_IDS.out}
          title={getNodePortLabel('out')}
          aria-label={getNodePortLabel('out')}
          data-rs-port-label={getNodePortLabel('out')}
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
  const menuRef = React.useRef<HTMLDivElement>(null);
  useCanvasContextMenuAutoClose(true, onClose, menuRef);

  return (
    <div ref={menuRef} style={{
      position: 'absolute',
      left: x,
      top: y,
      zIndex: 10020,
      background: 'var(--vscode-menu-background, var(--vscode-editor-background))',
      border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
      borderRadius: 6,
      boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
      minWidth: 130,
      overflow: 'hidden',
      pointerEvents: 'auto',
    }}>
      <MenuItem label="重命名" onClick={onRename} />
      <MenuItem label="折叠/展开" onClick={onToggle} />
      <MenuItem label="删除组" onClick={onDelete} danger />
    </div>
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
