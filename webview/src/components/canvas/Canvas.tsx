import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  BackgroundVariant,
  ViewportPortal,
  useReactFlow,
  useOnSelectionChange,
  type NodeTypes,
  type EdgeTypes,
  type Node as RFNode,
  type Edge,
  type Connection,
  type IsValidConnection,
} from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';
import { wouldCreateCycle } from '../../utils/graph-utils';
import { DataNode } from '../nodes/DataNode';
import { FunctionNode } from '../nodes/FunctionNode';
import { NodeGroupNode } from '../nodes/NodeGroupNode';
import { BlueprintContainerNode } from '../nodes/BlueprintContainerNode';
import { CustomEdge } from './edges/CustomEdge';
import { PipelineEdge } from './edges/PipelineEdge';
import { RolePickerDialog } from './RolePickerDialog';
import { Toolbar } from '../panels/Toolbar';
import { AiToolsPanel, DRAG_BLUEPRINT_KEY, DRAG_TOOL_KEY } from '../panels/AiToolsPanel';
import { AiOutputPanel } from '../panels/AiOutputPanel';
import { StagingPanel, STAGING_NODE_KEY } from '../panels/StagingPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { EmptyCanvasGuide } from './EmptyCanvasGuide';
import { SelectionToolbar } from './SelectionToolbar';
import { BoardOverlays } from './BoardOverlay';
import { SearchBar } from './SearchBar';
import { PreviewModal } from './PreviewModal';
import { PipelineToolbar } from '../pipeline/PipelineToolbar';
import { isDataNode, isGroupHubNode } from '../../../../src/core/canvas-model';
import type { AiTool } from '../../../../src/core/canvas-model';
import { closeAllCanvasContextMenus, useCanvasContextMenuAutoClose } from '../../utils/context-menu';

const nodeTypes: NodeTypes = {
  dataNode: DataNode,
  functionNode: FunctionNode,
  nodeGroup: NodeGroupNode,
  blueprintNode: BlueprintContainerNode,
};

const edgeTypes: EdgeTypes = {
  custom: CustomEdge,
  pipeline: PipelineEdge,
};

export function Canvas() {
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const syntheticEdges = useCanvasStore(s => s.syntheticEdges);
  const onNodesChange = useCanvasStore(s => s.onNodesChange);
  const onEdgesChange = useCanvasStore(s => s.onEdgesChange);
  const onConnect = useCanvasStore(s => s.onConnect);
  const confirmConnection = useCanvasStore(s => s.confirmConnection);
  const cancelConnection = useCanvasStore(s => s.cancelConnection);
  const pendingConnection = useCanvasStore(s => s.pendingConnection);
  const createFunctionNode = useCanvasStore(s => s.createFunctionNode);
  const commitStagingNode = useCanvasStore(s => s.commitStagingNode);
  const setSelectedNodeIds = useCanvasStore(s => s.setSelectedNodeIds);
  const selectedNodeIds = useCanvasStore(s => s.selectedNodeIds);
  const duplicateNode = useCanvasStore(s => s.duplicateNode);
  const getPipelineHeadNodes = useCanvasStore(s => s.getPipelineHeadNodes);
  const nodeGroups = useCanvasStore(s => s.nodeGroups);
  const canvasFile = useCanvasStore(s => s.canvasFile);
  const searchOpen = useCanvasStore(s => s.searchOpen);
  const searchMatches = useCanvasStore(s => s.searchMatches);
  const searchIndex = useCanvasStore(s => s.searchIndex);
  const setSearchOpen = useCanvasStore(s => s.setSearchOpen);
  const boards = useCanvasStore(s => s.boards);
  const selectionMode = useCanvasStore(s => s.selectionMode);
  const undo = useCanvasStore(s => s.undo);
  const redo = useCanvasStore(s => s.redo);
  const selectExclusiveEdge = useCanvasStore(s => s.selectExclusiveEdge);
  const clearSelection = useCanvasStore(s => s.clearSelection);
  const saveNow = useCanvasStore(s => s.saveNow);
  const initialCanvasLoadActive = useCanvasStore(s => s.initialCanvasLoadActive);
  const initialCanvasLoadSessionId = useCanvasStore(s => s.currentInitialCanvasLoadStats?.sessionId ?? null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const initialCanvasFrameLoggedRef = useRef<number | null>(null);

  // Drag-over overlay state (shows big hint when dragging files onto canvas)
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
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
    onChange: useCallback(({ nodes: selNodes }: { nodes: RFNode[] }) => {
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
    (connection: Parameters<typeof onConnect>[0]) => {
      onConnect(connection);
    },
    [onConnect]
  );

  // v2.0: Real-time connection validation — prevent cycles in pipeline connections
  const isValidConnection: IsValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const state = useCanvasStore.getState();
      if (!state.canvasFile) { return true; }
      const sourceNode = state.canvasFile.nodes.find(n => n.id === connection.source);
      const targetNode = state.canvasFile.nodes.find(n => n.id === connection.target);

      // Self-loop is never valid
      if (connection.source === connection.target) { return false; }
      if (!sourceNode || !targetNode) { return false; }

      // Function → Function: check for cycles
      if (sourceNode?.node_type === 'function' && targetNode?.node_type === 'function') {
        return !wouldCreateCycle(state.canvasFile.edges, connection.source, connection.target);
      }

      if (isGroupHubNode(targetNode)) {
        return sourceNode.node_type !== 'function';
      }

      if (isGroupHubNode(sourceNode)) {
        return targetNode.node_type === 'function' || isGroupHubNode(targetNode);
      }

      if (targetNode.node_type === 'blueprint') {
        if (!connection.targetHandle) { return false; }
        if (!(isDataNode(sourceNode) || isGroupHubNode(sourceNode))) { return false; }
        const slot = targetNode.meta?.blueprint_input_slot_defs?.find(item => item.id === connection.targetHandle);
        if (!slot) { return false; }
        if (!slot.allow_multiple) {
          const alreadyBound = state.canvasFile.edges.some(edge =>
            edge.target === connection.target &&
            edge.targetHandle === connection.targetHandle &&
            edge.edge_type === 'data_flow'
          );
          if (alreadyBound) { return false; }
        }
        return true;
      }

      if (targetNode.node_type === 'function') {
        return sourceNode.node_type !== 'function';
      }

      return false;
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes(DRAG_TOOL_KEY) ||
      e.dataTransfer.types.includes(DRAG_BLUEPRINT_KEY) ||
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
    if (e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) { return; }
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

    if (e.dataTransfer.types.includes(DRAG_BLUEPRINT_KEY)) {
      const raw = e.dataTransfer.getData(DRAG_BLUEPRINT_KEY);
      if (raw) {
        try {
          const entry = JSON.parse(raw) as import('../../../../src/blueprint/blueprint-registry').BlueprintRegistryEntry;
          const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
          postMessage({ type: 'instantiateBlueprint', filePath: entry.file_path, position: pos });
        } catch {
          // Ignore malformed drag payload.
        }
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

  // When nodes are deleted, also clean up their non-synthetic connected edges.
  const handleNodesDelete = useCallback((deleted: RFNode[]) => {
    const ids = new Set(deleted.map(n => n.id));
    const danglingEdges = edges
      .filter(e => ids.has(e.source) || ids.has(e.target))
      .map(e => ({ type: 'remove' as const, id: e.id }));
    if (danglingEdges.length > 0) { onEdgesChange(danglingEdges); }
  }, [edges, onEdgesChange]);

  const handleEdgesDelete = useCallback((deleted: Edge[]) => {
    const changes = deleted
      .filter(e => !e.id.startsWith('syn-'))
      .map(e => ({ type: 'remove' as const, id: e.id }));
    if (changes.length > 0) { onEdgesChange(changes); }
  }, [onEdgesChange]);

  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    closeAllCanvasContextMenus();
    selectExclusiveEdge(edge.id);
  }, [selectExclusiveEdge]);

  const handleEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    event.stopPropagation();
    closeAllCanvasContextMenus();
    selectExclusiveEdge(edge.id);
    const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setEdgeContextMenu({ edgeId: edge.id, x: pos.x + 10, y: pos.y + 10 });
  }, [screenToFlowPosition, selectExclusiveEdge]);

  // Canvas-wide shortcuts (excluding input/textarea/contenteditable)
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) { return false; }
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    };

    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) { return; }

      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (key === 's') {
        e.preventDefault();
        saveNow();
        return;
      }

      if (isEditableTarget(e.target)) { return; }

      if (key === 'a') {
        e.preventDefault();
        const ids = nodes.map(n => n.id);
        if (ids.length === 0) { return; }
        onNodesChange(ids.map(id => ({ id, type: 'select', selected: true })) as Parameters<typeof onNodesChange>[0]);
        setSelectedNodeIds(ids);
        return;
      }

      if (key === 'd') {
        e.preventDefault();
        const ids = [...selectedNodeIds];
        for (const id of ids) {
          duplicateNode(id);
        }
        return;
      }

      if (key === 'enter' && !e.shiftKey) {
        e.preventDefault();
        const state = useCanvasStore.getState();
        const firstFn = selectedNodeIds
          .map(id => state.nodes.find(n => n.id === id))
          .find(n => n?.data.node_type === 'function');
        if (firstFn) {
          postMessage({ type: 'runFunction', nodeId: firstFn.id, canvas: state.canvasFile ?? undefined });
        }
        return;
      }

      if (key === 'enter' && e.shiftKey) {
        e.preventDefault();
        const state = useCanvasStore.getState();
        const heads = state.getPipelineHeadNodes(selectedNodeIds);
        for (const head of heads) {
          postMessage({ type: 'runPipeline', triggerNodeId: head.id, canvas: state.canvasFile ?? undefined });
        }
        return;
      }

      if (key === '0') {
        e.preventDefault();
        fitView({ padding: 0.1, duration: 250 });
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nodes, selectedNodeIds, onNodesChange, setSelectedNodeIds, duplicateNode, fitView, setSearchOpen, saveNow]);

  // Search focus jump: fit to current match
  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0 || searchIndex < 0) { return; }
    const nodeId = searchMatches[searchIndex];
    fitView({ nodes: [{ id: nodeId }], padding: 0.3, duration: 220 });
  }, [searchOpen, searchMatches, searchIndex, fitView]);

  const collapsedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of nodeGroups) {
      if (!g.collapsed) { continue; }
      for (const id of g.nodeIds) { ids.add(id); }
    }
    return ids;
  }, [nodeGroups]);

  const displayNodes = useMemo<RFNode[]>(() => {
    const matchSet = new Set(searchMatches);
    const hasSearch = searchOpen && searchMatches.length > 0;
    const currentId = searchIndex >= 0 ? searchMatches[searchIndex] : null;
    const hasCollapsedGroups = collapsedNodeIds.size > 0;

    const visualNodes = (!hasSearch && !hasCollapsedGroups)
      ? nodes
      : nodes.map(n => {
          const hidden = collapsedNodeIds.has(n.id);
          let style = n.style;

          if (hasSearch && !hidden) {
            const isMatch = matchSet.has(n.id);
            const isCurrent = currentId === n.id;
            style = { ...(n.style ?? {}) };

            if (!isMatch) {
              style.opacity = 0.3;
              style.filter = 'grayscale(0.2)';
            } else {
              style.opacity = 1;
              style.border = isCurrent
                ? '2px solid #ffdd57'
                : '2px solid rgba(255, 221, 87, 0.65)';
              style.boxShadow = isCurrent
                ? '0 0 0 3px rgba(255, 221, 87, 0.28), 0 6px 16px rgba(0,0,0,0.25)'
                : '0 0 0 2px rgba(255, 221, 87, 0.18)';
            }
          }

          if (hidden !== !!n.hidden || style !== n.style) {
            return { ...n, hidden, style };
          }
          return n;
        });

    return visualNodes as unknown as RFNode[];
  }, [nodes, nodeGroups, collapsedNodeIds, searchOpen, searchMatches, searchIndex]);

  useEffect(() => {
    if (!initialCanvasLoadActive || !initialCanvasLoadSessionId) { return; }
    if (initialCanvasFrameLoggedRef.current === initialCanvasLoadSessionId) { return; }
    initialCanvasFrameLoggedRef.current = initialCanvasLoadSessionId;
    console.debug('[ResearchSpace] initial canvas frame', {
      displayNodeCount: displayNodes.length,
      edgeCount: allEdges.length,
    });
  }, [allEdges.length, displayNodes.length, initialCanvasLoadActive, initialCanvasLoadSessionId]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar />
      <div style={{ flex: 1, position: 'relative' }} ref={reactFlowWrapper} onDragLeave={handleDragLeave}>
        <ReactFlow
          nodes={displayNodes}
          edges={allEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          isValidConnection={isValidConnection}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onNodesDelete={handleNodesDelete}
          onEdgesDelete={handleEdgesDelete}
          onEdgeClick={handleEdgeClick}
          onEdgeContextMenu={handleEdgeContextMenu}
          onPaneClick={() => {
            closeAllCanvasContextMenus();
            setEdgeContextMenu(null);
            clearSelection();
          }}
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
          <BoardOverlays />
          {edgeContextMenu && (
            <EdgeContextMenu
              edgeId={edgeContextMenu.edgeId}
              x={edgeContextMenu.x}
              y={edgeContextMenu.y}
              onDelete={() => {
                onEdgesChange([{ type: 'remove', id: edgeContextMenu.edgeId }]);
                setEdgeContextMenu(null);
              }}
              onClose={() => setEdgeContextMenu(null)}
            />
          )}
        </ReactFlow>
        <AiToolsPanel />
        <AiOutputPanel />
        <StagingPanel />
        <SettingsPanel />
        <SearchBar />
        {nodes.length === 0 && <EmptyCanvasGuide />}
        <SelectionToolbar />
        <PipelineToolbar />
        <PreviewModal />
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

function EdgeContextMenu({
  edgeId,
  x,
  y,
  onDelete,
  onClose,
}: {
  edgeId: string;
  x: number;
  y: number;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  useCanvasContextMenuAutoClose(true, onClose, menuRef);

  return (
    <ViewportPortal>
      <div
        ref={menuRef}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          background: 'var(--vscode-menu-background, var(--vscode-editor-background))',
          border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          zIndex: 10050,
          minWidth: 160,
          overflow: 'hidden',
          fontSize: 12,
          pointerEvents: 'auto',
        }}
        onClick={event => event.stopPropagation()}
        onContextMenu={event => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          style={{
            display: 'block',
            width: '100%',
            padding: '7px 14px',
            background: 'transparent',
            border: 'none',
            color: 'var(--vscode-errorForeground, #f48771)',
            fontSize: 12,
            textAlign: 'left',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          title={`删除连接线 ${edgeId}`}
        >
          🗑 删除连接线
        </button>
      </div>
    </ViewportPortal>
  );
}
