import React from 'react';
import ReactDOM from 'react-dom';
import type { OutputHistoryEntry } from '../../../../src/core/canvas-model';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';

export function OutputHistoryModal() {
  const outputHistory = useCanvasStore(s => s.outputHistory);
  const setOutputHistory = useCanvasStore(s => s.setOutputHistory);
  const selectExclusiveNode = useCanvasStore(s => s.selectExclusiveNode);
  if (!outputHistory) { return null; }

  const { nodeId, entries, title, subtitle, scope } = outputHistory;
  const onClose = () => setOutputHistory(null);
  const currentEntries = entries.filter(entry => entry.isCurrent);
  const previousEntry = entries.find(entry => entry.isPrevious);
  const historicalEntries = entries.filter(entry => !entry.isCurrent && !entry.isPrevious);

  const handleRestore = (entry: OutputHistoryEntry) => {
    postMessage({ type: 'restoreOutputVersion', filePath: entry.filePath, nodeType: entry.nodeType });
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
            🕓 {title ?? '生成历史'}（{entries.length} 条）
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
        {subtitle && (
          <div style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--vscode-panel-border)',
            fontSize: 11,
            color: 'var(--vscode-descriptionForeground)',
            lineHeight: 1.5,
            background: 'color-mix(in srgb, var(--vscode-editor-background) 96%, white 4%)',
          }}>
            {subtitle}
          </div>
        )}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--vscode-panel-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            background: 'color-mix(in srgb, var(--vscode-editor-background) 97%, white 3%)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <SummaryBadge
              label={scope === 'blueprint_slot' ? '当前槽位输出' : '当前版本'}
              value={currentEntries.length > 0 ? `${currentEntries.length} 个` : '无'}
              tone="current"
            />
            <SummaryBadge
              label="上一版"
              value={previousEntry ? previousEntry.filename : '无'}
              tone="previous"
            />
            <SummaryBadge
              label="总历史"
              value={`${entries.length} 条`}
              tone="muted"
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {currentEntries[0] && (
              <ActionBtn
                label={scope === 'blueprint_slot' ? '打开当前输出' : '打开当前版'}
                onClick={() => {
                  postMessage({ type: 'openFile', filePath: currentEntries[0].filePath });
                  onClose();
                }}
              />
            )}
            {previousEntry && (
              <>
                <ActionBtn
                  label="打开上一版"
                  onClick={() => {
                    postMessage({ type: 'openFile', filePath: previousEntry.filePath });
                    onClose();
                  }}
                />
                <ActionBtn
                  label="恢复上一版"
                  onClick={() => handleRestore(previousEntry)}
                  primary
                />
              </>
            )}
          </div>
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
          ) : (
            <>
              {currentEntries.length > 0 && (
                <HistorySection
                  title={scope === 'blueprint_slot' ? '当前槽位输出' : '当前版本'}
                  subtitle={scope === 'blueprint_slot'
                    ? '当前仍被视为本槽位输出的结果'
                    : '当前正在使用的版本'}
                >
                  {currentEntries.map(entry => (
                    <HistoryEntry
                      key={entry.filePath}
                      entry={entry}
                      onRestore={() => handleRestore(entry)}
                      onOpen={() => {
                        postMessage({ type: 'openFile', filePath: entry.filePath });
                        onClose();
                      }}
                      onLocate={entry.sourceNodeId ? () => {
                        selectExclusiveNode(entry.sourceNodeId!);
                        onClose();
                      } : undefined}
                      scope={scope}
                    />
                  ))}
                </HistorySection>
              )}
              {previousEntry && (
                <HistorySection
                  title="上一版"
                  subtitle="当前版本之前最近的一版，可直接打开或恢复"
                >
                  <HistoryEntry
                    key={previousEntry.filePath}
                    entry={previousEntry}
                    onRestore={() => handleRestore(previousEntry)}
                    onOpen={() => {
                      postMessage({ type: 'openFile', filePath: previousEntry.filePath });
                      onClose();
                    }}
                    onLocate={previousEntry.sourceNodeId ? () => {
                      selectExclusiveNode(previousEntry.sourceNodeId!);
                      onClose();
                    } : undefined}
                    scope={scope}
                  />
                </HistorySection>
              )}
              {historicalEntries.length > 0 && (
                <HistorySection
                  title="更早历史"
                  subtitle="更旧的历史版本，适合回看与手动恢复"
                >
                  {historicalEntries.map(entry => (
                    <HistoryEntry
                      key={entry.filePath}
                      entry={entry}
                      onRestore={() => handleRestore(entry)}
                      onOpen={() => {
                        postMessage({ type: 'openFile', filePath: entry.filePath });
                        onClose();
                      }}
                      onLocate={entry.sourceNodeId ? () => {
                        selectExclusiveNode(entry.sourceNodeId!);
                        onClose();
                      } : undefined}
                      scope={scope}
                    />
                  ))}
                </HistorySection>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function HistorySection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '10px 16px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--vscode-editor-foreground)' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.4 }}>
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function HistoryEntry({
  entry,
  onRestore,
  onOpen,
  onLocate,
  scope,
}: {
  entry: OutputHistoryEntry;
  onRestore: () => void;
  onOpen: () => void;
  onLocate?: () => void;
  scope?: 'node' | 'blueprint_slot';
}) {
  const [hovered, setHovered] = React.useState(false);
  const previewText = entry.preview || ({
    ai_output: '文本输出（无可提取预览）',
    image: '图片输出（无文本预览）',
    audio: '音频输出（无文本预览）',
    video: '视频输出（无文本预览）',
  }[entry.nodeType]);

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
          <VersionChip entry={entry} />
        </span>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {onLocate && <ActionBtn label={entry.isCurrent ? (scope === 'blueprint_slot' ? '定位当前输出' : '定位当前节点') : (scope === 'blueprint_slot' ? '定位槽位输出' : '定位节点')} onClick={onLocate} />}
          <ActionBtn label="打开" onClick={onOpen} />
          {!entry.isCurrent && <ActionBtn label="恢复" onClick={onRestore} primary />}
        </div>
      </div>
      {entry.sourceNodeTitle && (
        <div style={{
          fontSize: 10,
          color: 'var(--vscode-editor-foreground)',
          lineHeight: 1.4,
        }}>
          {entry.isCurrent ? '当前槽位输出' : '来源节点'}：{entry.sourceNodeTitle}
        </div>
      )}
      {entry.isPrevious && (
        <div style={{
          fontSize: 10,
          color: 'var(--vscode-descriptionForeground)',
          lineHeight: 1.4,
        }}>
          这是当前输出之前最近的一版，可直接恢复或打开查看。
        </div>
      )}
      {previewText && (
        <div style={{
          fontSize: 10, color: 'var(--vscode-descriptionForeground)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}>
          {previewText}
        </div>
      )}
    </div>
  );
}

function VersionChip({ entry }: { entry: OutputHistoryEntry }) {
  if (entry.isCurrent) {
    return (
      <span style={{
        marginLeft: 8, fontSize: 10, padding: '1px 5px',
        background: 'var(--vscode-badge-background)',
        color: 'var(--vscode-badge-foreground)',
        borderRadius: 8,
      }}>
        当前
      </span>
    );
  }
  if (entry.isPrevious) {
    return (
      <span style={{
        marginLeft: 8, fontSize: 10, padding: '1px 5px',
        background: 'color-mix(in srgb, var(--vscode-editor-background) 84%, #d7ba7d 16%)',
        color: 'var(--vscode-editor-foreground)',
        border: '1px solid var(--vscode-inputValidation-warningBorder, #b89500)',
        borderRadius: 8,
      }}>
        上一版
      </span>
    );
  }
  return null;
}

function SummaryBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'current' | 'previous' | 'muted';
}) {
  const background = tone === 'current'
    ? 'var(--vscode-inputOption-activeBackground, rgba(255,255,255,0.06))'
    : tone === 'previous'
      ? 'color-mix(in srgb, var(--vscode-editor-background) 90%, #d7ba7d 10%)'
      : 'color-mix(in srgb, var(--vscode-editor-background) 96%, white 4%)';
  const border = tone === 'current'
    ? 'var(--vscode-panel-border)'
    : tone === 'previous'
      ? 'var(--vscode-inputValidation-warningBorder, #b89500)'
      : 'var(--vscode-panel-border)';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 999,
        border: `1px solid ${border}`,
        background,
        fontSize: 10,
      }}
    >
      <span style={{ color: 'var(--vscode-descriptionForeground)' }}>{label}</span>
      <span style={{ color: 'var(--vscode-editor-foreground)', fontWeight: 700 }}>{value}</span>
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
