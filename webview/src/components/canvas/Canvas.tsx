import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  useOnSelectionChange,
  type NodeTypes,
  type EdgeTypes,
  type Node,
  type Edge,
} from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';
import { DataNode } from '../nodes/DataNode';
import { FunctionNode } from '../nodes/FunctionNode';
import { CustomEdge } from './edges/CustomEdge';
import { RolePickerDialog } from './RolePickerDialog';
import { Toolbar } from '../panels/Toolbar';
import { AiToolsPanel, DRAG_TOOL_KEY } from '../panels/AiToolsPanel';
import { AiOutputPanel } from '../panels/AiOutputPanel';
import { StagingPanel, STAGING_NODE_KEY } from '../panels/StagingPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { EmptyCanvasGuide } from './EmptyCanvasGuide';
import { SelectionToolbar } from './SelectionToolbar';
import { SummaryNameDialog } from './SummaryNameDialog';
import { SummaryOverlays } from './SummaryOverlay';
import type { AiTool } from '../../../../../src/core/canvas-model';

const nodeTypes: NodeTypes = {
  dataNode: DataNode,
  functionNode: FunctionNode,
};

const edgeTypes: EdgeTypes = {
  custom: CustomEdge,
};

export function Canvas() {
  const {
    nodes, edges, syntheticEdges,
    onNodesChange, onEdgesChange, onConnect,
    confirmConnection, cancelConnection,
    pendingConnection,
    createFunctionNode, commitStagingNode,
    setSelectedNodeIds, selectedNodeIds,
    showSummaryDialog,
    summaryGroups, deleteSummary,
    selectionMode, setSelectionMode,
    undo, redo,
  } = useCanvasStore();
  const { screenToFlowPosition } = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Drag-over overlay state (shows big hint when dragging files onto canvas)
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo / Redo keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) { return; }
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // Track selection changes
  useOnSelectionChange({
    onChange: useCallback(({ nodes: selNodes }: { nodes: Node[] }) => {
      const ids = selNodes.map(n => n.id);
      setSelectedNodeIds(ids);
    }, [setSelectedNodeIds]),
  });

  // Synthetic edges are read-only — mark them so ReactFlow won't let users delete them
  const allEdges = useMemo(() => [
    ...edges,
    ...syntheticEdges.map(e => ({ ...e, deletable: false, focusable: false })),
  ], [edges, syntheticEdges]);

  // Filter out any changes that target synthetic edges before passing to the store
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      const filtered = changes.filter(c => {
        if (c.type === 'remove' && c.id.startsWith('syn-')) { return false; }
        if (c.type === 'select' && c.id.startsWith('syn-')) { return false; }
        return true;
      });
      if (filtered.length > 0) { onEdgesChange(filtered); }
    },
    [onEdgesChange]
  );

  const handleConnect = useCallback(
    (connection: Parameters<typeof onConnect>[0]) => onConnect(connection),
    [onConnect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes(DRAG_TOOL_KEY) ||
      e.dataTransfer.types.includes(STAGING_NODE_KEY) ||
      e.dataTransfer.types.includes('Files') ||
      e.dataTransfer.types.includes('text/uri-list')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      // Show overlay for external file drags
      if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list')) {
        if (dragLeaveTimer.current) { clearTimeout(dragLeaveTimer.current); dragLeaveTimer.current = null; }
        setIsDraggingOver(true);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only hide if leaving the wrapper entirely (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) { return; }
    dragLeaveTimer.current = setTimeout(() => setIsDraggingOver(false), 80);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);

    if (e.dataTransfer.types.includes(STAGING_NODE_KEY)) {
      const nodeId = e.dataTransfer.getData(STAGING_NODE_KEY);
      if (nodeId) {
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        commitStagingNode(nodeId, pos);
      }
      return;
    }

    if (e.dataTransfer.types.includes(DRAG_TOOL_KEY)) {
      const toolId = e.dataTransfer.getData(DRAG_TOOL_KEY) as AiTool;
      if (toolId) {
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        createFunctionNode(toolId, pos);
      }
      return;
    }

    // Native file drops — from VSCode explorer or OS file manager
    const uris: string[] = [];

    // Try text/uri-list first (VSCode explorer drag)
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (uriList) {
      for (const line of uriList.split(/\r?\n/)) {
        const u = line.trim();
        if (u && !u.startsWith('#')) { uris.push(u); }
      }
    }

    // Fallback: File objects (OS native drag)
    if (uris.length === 0 && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i] as File & { path?: string };
        if (f.path) { uris.push(f.path); }
      }
    }

    if (uris.length > 0) {
      postMessage({ type: 'dropFiles', uris });
    }
  }, [screenToFlowPosition, commitStagingNode, createFunctionNode]);

  // When nodes are deleted, also clean up their non-synthetic connected edges + summaries.
  const handleNodesDelete = useCallback((deleted: Node[]) => {
    const ids = new Set(deleted.map(n => n.id));
    const danglingEdges = edges
      .filter(e => ids.has(e.source) || ids.has(e.target))
      .map(e => ({ type: 'remove' as const, id: e.id }));
    if (danglingEdges.length > 0) { onEdgesChange(danglingEdges); }

    // Remove deleted nodes from summary groups
    for (const group of summaryGroups) {
      const remaining = group.nodeIds.filter(nid => !ids.has(nid));
      if (remaining.length < 2) {
        deleteSummary(group.id);
      }
    }
  }, [edges, onEdgesChange, summaryGroups, deleteSummary]);

  const handleEdgesDelete = useCallback((deleted: Edge[]) => {
    const changes = deleted
      .filter(e => !e.id.startsWith('syn-'))
      .map(e => ({ type: 'remove' as const, id: e.id }));
    if (changes.length > 0) { onEdgesChange(changes); }
  }, [onEdgesChange]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar />
      <div style={{ flex: 1, position: 'relative' }} ref={reactFlowWrapper} onDragLeave={handleDragLeave}>
        <ReactFlow
          onlyRenderVisibleElements
          nodes={nodes}
          edges={allEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onNodesDelete={handleNodesDelete}
          onEdgesDelete={handleEdgesDelete}
          selectionOnDrag={selectionMode}
          panOnDrag={!selectionMode}
          minZoom={0.05}
          maxZoom={4}
          fitView
          deleteKeyCode={['Delete', 'Backspace']}
          style={{ background: 'var(--vscode-editor-background)' }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="var(--vscode-editorIndentGuide-background)"
            size={1.5}
            gap={20}
          />
          <MiniMap
            pannable
            zoomable
            style={{
              background: 'var(--vscode-sideBar-background)',
              border: '1px solid var(--vscode-panel-border)',
            }}
            nodeColor="var(--vscode-badge-background)"
          />
          <SummaryOverlays />
        </ReactFlow>
        <AiToolsPanel />
        <AiOutputPanel />
        <StagingPanel />
        <SettingsPanel />
        {nodes.length === 0 && <EmptyCanvasGuide />}
        <SelectionToolbar />
        {showSummaryDialog && <SummaryNameDialog />}
        {pendingConnection && (
          <RolePickerDialog
            sourceTitle={pendingConnection.sourceNode.title}
            targetToolName={pendingConnection.targetToolDef.name}
            slots={pendingConnection.targetToolDef.slots ?? []}
            onSelect={role => confirmConnection(role)}
            onCancel={cancelConnection}
          />
        )}
        {/* Large drop-zone overlay when dragging external files (Shift held) */}
        {isDraggingOver && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)',
            pointerEvents: 'none',
            gap: 12,
          }}>
            <div style={{
              fontSize: 48,
              lineHeight: 1,
            }}>
              📥
            </div>
            <div style={{
              fontSize: 24,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: 1,
            }}>
              松开即可添加到画布
            </div>
            <div style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.6)',
              fontWeight: 400,
            }}>
              文件将进入暂存架，拖至画布放置
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
