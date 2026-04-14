import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { useCanvasStore } from '../../../stores/canvas-store';

interface EdgeData {
  edge_type: 'data_flow' | 'ai_generated' | 'reference';
  label?: string;
  role?: string;
  roleLabel?: string;  // Display label resolved from tool slots
}

const EDGE_COLORS: Record<string, string> = {
  data_flow:    'var(--vscode-terminal-ansiBlue)',
  ai_generated: 'var(--vscode-terminal-ansiGreen)',
  reference:    'var(--vscode-editorIndentGuide-activeBackground)',
};

export function CustomEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, markerEnd, selected,
  target,
}: EdgeProps) {
  const edgeData = data as EdgeData | undefined;
  const edgeType = edgeData?.edge_type ?? 'reference';
  const color = EDGE_COLORS[edgeType] ?? EDGE_COLORS.reference;

  // Resolve role label from tool slot definitions if not pre-computed
  const toolDefs = useCanvasStore(s => s.toolDefs);
  const canvasNodes = useCanvasStore(s => s.canvasFile?.nodes);
  const resolvedRoleLabel = React.useMemo(() => {
    if (!edgeData?.role) { return undefined; }
    if (edgeData.roleLabel) { return edgeData.roleLabel; }
    // Find the target function node's tool and look up the slot label
    const targetNode = canvasNodes?.find(n => n.id === target);
    const toolId = targetNode?.meta?.ai_tool as string | undefined;
    const toolDef = toolId ? toolDefs.find(d => d.id === toolId) : undefined;
    const slot = toolDef?.slots?.find(s => s.name === edgeData.role);
    return slot?.label ?? edgeData.role;
  }, [edgeData, toolDefs, canvasNodes, target]);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: edgeType === 'reference' ? '5,5' : undefined,
          opacity: 0.85,
        }}
      />
      {edgeData?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              background: 'var(--vscode-badge-background)',
              color: 'var(--vscode-badge-foreground)',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 11,
              pointerEvents: 'none',
            }}
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {!edgeData?.label && edgeData?.role && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              background: 'var(--vscode-editor-background)',
              color: color,
              border: `1px solid ${color}`,
              padding: '1px 7px',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 500,
              pointerEvents: 'none',
              opacity: 0.9,
              whiteSpace: 'nowrap',
            }}
          >
            {resolvedRoleLabel ?? edgeData.role}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
