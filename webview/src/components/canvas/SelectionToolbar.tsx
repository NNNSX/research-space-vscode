import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useReactFlow, useStore } from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';
import { isDataNode } from '../../../../src/core/canvas-model';

/**
 * Floating toolbar that appears when 2+ nodes are selected.
 * Shows node count, a "移动" hint, and — if the multi-selection
 * contains pipeline-connected function nodes — an external "▶▶ Pipeline" button.
 */
export function SelectionToolbar() {
  const { selectedNodeIds, nodes, nodeGroups, setSelectionMode, getPipelineHeadNodes, createNodeGroup, canvasFile } = useCanvasStore();
  const { getNodesBounds, flowToScreenPosition } = useReactFlow();
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('节点组');
  const [groupColor, setGroupColor] = useState(GROUP_COLOR_OPTIONS[0]);

  // Subscribe to viewport transform so we re-render on pan/zoom
  useStore(s => s.transform);

  if (selectedNodeIds.length === 0) { return null; }

  // Compute screen position (above the center of the selection)
  let screenPos = { x: 0, y: 0 };
  try {
    const bounds = getNodesBounds(selectedNodeIds);
    screenPos = flowToScreenPosition({
      x: bounds.x + bounds.width / 2,
      y: bounds.y,
    });
  } catch {
    return null;
  }

  const handleMove = () => {
    setSelectionMode(false);
  };

  // Check if selected nodes form a pipeline
  const pipelineHeads = getPipelineHeadNodes(selectedNodeIds);
  const hasPipeline = pipelineHeads.length > 0;
  const shouldShowToolbar = selectedNodeIds.length >= 2;

  if (!shouldShowToolbar) { return null; }

  const handlePipelineRun = () => {
    for (const head of pipelineHeads) {
      postMessage({ type: 'runPipeline', triggerNodeId: head.id, canvas: canvasFile ?? undefined });
    }
  };

  const selectedDataNodeIds = selectedNodeIds.filter(id => {
    const n = nodes.find(node => node.id === id);
    return !!n && isDataNode(n.data);
  });
  const selectionMatchesExistingGroup = nodeGroups.some(group =>
    group.nodeIds.length === selectedDataNodeIds.length &&
    group.nodeIds.every(id => selectedDataNodeIds.includes(id))
  );
  const canCreateGroup = selectedDataNodeIds.length >= 2 && !selectionMatchesExistingGroup;

  const handleCreateGroup = () => {
    createNodeGroup(groupName, selectedDataNodeIds, {
      color: groupColor.fill,
      borderColor: groupColor.border,
    });
    setGroupDialogOpen(false);
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        left: screenPos.x,
        top: screenPos.y - 52,
        transform: 'translateX(-50%)',
        zIndex: 9998,
        display: 'flex',
        gap: 6,
        padding: '6px 10px',
        background: 'var(--vscode-editor-background)',
        border: '1px solid var(--vscode-widget-border)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      <span style={{
        fontSize: 11,
        color: 'var(--vscode-descriptionForeground)',
        alignSelf: 'center',
        marginRight: 4,
      }}>
        {selectedNodeIds.length} 个节点
      </span>
      <button
        onClick={handleMove}
        style={{
          background: 'var(--vscode-button-secondaryBackground)',
          color: 'var(--vscode-button-secondaryForeground)',
          border: '1px solid var(--vscode-button-border, transparent)',
          borderRadius: 4,
          padding: '4px 12px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
        }}
        title="选中节点已可拖动，点击画布空白处取消选区"
      >
        移动
      </button>
      {hasPipeline && (
        <button
          onClick={handlePipelineRun}
          style={{
            background: 'var(--vscode-terminal-ansiMagenta)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
          title="运行选中节点中的 Pipeline 工作流"
        >
          ▶▶ Pipeline
        </button>
      )}
      {canCreateGroup && (
        <button
          onClick={() => {
            setGroupName('节点组');
            setGroupColor(GROUP_COLOR_OPTIONS[0]);
            setGroupDialogOpen(true);
          }}
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: 4,
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
          title="将当前选中的数据节点创建为节点组"
        >
          📦 创建节点组
        </button>
      )}
      {groupDialogOpen && (
        <div style={{
          position: 'absolute',
          left: '50%',
          top: 'calc(100% + 8px)',
          transform: 'translateX(-50%)',
          background: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 8,
          padding: 12,
          boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 10,
          minWidth: 260,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--vscode-foreground)' }}>创建节点组</div>
          <input
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { handleCreateGroup(); }
              if (e.key === 'Escape') { setGroupDialogOpen(false); }
            }}
            style={{
              width: 180,
              padding: '5px 8px',
              borderRadius: 6,
              border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              fontSize: 12,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>颜色</span>
            {GROUP_COLOR_OPTIONS.map(option => {
              const active = option.id === groupColor.id;
              return (
                <button
                  key={option.id}
                  onClick={() => setGroupColor(option)}
                  title={option.label}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: active ? '2px solid var(--vscode-focusBorder, #007fd4)' : `1px solid ${option.border}`,
                    background: option.fill,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => setGroupDialogOpen(false)} style={smallBtnStyle}>取消</button>
            <button
              onClick={handleCreateGroup}
              style={{
                ...smallBtnStyle,
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
              }}
            >
              确认
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

const smallBtnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 4,
  padding: '5px 10px',
  cursor: 'pointer',
  fontSize: 12,
  background: 'var(--vscode-button-secondaryBackground)',
  color: 'var(--vscode-button-secondaryForeground)',
};

const GROUP_COLOR_OPTIONS = [
  { id: 'yellow', label: '黄色', fill: 'rgba(216, 182, 72, 0.16)', border: '#d8b648' },
  { id: 'blue', label: '蓝色', fill: 'rgba(79, 195, 247, 0.16)', border: '#4fc3f7' },
  { id: 'green', label: '绿色', fill: 'rgba(129, 199, 132, 0.16)', border: '#81c784' },
  { id: 'orange', label: '橙色', fill: 'rgba(255, 183, 77, 0.16)', border: '#ffb74d' },
  { id: 'pink', label: '粉色', fill: 'rgba(240, 98, 146, 0.16)', border: '#f06292' },
];
