import React from 'react';
import ReactDOM from 'react-dom';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';

interface NodeContextMenuProps {
  nodeId: string;
  nodeType: string;
  nodeTitle: string;
  x: number;
  y: number;
  onClose: () => void;
  filePath?: string;      // D2: open file item (data nodes)
  canDuplicate?: boolean; // D2: copy node (data + function nodes)
}

export function NodeContextMenu({ nodeId, nodeType, nodeTitle, x, y, onClose, filePath, canDuplicate }: NodeContextMenuProps) {
  const onNodesChange = useCanvasStore(s => s.onNodesChange);
  const onEdgesChange = useCanvasStore(s => s.onEdgesChange);
  const edges = useCanvasStore(s => s.edges);
  const duplicateNode = useCanvasStore(s => s.duplicateNode);
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(nodeTitle);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Auto-focus input when rename mode activates
  React.useEffect(() => {
    if (renaming) {
      // Small delay to ensure the DOM has updated
      setTimeout(() => inputRef.current?.select(), 10);
    }
  }, [renaming]);

  // Close on outside click/key — but NOT while renaming (let Enter/Escape handle it)
  React.useEffect(() => {
    if (renaming) { return; }
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
  }, [renaming, onClose]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
    const dangling = edges
      .filter(edge => edge.source === nodeId || edge.target === nodeId)
      .map(edge => ({ type: 'remove' as const, id: edge.id }));
    if (dangling.length > 0) { onEdgesChange(dangling); }
    onNodesChange([{ type: 'remove', id: nodeId }]);
  };

  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(nodeTitle);
    setRenaming(true);
  };

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== nodeTitle) {
      postMessage({ type: 'renameNode', nodeId, newTitle: trimmed });
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { onClose(); }
  };

  const handleOpenFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
    if (filePath) { postMessage({ type: 'openFile', filePath }); }
  };

  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
    duplicateNode(nodeId);
  };

  // Which nodes support renaming: note (file rename) and function (title rename)
  const canRename = nodeType === 'note' || nodeType === 'function';

  const content = renaming ? (
    // ── Inline rename input ──
    <div
      style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginBottom: 2 }}>
        {nodeType === 'note' ? '重命名（不含扩展名）' : '重命名节点'}
      </div>
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-focusBorder, var(--vscode-panel-border))',
          borderRadius: 3,
          padding: '4px 6px',
          fontSize: 12,
          outline: 'none',
          boxSizing: 'border-box',
        }}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <ActionButton label="取消" onClick={() => onClose()} />
        <ActionButton label="确认" onClick={commitRename} primary />
      </div>
    </div>
  ) : (
    // ── Normal menu items ──
    <>
      {filePath && (
        <MenuItem label="📂 打开文件" onClick={handleOpenFile} />
      )}
      {canRename && (
        <MenuItem label="✏️ 重命名" onClick={handleRenameClick} />
      )}
      {canDuplicate && (
        <MenuItem label="⧉ 复制节点" onClick={handleDuplicate} />
      )}
      <MenuItem label="🗑 从画布删除" onClick={handleDelete} danger />
    </>
  );

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
        minWidth: renaming ? 220 : 160,
        overflow: 'hidden',
        fontSize: 12,
      }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      {content}
    </div>
  );

  return ReactDOM.createPortal(menu, document.body);
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
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
          ? (hovered ? 'var(--vscode-errorForeground, #f48771)' : 'var(--vscode-errorForeground, #f48771)')
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

function ActionButton({
  label, onClick, primary,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px',
        fontSize: 11,
        border: 'none',
        borderRadius: 3,
        cursor: 'pointer',
        background: primary
          ? 'var(--vscode-button-background)'
          : 'var(--vscode-button-secondaryBackground)',
        color: primary
          ? 'var(--vscode-button-foreground)'
          : 'var(--vscode-button-secondaryForeground)',
      }}
    >
      {label}
    </button>
  );
}
