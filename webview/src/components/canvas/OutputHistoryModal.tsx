import React from 'react';
import ReactDOM from 'react-dom';
import type { OutputHistoryEntry } from '../../../../src/core/canvas-model';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';

export function OutputHistoryModal() {
  const outputHistory = useCanvasStore(s => s.outputHistory);
  const setOutputHistory = useCanvasStore(s => s.setOutputHistory);
  if (!outputHistory) { return null; }

  const { nodeId, entries } = outputHistory;
  const onClose = () => setOutputHistory(null);

  const handleRestore = (entry: OutputHistoryEntry) => {
    postMessage({ type: 'restoreOutputVersion', filePath: entry.filePath });
    onClose();
  };

  // Close on Escape
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return ReactDOM.createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 99998,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 10,
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
          width: 'min(90vw, 560px)',
          maxHeight: '80vh',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '10px 16px',
          borderBottom: '1px solid var(--vscode-panel-border)', flexShrink: 0,
        }}>
          <span style={{
            flex: 1, fontSize: 13, fontWeight: 700,
            color: 'var(--vscode-editor-foreground)',
          }}>
            🕓 生成历史（{entries.length} 条）
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              color: 'var(--vscode-descriptionForeground)',
              cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {entries.length === 0 ? (
            <div style={{
              padding: '24px 16px', textAlign: 'center',
              fontSize: 12, color: 'var(--vscode-descriptionForeground)',
            }}>
              暂无历史记录（运行功能节点后会在此显示）
            </div>
          ) : entries.map(entry => (
            <HistoryEntry
              key={entry.filePath}
              entry={entry}
              onRestore={() => handleRestore(entry)}
              onOpen={() => {
                postMessage({ type: 'openFile', filePath: entry.filePath });
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function HistoryEntry({
  entry,
  onRestore,
  onOpen,
}: {
  entry: OutputHistoryEntry;
  onRestore: () => void;
  onOpen: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px 16px',
        background: hovered
          ? 'var(--vscode-list-hoverBackground)'
          : entry.isCurrent ? 'var(--vscode-inputOption-activeBackground, rgba(255,255,255,0.05))' : 'none',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: 'var(--vscode-editor-foreground)',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.filename}
          {entry.isCurrent && (
            <span style={{
              marginLeft: 8, fontSize: 10, padding: '1px 5px',
              background: 'var(--vscode-badge-background)',
              color: 'var(--vscode-badge-foreground)',
              borderRadius: 8,
            }}>
              当前
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <ActionBtn label="打开" onClick={onOpen} />
          {!entry.isCurrent && <ActionBtn label="恢复" onClick={onRestore} primary />}
        </div>
      </div>
      {entry.preview && (
        <div style={{
          fontSize: 10, color: 'var(--vscode-descriptionForeground)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}>
          {entry.preview}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 8px', fontSize: 10, borderRadius: 3,
        border: primary ? 'none' : '1px solid var(--vscode-panel-border)',
        background: primary ? 'var(--vscode-button-background)' : 'none',
        color: primary ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
