import React from 'react';
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { useCanvasStore } from '../../../stores/canvas-store';

// ── Pipeline Edge ─────────────────────────────────────────────────────────
// Renders function→function pipeline connections as dashed purple lines,
// visually distinct from data_flow (solid blue) edges.
// During pipeline execution: animated flowing dashes.

const PIPELINE_COLOR = 'var(--vscode-terminal-ansiMagenta)';
const PIPELINE_DONE_COLOR = 'var(--vscode-terminal-ansiGreen)';
const PIPELINE_FAIL_COLOR = 'var(--vscode-terminal-ansiRed)';

// Inject animation CSS once
const STYLE_ID = 'rs-pipeline-edge-anim';
function ensureAnimStyle() {
  if (document.getElementById(STYLE_ID)) { return; }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes rsPipelineFlow {
      to { stroke-dashoffset: -24; }
    }
  `;
  document.head.appendChild(style);
}

export function PipelineEdge({
  id, source, target,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, markerEnd, selected,
}: EdgeProps) {
  React.useEffect(() => { ensureAnimStyle(); }, []);

  const pipelineState = useCanvasStore(s => s.pipelineState);

  // Determine edge visual state based on source/target pipeline status
  let color = PIPELINE_COLOR;
  let animated = false;
  let strokeWidth = selected ? 2.5 : 1.8;

  if (pipelineState) {
    const srcStatus = pipelineState.nodeStatuses[source];
    const tgtStatus = pipelineState.nodeStatuses[target];

    if (srcStatus === 'done' && tgtStatus === 'running') {
      // Data flowing through this edge right now
      color = 'var(--vscode-terminal-ansiBlue)';
      animated = true;
      strokeWidth = 2.5;
    } else if (srcStatus === 'done' && tgtStatus === 'done') {
      // Both sides complete
      color = PIPELINE_DONE_COLOR;
    } else if (srcStatus === 'failed' || tgtStatus === 'failed') {
      color = PIPELINE_FAIL_COLOR;
    } else if (srcStatus === 'running') {
      animated = true;
    }
  }

  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <>
      {selected && (
        <BaseEdge
          id={`${id}-halo`}
          path={edgePath}
          style={{
            stroke: color,
            strokeWidth: 8,
            opacity: 0.22,
          }}
        />
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: selected ? Math.max(strokeWidth, 3.2) : strokeWidth,
          strokeDasharray: '8,4',
          opacity: selected ? 1 : 0.9,
          animation: animated ? 'rsPipelineFlow 0.6s linear infinite' : undefined,
          transition: 'stroke 0.3s, stroke-width 0.3s',
          filter: selected ? `drop-shadow(0 0 6px ${color})` : undefined,
        }}
      />
    </>
  );
}
