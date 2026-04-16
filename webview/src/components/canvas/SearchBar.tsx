import React, { useEffect, useRef } from 'react';
import { useCanvasStore } from '../../stores/canvas-store';

export function SearchBar() {
  const {
    searchOpen,
    searchQuery,
    searchMatches,
    searchIndex,
    setSearchOpen,
    setSearchQuery,
    nextSearchMatch,
    prevSearchMatch,
  } = useCanvasStore();

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!searchOpen) { return; }
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [searchOpen]);

  if (!searchOpen) { return null; }

  const total = searchMatches.length;
  const current = total > 0 ? searchIndex + 1 : 0;

  return (
    <div style={{
      position: 'absolute',
      top: 10,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 10010,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 10px',
      background: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
      border: '1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border))',
      borderRadius: 8,
      boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      minWidth: 420,
      maxWidth: '80vw',
    }}>
      <input
        ref={inputRef}
        value={searchQuery}
        placeholder="搜索节点标题或预览内容"
        onChange={e => setSearchQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            prevSearchMatch();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            nextSearchMatch();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setSearchOpen(false);
          }
        }}
        style={{
          flex: 1,
          minWidth: 220,
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          fontSize: 12,
        }}
      />

      <button
        title="上一个匹配 (Shift+Enter)"
        onClick={prevSearchMatch}
        disabled={total === 0}
        style={btnStyle(total > 0)}
      >
        ▲
      </button>
      <button
        title="下一个匹配 (Enter)"
        onClick={nextSearchMatch}
        disabled={total === 0}
        style={btnStyle(total > 0)}
      >
        ▼
      </button>

      <span style={{
        minWidth: 60,
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--vscode-descriptionForeground)',
      }}>
        {current}/{total}
      </span>

      <button
        title="关闭搜索 (Esc)"
        onClick={() => setSearchOpen(false)}
        style={{ ...btnStyle(true), width: 28, padding: 0 }}
      >
        x
      </button>
    </div>
  );
}

function btnStyle(enabled: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--vscode-button-border, transparent)',
    borderRadius: 6,
    padding: '4px 8px',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontSize: 12,
    background: enabled
      ? 'var(--vscode-button-secondaryBackground)'
      : 'var(--vscode-disabledForeground)',
    color: enabled
      ? 'var(--vscode-button-secondaryForeground)'
      : 'var(--vscode-editor-background)',
    opacity: enabled ? 1 : 0.5,
  };
}
