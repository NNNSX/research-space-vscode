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
  type Viewport,
} from '@xyflow/react';
import { useCanvasStore, type CanvasDetailLevel } from '../../stores/canvas-store';
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
import { BlueprintOverlays } from './BlueprintOverlay';
import { SearchBar } from './SearchBar';
import { PreviewModal } from './PreviewModal';
import { PipelineToolbar } from '../pipeline/PipelineToolbar';
import { isBlueprintInputPlaceholderNode, isDataNode, isGroupHubNode } from '../../../../src/core/canvas-model';
import type { AiTool, CanvasFile, CanvasNode } from '../../../../src/core/canvas-model';
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

const NODE_TYPE_LABELS: Partial<Record<CanvasNode['node_type'], string>> = {
  paper: 'PDF / 论文',
  note: '笔记文本',
  code: '代码文本',
  image: '图像',
  ai_output: 'AI 文本输出',
  audio: '音频',
  video: '视频',
  data: '表格数据',
  experiment_log: '实验记录',
  task: '任务清单',
  blueprint: '蓝图',
};

function describeNodeType(type: CanvasNode['node_type']): string {
  return NODE_TYPE_LABELS[type] ?? type;
}

function describeAcceptTypes(types: CanvasNode['node_type'][] | undefined): string {
  if (!types || types.length === 0) { return '任意数据节点'; }
  return types.map(describeNodeType).join(' / ');
}

function getConnectionValidationResult(
  file: CanvasFile,
  connection: Connection,
): { valid: boolean; reason?: string } {
  if (!connection.source || !connection.target) {
    return { valid: false, reason: '连接失败：未命中有效的起点或终点。' };
  }
  if (connection.source === connection.target) {
    return { valid: false, reason: '连接失败：节点不能连接到自己。' };
  }

  const sourceNode = file.nodes.find(n => n.id === connection.source);
  const targetNode = file.nodes.find(n => n.id === connection.target);
  if (!sourceNode || !targetNode) {
    return { valid: false, reason: '连接失败：目标节点不存在或已失效。' };
  }

  if (sourceNode.node_type === 'function' && targetNode.node_type === 'function') {
    if (wouldCreateCycle(file.edges, connection.source, connection.target)) {
      return { valid: false, reason: '连接失败：这条 Pipeline 连线会形成循环依赖。' };
    }
    return { valid: true };
  }

  if (isGroupHubNode(targetNode)) {
    return sourceNode.node_type !== 'function'
      ? { valid: true }
      : { valid: false, reason: '连接失败：节点组不接受功能节点直接作为普通数据输入。' };
  }

  if (isGroupHubNode(sourceNode)) {
    return (targetNode.node_type === 'function' || isGroupHubNode(targetNode))
      ? { valid: true }
      : { valid: false, reason: '连接失败：节点组只能连接到功能节点或其他节点组。' };
  }

  if (targetNode.node_type === 'blueprint') {
    if (!connection.targetHandle) {
      return { valid: false, reason: '连接失败：请拖到蓝图输入槽位的圆点上，而不是蓝图外框本体。' };
    }
    if (!(isDataNode(sourceNode) || isGroupHubNode(sourceNode))) {
      return { valid: false, reason: '连接失败：蓝图输入槽位只接受数据节点。' };
    }
    const slot = targetNode.meta?.blueprint_input_slot_defs?.find(item => item.id === connection.targetHandle);
    if (!slot) {
      return { valid: false, reason: '连接失败：未命中有效的蓝图输入槽位。' };
    }
    if (!slot.allow_multiple) {
      const alreadyBound = file.edges.some(edge =>
        edge.target === connection.target &&
        edge.targetHandle === connection.targetHandle &&
        edge.edge_type === 'data_flow'
      );
      if (alreadyBound) {
        return { valid: false, reason: `连接失败：槽位“${slot.title}”当前只允许 1 条输入，请先删除旧连接。` };
      }
    }
    return { valid: true };
  }

  if (isBlueprintInputPlaceholderNode(targetNode)) {
    if (!(isDataNode(sourceNode) || isGroupHubNode(sourceNode))) {
      return { valid: false, reason: '连接失败：蓝图输入占位只接受数据节点。' };
    }
    if (
      sourceNode.meta?.blueprint_instance_id &&
      sourceNode.meta.blueprint_instance_id === targetNode.meta?.blueprint_instance_id
    ) {
      return { valid: false, reason: '连接失败：蓝图输入占位不能再接回本实例内部节点，请连接实例外部输入。' };
    }
    const accepts = targetNode.meta?.blueprint_placeholder_accepts ?? [];
    if (isDataNode(sourceNode) && accepts.length > 0 && !accepts.includes(sourceNode.node_type)) {
      const slotTitle = targetNode.meta?.blueprint_placeholder_title ?? targetNode.title ?? '该输入槽位';
      return {
        valid: false,
        reason: `连接失败：槽位“${slotTitle}”只接受 ${describeAcceptTypes(accepts)}，当前拖入的是 ${describeNodeType(sourceNode.node_type)}。`,
      };
    }
    if (!targetNode.meta?.blueprint_placeholder_allow_multiple) {
      const alreadyBound = file.edges.some(edge =>
        edge.target === connection.target &&
        edge.edge_type === 'data_flow'
      );
      if (alreadyBound) {
        const slotTitle = targetNode.meta?.blueprint_placeholder_title ?? targetNode.title ?? '该输入槽位';
        return { valid: false, reason: `连接失败：槽位“${slotTitle}”当前是单绑定，请先移除旧输入。` };
      }
    }
    const duplicateBinding = file.edges.some(edge =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      edge.edge_type === 'data_flow'
    );
    if (duplicateBinding) {
      return { valid: false, reason: '连接失败：这条输入连线已经存在，无需重复连接。' };
    }
    return { valid: true };
  }

  if (targetNode.node_type === 'function') {
    return sourceNode.node_type !== 'function'
      ? { valid: true }
      : { valid: false, reason: '连接失败：功能节点之间只能建立 Pipeline 连线。' };
  }

  return { valid: false, reason: `连接失败：${describeNodeType(sourceNode.node_type)} 不能直接连接到 ${describeNodeType(targetNode.node_type)}。` };
}

function getEventClientPoint(event: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
  if ('clientX' in event && typeof event.clientX === 'number') {
    return { x: event.clientX, y: event.clientY };
  }
  if ('changedTouches' in event && event.changedTouches && event.changedTouches.length > 0) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  return null;
}

function resolveCanvasDetailLevel(zoom: number): CanvasDetailLevel {
  if (zoom < 0.14) { return 'minimal'; }
  if (zoom < 0.30) { return 'compact'; }
  return 'full';
}

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
  const deleteConfirm = useCanvasStore(s => s.deleteConfirm);
  const requestDeleteConfirm = useCanvasStore(s => s.requestDeleteConfirm);
  const clearDeleteConfirm = useCanvasStore(s => s.clearDeleteConfirm);
  const selectExclusiveEdge = useCanvasStore(s => s.selectExclusiveEdge);
  const clearSelection = useCanvasStore(s => s.clearSelection);
  const updateViewport = useCanvasStore(s => s.updateViewport);
  const saveNow = useCanvasStore(s => s.saveNow);
  const setError = useCanvasStore(s => s.setError);
  const canvasDetailLevel = useCanvasStore(s => s.canvasDetailLevel);
  const setCanvasDetailLevel = useCanvasStore(s => s.setCanvasDetailLevel);
  const initialCanvasLoadActive = useCanvasStore(s => s.initialCanvasLoadActive);
  const initialCanvasLoadSessionId = useCanvasStore(s => s.currentInitialCanvasLoadStats?.sessionId ?? null);
  const { screenToFlowPosition, fitView, setViewport, getViewport } = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const initialCanvasFrameLoggedRef = useRef<number | null>(null);
  const lastAppliedViewportRef = useRef<string | null>(null);
  const canvasDetailLevelRef = useRef<CanvasDetailLevel>(canvasDetailLevel);

  const persistedViewport = canvasFile?.viewport ?? { x: 0, y: 0, zoom: 1 };
  const hasPersistedViewport = Math.abs(persistedViewport.x) > 0.5 || Math.abs(persistedViewport.y) > 0.5 || Math.abs(persistedViewport.zoom - 1) > 0.001;

  // Drag-over overlay state (shows big hint when dragging files onto canvas)
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingConnectionStartRef = useRef<{ sourceId: string; sourceHandle?: string | null } | null>(null);
  const connectionCommittedRef = useRef(false);

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
      connectionCommittedRef.current = true;
      onConnect(connection);
    },
    [onConnect]
  );

  // v2.0: Real-time connection validation — prevent cycles in pipeline connections
  const isValidConnection: IsValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const state = useCanvasStore.getState();
      if (!state.canvasFile) { return true; }
      return getConnectionValidationResult(state.canvasFile, connection as Connection).valid;
    },
    []
  );

  const handleConnectStart = useCallback((_event: unknown, params: { nodeId?: string; handleId?: string | null }) => {
    if (!params.nodeId) {
      pendingConnectionStartRef.current = null;
      return;
    }
    connectionCommittedRef.current = false;
    pendingConnectionStartRef.current = {
      sourceId: params.nodeId,
      sourceHandle: params.handleId ?? null,
    };
  }, []);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const pending = pendingConnectionStartRef.current;
    const didCommit = connectionCommittedRef.current;
    pendingConnectionStartRef.current = null;
    connectionCommittedRef.current = false;

    if (didCommit || !pending) { return; }

    const state = useCanvasStore.getState();
    if (!state.canvasFile) { return; }

    const point = getEventClientPoint(event);
    if (!point) { return; }
    const targetElement = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
    if (!targetElement) { return; }

    const handleEl = targetElement.closest('[data-handleid]') as HTMLElement | null;
    const nodeEl = targetElement.closest('.react-flow__node') as HTMLElement | null;
    const targetNodeId = handleEl?.getAttribute('data-nodeid')
      ?? nodeEl?.getAttribute('data-id')
      ?? undefined;
    if (!targetNodeId) { return; }

    const candidate: Connection = {
      source: pending.sourceId,
      sourceHandle: pending.sourceHandle ?? undefined,
      target: targetNodeId,
      targetHandle: handleEl?.getAttribute('data-handleid') ?? undefined,
    };
    const result = getConnectionValidationResult(state.canvasFile, candidate);
    if (!result.valid && result.reason) {
      setError(result.reason);
    }
  }, [setError]);

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

  const handleMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    updateViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
  }, [updateViewport]);

  const handleMove = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    const nextLevel = resolveCanvasDetailLevel(viewport.zoom);
    if (canvasDetailLevelRef.current === nextLevel) { return; }
    canvasDetailLevelRef.current = nextLevel;
    setCanvasDetailLevel(nextLevel);
  }, [setCanvasDetailLevel]);

  useEffect(() => {
    canvasDetailLevelRef.current = canvasDetailLevel;
  }, [canvasDetailLevel]);

  useEffect(() => {
    const nextLevel = resolveCanvasDetailLevel(persistedViewport.zoom);
    if (canvasDetailLevelRef.current === nextLevel) { return; }
    canvasDetailLevelRef.current = nextLevel;
    setCanvasDetailLevel(nextLevel);
  }, [persistedViewport.zoom, setCanvasDetailLevel]);

  const requestEdgeDeleteConfirm = useCallback((edgeIds: string[]) => {
    const normalizedIds = edgeIds.filter(id => !id.startsWith('syn-'));
    if (normalizedIds.length === 0) { return; }
    requestDeleteConfirm({
      title: normalizedIds.length > 1 ? '确认删除连接线' : '确认删除连接线',
      message: normalizedIds.length > 1
        ? `确认删除这 ${normalizedIds.length} 条连接线？`
        : `确认删除连接线“${normalizedIds[0]}”？`,
      confirmLabel: normalizedIds.length > 1 ? '删除连接线' : '删除连接线',
      onConfirm: () => {
        onEdgesChange(normalizedIds.map(id => ({ type: 'remove' as const, id })));
        setEdgeContextMenu(null);
      },
    });
  }, [onEdgesChange, requestDeleteConfirm]);

  useEffect(() => {
    if (!canvasFile) { return; }
    const target = canvasFile.viewport ?? { x: 0, y: 0, zoom: 1 };
    const signature = `${target.x}:${target.y}:${target.zoom}`;
    const live = getViewport();
    const alreadyAtTarget =
      Math.abs(live.x - target.x) < 0.5 &&
      Math.abs(live.y - target.y) < 0.5 &&
      Math.abs(live.zoom - target.zoom) < 0.001;

    if (lastAppliedViewportRef.current === signature) {
      return;
    }
    if (alreadyAtTarget) {
      lastAppliedViewportRef.current = signature;
      return;
    }

    const raf = window.requestAnimationFrame(() => {
      const current = getViewport();
      const stillNeedsApply =
        Math.abs(current.x - target.x) >= 0.5 ||
        Math.abs(current.y - target.y) >= 0.5 ||
        Math.abs(current.zoom - target.zoom) >= 0.001;

      if (stillNeedsApply) {
        void setViewport(target, { duration: 0 });
      }
      lastAppliedViewportRef.current = signature;
    });

    return () => window.cancelAnimationFrame(raf);
  }, [
    canvasFile,
    canvasFile?.viewport?.x,
    canvasFile?.viewport?.y,
    canvasFile?.viewport?.zoom,
    getViewport,
    setViewport,
  ]);

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

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) { return false; }
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) { return; }
      if (e.key !== 'Delete' && e.key !== 'Backspace') { return; }
      if (isEditableTarget(e.target)) { return; }
      if (deleteConfirm) { return; }

      const selectedEdgeIds = edges
        .filter(edge => edge.selected && !edge.id.startsWith('syn-'))
        .map(edge => edge.id);
      const selectedCount = selectedNodeIds.length + selectedEdgeIds.length;
      if (selectedCount === 0) { return; }

      e.preventDefault();
      const nodeIds = [...selectedNodeIds];
      requestDeleteConfirm({
        title: '确认删除所选内容',
        message: selectedEdgeIds.length > 0 && nodeIds.length > 0
          ? `确认删除已选中的 ${nodeIds.length} 个节点和 ${selectedEdgeIds.length} 条连接线？`
          : nodeIds.length > 0
            ? `确认删除已选中的 ${nodeIds.length} 个节点？`
            : `确认删除已选中的 ${selectedEdgeIds.length} 条连接线？`,
        confirmLabel: '删除所选内容',
        onConfirm: () => {
          if (selectedEdgeIds.length > 0) {
            onEdgesChange(selectedEdgeIds.map(id => ({ type: 'remove' as const, id })));
          }
          if (nodeIds.length > 0) {
            const dangling = edges
              .filter(edge =>
                !edge.id.startsWith('syn-') &&
                (nodeIds.includes(edge.source) || nodeIds.includes(edge.target))
              )
              .map(edge => ({ type: 'remove' as const, id: edge.id }));
            if (dangling.length > 0) { onEdgesChange(dangling); }
            onNodesChange(nodeIds.map(id => ({ type: 'remove' as const, id })));
          }
        },
      });
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteConfirm, edges, onEdgesChange, onNodesChange, requestDeleteConfirm, selectedNodeIds]);

  // Search focus jump: fit to current match
  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0 || searchIndex < 0) { return; }
    const nodeId = searchMatches[searchIndex];
    const matchedNode = nodes.find(node => node.id === nodeId);
    if (
      matchedNode?.hidden &&
      matchedNode.data.node_type === 'blueprint' &&
      matchedNode.data.meta?.blueprint_instance_id
    ) {
      const instanceId = matchedNode.data.meta.blueprint_instance_id;
      const visibleMemberIds = nodes
        .filter(node =>
          !node.hidden &&
          node.id !== nodeId &&
          (
            node.data.meta?.blueprint_instance_id === instanceId ||
            node.data.meta?.blueprint_bound_instance_id === instanceId
          )
        )
        .map(node => ({ id: node.id }));
      if (visibleMemberIds.length > 0) {
        fitView({ nodes: visibleMemberIds, padding: 0.3, duration: 220 });
        return;
      }
    }
    fitView({ nodes: [{ id: nodeId }], padding: 0.3, duration: 220 });
  }, [searchOpen, searchMatches, searchIndex, fitView, nodes]);

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
          const hidden = !!n.hidden || collapsedNodeIds.has(n.id);
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
      <div
        className={`rs-canvas rs-canvas-lod-${canvasDetailLevel}`}
        style={{ flex: 1, position: 'relative' }}
        ref={reactFlowWrapper}
        onDragLeave={handleDragLeave}
      >
        <ReactFlow
          nodes={displayNodes}
          edges={allEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
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
          defaultViewport={persistedViewport}
          minZoom={0.05}
          maxZoom={4}
          fitView={!hasPersistedViewport}
          onlyRenderVisibleElements
          onMove={handleMove}
          onMoveEnd={handleMoveEnd}
          deleteKeyCode={null}
          style={{ background: 'var(--vscode-editor-background)' }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="var(--vscode-editorIndentGuide-background)"
            size={1.5}
            gap={20}
          />
          {canvasDetailLevel === 'full' && (
            <MiniMap
              pannable
              zoomable
              style={{
                background: 'var(--vscode-sideBar-background)',
                border: '1px solid var(--vscode-panel-border)',
              }}
              nodeColor="var(--vscode-badge-background)"
            />
          )}
          <BoardOverlays />
          <BlueprintOverlays />
          {edgeContextMenu && (
            <EdgeContextMenu
              edgeId={edgeContextMenu.edgeId}
              x={edgeContextMenu.x}
              y={edgeContextMenu.y}
              onDelete={() => {
                requestEdgeDeleteConfirm([edgeContextMenu.edgeId]);
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
        {deleteConfirm && (
          <DeleteConfirmDialog
            title={deleteConfirm.title}
            message={deleteConfirm.message}
            confirmLabel={deleteConfirm.confirmLabel}
            onCancel={clearDeleteConfirm}
            onConfirm={() => {
              const action = deleteConfirm.onConfirm;
              clearDeleteConfirm();
              action();
            }}
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

function DeleteConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel, onConfirm]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100120,
        background: 'rgba(0,0,0,0.36)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={event => event.stopPropagation()}
        style={{
          width: 'min(420px, calc(100vw - 32px))',
          borderRadius: 10,
          border: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-editor-background)',
          boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vscode-foreground)' }}>{title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--vscode-descriptionForeground, var(--vscode-foreground))' }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border))',
              background: 'var(--vscode-button-secondaryBackground, transparent)',
              color: 'var(--vscode-button-secondaryForeground, var(--vscode-foreground))',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid transparent',
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              cursor: 'pointer',
            }}
          >
            {confirmLabel ?? '确认删除'}
          </button>
        </div>
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
