import React, { useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore, hexToRgba } from '../../stores/canvas-store';
import { BOARD_COLOR_PRESETS } from '../canvas/BoardOverlay';

export function BoardDropdown() {
  const boards = useCanvasStore(s => s.boards);
  const boardDropdownOpen = useCanvasStore(s => s.boardDropdownOpen);
  const setBoardDropdownOpen = useCanvasStore(s => s.setBoardDropdownOpen);
  const addBoardToStaging = useCanvasStore(s => s.addBoardToStaging);
  const { fitBounds } = useReactFlow();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(BOARD_COLOR_PRESETS[0].value);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const toggle = () => {
    setBoardDropdownOpen(!boardDropdownOpen);
    setCreating(false);
  };

  const handleJump = (board: typeof boards[0]) => {
    setBoardDropdownOpen(false);
    const PAD = 60;
    fitBounds({
      x: board.bounds.x - PAD,
      y: board.bounds.y - PAD,
      width: board.bounds.width + PAD * 2,
      height: board.bounds.height + PAD * 2,
    }, { duration: 400 });
  };

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const borderColor = newColor;
    const color = hexToRgba(borderColor, 0.12);
    addBoardToStaging(trimmed, color, borderColor);
    setNewName('');
    setNewColor(BOARD_COLOR_PRESETS[0].value);
    setCreating(false);
    setBoardDropdownOpen(false);
  };

  const startCreate = () => {
    setCreating(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  // Position dropdown below the toolbar button
  const rect = btnRef.current?.getBoundingClientRect();

  return (
    <>
      <button
        ref={btnRef}
        data-board-dropdown-anchor
        onClick={toggle}
        title="画板/工作区"
        style={{
          background: boardDropdownOpen
            ? 'var(--vscode-button-background)'
            : 'var(--vscode-button-secondaryBackground)',
          color: boardDropdownOpen
            ? 'var(--vscode-button-foreground)'
            : 'var(--vscode-button-secondaryForeground)',
          border: '1px solid var(--vscode-button-border, transparent)',
          borderRadius: 4,
          padding: '3px 10px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        📋 画板 {boards.length > 0 ? `(${boards.length})` : ''}
      </button>

      {boardDropdownOpen && rect && ReactDOM.createPortal(
        <DropdownPanel
          boards={boards}
          rect={rect}
          creating={creating}
          newName={newName}
          newColor={newColor}
          nameInputRef={nameInputRef}
          setNewName={setNewName}
          setNewColor={setNewColor}
          onJump={handleJump}
          onStartCreate={startCreate}
          onCreate={handleCreate}
          onCancelCreate={() => setCreating(false)}
          onClose={() => setBoardDropdownOpen(false)}
        />,
        document.body
      )}
    </>
  );
}

function DropdownPanel({ boards, rect, creating, newName, newColor, nameInputRef, setNewName, setNewColor, onJump, onStartCreate, onCreate, onCancelCreate, onClose }: {
  boards: ReturnType<typeof useCanvasStore.getState>['boards'];
  rect: DOMRect;
  creating: boolean;
  newName: string;
  newColor: string;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  setNewName: (v: string) => void;
  setNewColor: (v: string) => void;
  onJump: (b: ReturnType<typeof useCanvasStore.getState>['boards'][0]) => void;
  onStartCreate: () => void;
  onCreate: () => void;
  onCancelCreate: () => void;
  onClose: () => void;
}) {
  // Close on outside click
  React.useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-board-dropdown]')) return;
      if (target.closest('[data-board-dropdown-anchor]')) return;
      onClose();
    };
    const closeKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const tid = setTimeout(() => {
      window.addEventListener('mousedown', close);
      window.addEventListener('keydown', closeKey);
    }, 0);
    return () => {
      clearTimeout(tid);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', closeKey);
    };
  }, [onClose]);

  return (
    <div
      data-board-dropdown
      style={{
        position: 'fixed',
        left: rect.left,
        top: rect.bottom + 4,
        minWidth: 220,
        maxWidth: 320,
        background: 'var(--vscode-menu-background, var(--vscode-editor-background))',
        border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        zIndex: 9999,
        overflow: 'hidden',
        fontSize: 12,
      }}
    >
      {/* Board list */}
      {boards.length > 0 && (
        <div style={{ padding: '4px 0' }}>
          {boards.map(b => (
            <BoardItem key={b.id} board={b} onClick={() => onJump(b)} />
          ))}
        </div>
      )}

      {boards.length > 0 && <div style={{ height: 1, background: 'var(--vscode-panel-border)' }} />}

      {/* Create section */}
      {creating ? (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            ref={nameInputRef}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onCreate(); if (e.key === 'Escape') onCancelCreate(); }}
            placeholder="画板名称"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '5px 8px',
              background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
              borderRadius: 4, fontSize: 12,
            }}
          />
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {BOARD_COLOR_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => setNewColor(p.value)}
                title={p.label}
                style={{
                  width: 20, height: 20, borderRadius: 3,
                  background: p.value,
                  border: newColor === p.value ? '2px solid var(--vscode-foreground)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
          {/* Preview */}
          <div style={{
            height: 28, borderRadius: 4,
            background: hexToRgba(newColor, 0.12),
            border: `1.5px solid ${newColor}`,
          }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={onCancelCreate} style={btnStyle}>取消</button>
            <button onClick={onCreate} disabled={!newName.trim()} style={{
              ...btnStyle,
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              opacity: newName.trim() ? 1 : 0.5,
            }}>确认</button>
          </div>
        </div>
      ) : (
        <button
          onClick={onStartCreate}
          style={{
            display: 'block', width: '100%', padding: '8px 14px',
            background: 'none', border: 'none',
            color: 'var(--vscode-textLink-foreground, #3794ff)',
            fontSize: 12, textAlign: 'left', cursor: 'pointer',
          }}
        >
          + 新建画板
        </button>
      )}
    </div>
  );
}

function BoardItem({ board, onClick }: { board: ReturnType<typeof useCanvasStore.getState>['boards'][0]; onClick: () => void }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '6px 14px', border: 'none', fontSize: 12, textAlign: 'left', cursor: 'pointer',
        background: hovered ? 'var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground))' : 'none',
        color: 'var(--vscode-menu-foreground, var(--vscode-foreground))',
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 3, background: board.borderColor, flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {board.name}
      </span>
      <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', flexShrink: 0 }}>→</span>
    </button>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '3px 12px', fontSize: 11, border: 'none', borderRadius: 3, cursor: 'pointer',
  background: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)',
};
