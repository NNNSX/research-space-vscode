import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';

export function AiOutputPanel() {
  const aiPanelOpen = useCanvasStore(s => s.aiPanelOpen);
  const aiOutput = useCanvasStore(s => s.aiOutput);
  const aiOutputRunId = useCanvasStore(s => s.aiOutputRunId);
  const aiOutputNodeTitle = useCanvasStore(s => s.aiOutputNodeTitle);
  const setAiPanelOpen = useCanvasStore(s => s.setAiPanelOpen);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as chunks arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiOutput]);

  if (!aiPanelOpen) { return null; }

  const handleCancel = () => {
    if (aiOutputRunId) {
      postMessage({ type: 'cancelAI', runId: aiOutputRunId });
    }
  };

  return (
    <div style={{
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: 340,
      background: 'var(--vscode-sideBar-background)',
      borderLeft: '1px solid var(--vscode-panel-border)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 10,
      boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid var(--vscode-panel-border)',
        gap: 8,
      }}>
        <span style={{ fontWeight: 700, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          🤖 {aiOutputNodeTitle || 'AI 输出'}
        </span>
        <button
          onClick={handleCancel}
          title="取消生成"
          style={btnStyle('var(--vscode-inputValidation-warningBackground)')}
        >
          ⏹ 停止
        </button>
        <button
          onClick={() => setAiPanelOpen(false)}
          title="关闭面板"
          style={btnStyle('var(--vscode-button-secondaryBackground)')}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 14px',
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--vscode-editor-foreground)',
      }}>
        {aiOutput ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {aiOutput}
          </ReactMarkdown>
        ) : (
          <div style={{ color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic' }}>
            等待 AI 输出…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: 4,
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 11,
  };
}
