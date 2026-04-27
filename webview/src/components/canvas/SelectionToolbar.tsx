import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useReactFlow, useStore } from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';
import { isDataNode, type CanvasNode } from '../../../../src/core/canvas-model';
import { buildNextStepSuggestions } from '../../utils/next-step-suggestions';

/**
 * Floating toolbar that appears when selected nodes have available next steps
 * or when 2+ nodes are selected for batch actions.
 */
export function SelectionToolbar() {
  const selectedNodeIds = useCanvasStore(s => s.selectedNodeIds);
  const nodes = useCanvasStore(s => s.nodes);
  const nodeGroups = useCanvasStore(s => s.nodeGroups);
  const setSelectionMode = useCanvasStore(s => s.setSelectionMode);
  const getPipelineHeadNodes = useCanvasStore(s => s.getPipelineHeadNodes);
  const createNodeGroup = useCanvasStore(s => s.createNodeGroup);
  const createFunctionNodeFromSelection = useCanvasStore(s => s.createFunctionNodeFromSelection);
  const canvasFile = useCanvasStore(s => s.canvasFile);
  const toolDefs = useCanvasStore(s => s.toolDefs);
  const { getNodesBounds, flowToScreenPosition } = useReactFlow();
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('节点组');
  const [groupColor, setGroupColor] = useState(GROUP_COLOR_OPTIONS[0]);

  // Subscribe to viewport transform so we re-render on pan/zoom
  useStore(s => s.transform);

  if (selectedNodeIds.length === 0) { return null; }

  // Compute screen position (above the center of the selection)
  let screenPos = { x: 0, y: 0 };
  let selectionBounds = { x: 0, y: 0, width: 0, height: 0 };
  try {
    const bounds = getNodesBounds(selectedNodeIds);
    selectionBounds = bounds;
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
  const selectedCanvasNodes = selectedNodeIds
    .map(id => nodes.find(node => node.id === id)?.data)
    .filter((node): node is CanvasNode => !!node);
  const nextStepSuggestions = buildNextStepSuggestions(selectedCanvasNodes, {
    availableToolIds: toolDefs.map(tool => tool.id),
    limit: 4,
  });
  const canExportMarkdown = selectedCanvasNodes.length > 0;
  const shouldShowToolbar = selectedNodeIds.length >= 2 || nextStepSuggestions.length > 0 || canExportMarkdown;
  const selectedFunctionCount = selectedNodeIds.reduce((count, id) => {
    const node = nodes.find(item => item.id === id);
    return count + (node?.data.node_type === 'function' ? 1 : 0);
  }, 0);

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

  const handleCreateSuggestedTool = (toolId: string) => {
    createFunctionNodeFromSelection(toolId, selectedNodeIds, {
      x: selectionBounds.x + selectionBounds.width + 80,
      y: selectionBounds.y,
    });
  };

  const handleExportMarkdown = () => {
    postMessage({
      type: 'exportSelectedMarkdown',
      selectedNodeIds,
      canvas: canvasFile ?? undefined,
    });
  };

  const handleCreateBlueprint = () => {
    postMessage({
      type: 'createBlueprintDraft',
      selectedNodeIds,
      canvas: canvasFile ?? undefined,
    });
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
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        maxWidth: 760,
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
      {nextStepSuggestions.length > 0 && (
        <>
          <span style={{
            fontSize: 11,
            color: 'var(--vscode-descriptionForeground)',
            alignSelf: 'center',
          }}>
            下一步
          </span>
          {nextStepSuggestions.map(suggestion => (
            <button
              key={suggestion.id}
              onClick={() => suggestion.toolId && handleCreateSuggestedTool(suggestion.toolId)}
              style={{
                background: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)',
                border: '1px solid var(--vscode-button-border, transparent)',
                borderRadius: 999,
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
              title={`${suggestion.description}；只创建并连接功能节点，不自动运行。`}
            >
              {suggestion.label}
            </button>
          ))}
        </>
      )}
      {canExportMarkdown && (
        <button
          onClick={handleExportMarkdown}
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: 4,
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
          title="将当前选中的节点按画布位置导出为 Markdown 文件"
        >
          导出 MD
        </button>
      )}
      {selectedFunctionCount > 0 && (
        <button
          onClick={handleCreateBlueprint}
          style={{
            background: '#2f7d68',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
          title="把当前选中的工作流提取成蓝图草稿"
        >
          🔧 创建蓝图
        </button>
      )}
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
