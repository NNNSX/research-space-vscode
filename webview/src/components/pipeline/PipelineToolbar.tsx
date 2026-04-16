import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useCanvasStore, type PipelineNodeStatus } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';

/**
 * Floating toolbar showing pipeline execution progress.
 * Appears at the top-center of the canvas when a pipeline is running.
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  ▶ Pipeline 运行中    ■■■■□□  3/5 完成   ⏸暂停  ✕取消     │
 * │  当前: [翻译] → 处理中...                                   │
 * └─────────────────────────────────────────────────────────────┘
 */
export function PipelineToolbar() {
  const pipelineState = useCanvasStore(s => s.pipelineState);
  const [fadeOut, setFadeOut] = useState(false);

  // Fade-out animation when pipeline completes
  useEffect(() => {
    if (pipelineState && !pipelineState.isRunning) {
      const t = setTimeout(() => setFadeOut(true), 3000);
      return () => clearTimeout(t);
    }
    setFadeOut(false);
  }, [pipelineState?.isRunning]);

  if (!pipelineState) { return null; }

  const {
    pipelineId,
    nodeStatuses,
    totalNodes,
    completedNodes,
    isRunning,
    isPaused,
    currentNodeId,
    validationWarnings,
  } = pipelineState;

  // Compute progress
  const total = totalNodes || Object.keys(nodeStatuses).length;
  const completed = completedNodes;
  const progress = total > 0 ? completed / total : 0;

  // Find current node title
  const canvasFile = useCanvasStore.getState().canvasFile;
  const currentNode = currentNodeId ? canvasFile?.nodes.find(n => n.id === currentNodeId) : null;
  const currentTitle = currentNode?.title ?? '';

  // Count statuses
  const statusCounts: Record<PipelineNodeStatus, number> = { waiting: 0, running: 0, done: 0, failed: 0, skipped: 0 };
  for (const s of Object.values(nodeStatuses)) {
    statusCounts[s]++;
  }

  const hasFailed = statusCounts.failed > 0;
  const allDone = !isRunning;
  const visibleWarnings = validationWarnings.slice(0, 2);

  // Status text
  let statusLabel = '▶ Pipeline 运行中';
  let statusIcon = '▶';
  if (isPaused) {
    statusLabel = '⏸ Pipeline 已暂停';
    statusIcon = '⏸';
  } else if (allDone) {
    if (hasFailed) {
      statusLabel = '⚠ Pipeline 部分失败';
      statusIcon = '⚠';
    } else {
      statusLabel = '✅ Pipeline 完成';
      statusIcon = '✅';
    }
  }

  const handlePause = () => {
    if (isPaused) {
      postMessage({ type: 'pipelineResume', pipelineId });
      useCanvasStore.getState().setPipelinePaused(false);
    } else {
      postMessage({ type: 'pipelinePause', pipelineId });
      useCanvasStore.getState().setPipelinePaused(true);
    }
  };

  const handleCancel = () => {
    postMessage({ type: 'pipelineCancel', pipelineId });
    useCanvasStore.getState().setPipelineState(null);
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        top: 52,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 14px',
        background: 'var(--vscode-editor-background)',
        border: '1px solid var(--vscode-widget-border)',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        minWidth: 320,
        maxWidth: 500,
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 1.5s ease-out',
        pointerEvents: fadeOut ? 'none' : 'auto',
      }}
    >
      {/* Top row: status + progress + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Status label */}
        <span style={{
          fontSize: 12,
          fontWeight: 700,
          color: isPaused
            ? 'var(--vscode-terminal-ansiYellow)'
            : hasFailed && allDone
            ? 'var(--vscode-terminal-ansiRed)'
            : allDone
            ? 'var(--vscode-terminal-ansiGreen)'
            : 'var(--vscode-terminal-ansiBlue)',
          whiteSpace: 'nowrap',
        }}>
          {statusLabel}
        </span>

        {/* Progress bar */}
        <div style={{
          flex: 1,
          height: 6,
          background: 'var(--vscode-progressBar-background, rgba(255,255,255,0.1))',
          borderRadius: 3,
          overflow: 'hidden',
          minWidth: 60,
        }}>
          <div style={{
            width: `${Math.round(progress * 100)}%`,
            height: '100%',
            background: hasFailed
              ? 'var(--vscode-terminal-ansiYellow)'
              : 'var(--vscode-terminal-ansiGreen)',
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }} />
        </div>

        {/* Progress text */}
        <span style={{
          fontSize: 11,
          color: 'var(--vscode-descriptionForeground)',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {completed}/{total}
        </span>

        {/* Controls */}
        {isRunning && (
          <>
            <button
              onClick={handlePause}
              style={{
                background: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)',
                border: '1px solid var(--vscode-button-border, transparent)',
                borderRadius: 4,
                padding: '2px 8px',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
              title={isPaused ? '继续执行' : '暂停执行'}
            >
              {isPaused ? '▶ 继续' : '⏸ 暂停'}
            </button>
            <button
              onClick={handleCancel}
              style={{
                background: 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
                color: 'var(--vscode-inputValidation-errorForeground, #f48771)',
                border: '1px solid var(--vscode-inputValidation-errorBorder, #be1100)',
                borderRadius: 4,
                padding: '2px 8px',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
              title="取消 Pipeline"
            >
              ✕ 取消
            </button>
          </>
        )}
      </div>

      {/* Bottom row: current node + status summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {currentTitle && isRunning && (
          <span style={{
            fontSize: 11,
            color: 'var(--vscode-descriptionForeground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            当前: <span style={{ color: 'var(--vscode-terminal-ansiBlue)', fontWeight: 600 }}>
              {currentTitle}
            </span>
            {isPaused ? ' — 已暂停' : ' → 处理中...'}
          </span>
        )}
        {allDone && (
          <span style={{
            fontSize: 11,
            color: 'var(--vscode-descriptionForeground)',
            flex: 1,
          }}>
            {statusCounts.done > 0 && <span style={{ color: 'var(--vscode-terminal-ansiGreen)' }}>✓{statusCounts.done} </span>}
            {statusCounts.failed > 0 && <span style={{ color: 'var(--vscode-terminal-ansiRed)' }}>✗{statusCounts.failed} </span>}
            {statusCounts.skipped > 0 && <span style={{ color: 'var(--vscode-descriptionForeground)' }}>⊘{statusCounts.skipped} </span>}
          </span>
        )}
      </div>
      {validationWarnings.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          paddingTop: 2,
          borderTop: '1px solid var(--vscode-panel-border)',
        }}>
          <span style={{
            fontSize: 10,
            color: 'var(--vscode-terminal-ansiYellow)',
            fontWeight: 700,
          }}>
            运行提醒
          </span>
          {visibleWarnings.map((warning, index) => (
            <span
              key={`${warning.nodeId}-${index}`}
              style={{
                fontSize: 10,
                color: 'var(--vscode-descriptionForeground)',
                lineHeight: 1.4,
              }}
            >
              {warning.message}
            </span>
          ))}
          {validationWarnings.length > visibleWarnings.length && (
            <span style={{
              fontSize: 10,
              color: 'var(--vscode-descriptionForeground)',
            }}>
              另有 {validationWarnings.length - visibleWarnings.length} 条提醒
            </span>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
