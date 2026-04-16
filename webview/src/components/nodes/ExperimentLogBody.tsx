import React from 'react';
import type { CanvasNode } from '../../../../src/core/canvas-model';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';

const STATUS_COLORS = {
  running: 'var(--vscode-terminal-ansiBlue)',
  done:    'var(--vscode-terminal-ansiGreen)',
  failed:  'var(--vscode-terminal-ansiRed)',
};

const STATUS_LABELS = {
  running: '进行中',
  done:    '已完成',
  failed:  '失败',
};

export function ExperimentLogBody({ node }: { node: CanvasNode }) {
  const { updateNodeMeta } = useCanvasStore();
  const meta = node.meta ?? {};

  const status = (meta.experiment_status as 'running' | 'done' | 'failed') ?? 'running';
  const statusColor = STATUS_COLORS[status];

  const update = (patch: Partial<typeof meta>) => {
    // Serialize to content_preview for AI consumption
    const updated = { ...meta, ...patch };
    const preview = [
      `实验：${updated.experiment_name ?? node.title}`,
      updated.experiment_date ? `日期：${updated.experiment_date}` : '',
      updated.experiment_params ? `参数：${updated.experiment_params}` : '',
      updated.experiment_result ? `结果：${updated.experiment_result}` : '',
      `状态：${STATUS_LABELS[updated.experiment_status as keyof typeof STATUS_LABELS ?? 'running'] ?? '进行中'}`,
    ].filter(Boolean).join('\n');
    updateNodeMeta(node.id, { ...patch, content_preview: preview });
    // Sync to disk file if node has a file_path
    if (node.file_path) {
      const md = [
        `# ${updated.experiment_name ?? node.title}`,
        '',
        `- **状态**: ${STATUS_LABELS[(updated.experiment_status as keyof typeof STATUS_LABELS)] ?? '进行中'}`,
        `- **日期**: ${updated.experiment_date ?? ''}`,
        `- **参数**: ${updated.experiment_params ?? ''}`,
        `- **结果**: ${updated.experiment_result ?? ''}`,
        '',
      ].join('\n');
      postMessage({ type: 'syncDataNodeFile', nodeId: node.id, content: md });
    }
  };

  const fieldStyle: React.CSSProperties = {
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
    borderRadius: 3,
    fontSize: 10,
    padding: '2px 5px',
    width: '100%',
    boxSizing: 'border-box',
    resize: 'none',
    fontFamily: 'inherit',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 9,
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: 1,
  };

  return (
    <div
      className="nodrag"
      style={{ display: 'flex', flexDirection: 'column', gap: 4, height: '100%' }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Status + Date row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{
          fontSize: 9, padding: '1px 6px', borderRadius: 8, fontWeight: 600,
          background: statusColor + '22', color: statusColor,
          border: `1px solid ${statusColor}55`,
        }}>
          {STATUS_LABELS[status]}
        </span>
        {(['running', 'done', 'failed'] as const).map(s => (
          <button
            key={s}
            onClick={() => update({ experiment_status: s })}
            style={{
              padding: '1px 5px', fontSize: 9, borderRadius: 3, cursor: 'pointer',
              background: status === s ? statusColor + '33' : 'none',
              border: `1px solid ${status === s ? statusColor : 'var(--vscode-panel-border)'}`,
              color: status === s ? statusColor : 'var(--vscode-descriptionForeground)',
            }}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
        <input
          type="date"
          value={(meta.experiment_date as string) ?? ''}
          onChange={e => update({ experiment_date: e.target.value })}
          style={{ ...fieldStyle, cursor: 'pointer', width: 'auto', flex: 1, minWidth: 90 }}
        />
      </div>

      {/* Params */}
      <div style={{ flexShrink: 0 }}>
        <div style={labelStyle}>实验参数</div>
        <input
          value={(meta.experiment_params as string) ?? ''}
          onChange={e => update({ experiment_params: e.target.value })}
          placeholder="lr=0.001, bs=32, epochs=100"
          style={fieldStyle}
        />
      </div>

      {/* Result — fills remaining space */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={labelStyle}>实验结果</div>
        <textarea
          value={(meta.experiment_result as string) ?? ''}
          onChange={e => update({ experiment_result: e.target.value })}
          placeholder="Acc=94.2%, Loss=0.031"
          style={{ ...fieldStyle, resize: 'none', flex: 1, minHeight: 28 }}
        />
      </div>
    </div>
  );
}
