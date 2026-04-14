import React from 'react';
import ReactDOM from 'react-dom';
import { useReactFlow, useStore } from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvas-store';

/**
 * Floating toolbar that appears when 2+ nodes are selected.
 * Shows node count and a "移动" (Move) hint.
 * Subscribes to viewport changes so it tracks node positions during pan/zoom.
 */
export function SelectionToolbar() {
  const { selectedNodeIds, setSelectionMode } = useCanvasStore();
  const { getNodesBounds, flowToScreenPosition } = useReactFlow();

  // Subscribe to viewport transform so we re-render on pan/zoom
  useStore(s => s.transform);

  if (selectedNodeIds.length < 2) { return null; }

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
    </div>,
    document.body
  );
}
