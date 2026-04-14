import React from 'react';
import { v4 as uuid } from 'uuid';
import type { CanvasNode } from '../../../../../src/core/canvas-model';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';

type TaskItem = { id: string; label: string; done: boolean };

export function TaskBody({ node }: { node: CanvasNode }) {
  const { updateNodeMeta } = useCanvasStore();
  const [newLabel, setNewLabel] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const items: TaskItem[] = (node.meta?.task_items as TaskItem[]) ?? [];
  const done = items.filter(i => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const saveItems = (next: TaskItem[]) => {
    const preview = [
      `任务进度: ${done}/${total} (${pct}%)`,
      ...next.map(i => `${i.done ? '[x]' : '[ ]'} ${i.label}`),
    ].join('\n');
    updateNodeMeta(node.id, { task_items: next, content_preview: preview });
    // Sync to disk file if node has a file_path
    if (node.file_path) {
      const doneCount = next.filter(i => i.done).length;
      const md = [
        `# ${node.title}`,
        '',
        `进度: ${doneCount}/${next.length}`,
        '',
        ...next.map(i => `- [${i.done ? 'x' : ' '}] ${i.label}`),
        '',
      ].join('\n');
      postMessage({ type: 'syncDataNodeFile', nodeId: node.id, content: md });
    }
  };

  const toggle = (id: string) => {
    saveItems(items.map(i => i.id === id ? { ...i, done: !i.done } : i));
  };

  const addItem = () => {
    const label = newLabel.trim();
    if (!label) { return; }
    saveItems([...items, { id: uuid(), label, done: false }]);
    setNewLabel('');
    inputRef.current?.focus();
  };

  const removeItem = (id: string) => {
    saveItems(items.filter(i => i.id !== id));
  };

  return (
    <div
      className="nodrag"
      style={{ display: 'flex', flexDirection: 'column', gap: 4, height: '100%' }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Progress bar */}
      {total > 0 && (
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--vscode-descriptionForeground)' }}>
              进度 {done}/{total}
            </span>
            <span style={{ fontSize: 9, color: 'var(--vscode-terminal-ansiGreen)', fontWeight: 600 }}>
              {pct}%
            </span>
          </div>
          <div style={{
            height: 4, borderRadius: 2,
            background: 'var(--vscode-progressBar-background, var(--vscode-panel-border))',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: 'var(--vscode-terminal-ansiGreen)',
              borderRadius: 2,
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}

      {/* Items — fills available space */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {items.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => toggle(item.id)}
              style={{ cursor: 'pointer', flexShrink: 0, accentColor: 'var(--vscode-terminal-ansiGreen)' }}
            />
            <span style={{
              flex: 1, fontSize: 11,
              color: item.done ? 'var(--vscode-descriptionForeground)' : 'var(--vscode-editor-foreground)',
              textDecoration: item.done ? 'line-through' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {item.label}
            </span>
            <button
              onClick={() => removeItem(item.id)}
              style={{
                background: 'none', border: 'none',
                color: 'var(--vscode-descriptionForeground)',
                cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1, flexShrink: 0,
                opacity: 0.5,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Add new item */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
          placeholder="新增任务…"
          style={{
            flex: 1,
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
            borderRadius: 3,
            fontSize: 10,
            padding: '2px 5px',
          }}
        />
        <button
          onClick={addItem}
          style={{
            padding: '2px 7px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
