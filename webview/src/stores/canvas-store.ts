import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import type {
  CanvasFile,
  CanvasNode,
  CanvasEdge,
  FnStatus,
  AiTool,
  ModelInfo,
  SettingsSnapshot,
  JsonToolDef,
  DataNodeDef,
  ParamDef,
  Board,
} from '../../../src/core/canvas-model';
import { postMessage } from '../bridge';
import { usePetStore } from './pet-store';

// ── ReactFlow node/edge shapes ──────────────────────────────────────────────
export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: CanvasNode;
  style?: React.CSSProperties;
  selected?: boolean;
  hidden?: boolean;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  data?: { edge_type: CanvasEdge['edge_type']; label?: string; synthetic?: boolean; role?: string };
  animated?: boolean;
  hidden?: boolean;
}

// ── Store state ─────────────────────────────────────────────────────────────
interface PendingConnection {
  connection: Connection;
  sourceNode: CanvasNode;
  targetNode: CanvasNode;
  targetToolDef: JsonToolDef;
}

interface CanvasState {
  canvasFile: CanvasFile | null;
  workspaceRoot: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  syntheticEdges: FlowEdge[];
  imageUriMap: Record<string, string>;
  aiOutput: string;
  aiOutputRunId: string;
  aiOutputNodeTitle: string;
  aiPanelOpen: boolean;
  aiToolsPanelOpen: boolean;
  lastError: string;
  modelCache: Record<string, ModelInfo[]>;
  stagingNodes: CanvasNode[];
  settings: SettingsSnapshot | null;
  settingsPanelOpen: boolean;
  toolDefs: JsonToolDef[];
  nodeDefs: DataNodeDef[];
  pendingConnection: PendingConnection | null;
  outputHistory: { nodeId: string; entries: import('../../../src/core/canvas-model').OutputHistoryEntry[] } | null;
  boards: Board[];
  activeBoardId: string | null;
  boardDropdownOpen: boolean;
  selectedNodeIds: string[];
  selectionMode: boolean;
  undoStack: CanvasFile[];
  redoStack: CanvasFile[];
  fullContentCache: Record<string, string>;
  previewNodeId: string | null;

  initCanvas(data: CanvasFile, workspaceRoot: string): void;
  onNodesChange(changes: NodeChange[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(connection: Connection): void;
  confirmConnection(role: string | undefined): void;
  _createEdge(connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }, role: string | undefined): void;
  cancelConnection(): void;
  updateNodeStatus(nodeId: string, status: FnStatus, progressText?: string): void;
  updateBpChildStatus(bpId: string, childId: string, status: FnStatus): void;
  appendAiChunk(runId: string, chunk: string, title?: string): void;
  finishAiRun(runId: string, node: CanvasNode, edge: CanvasEdge): void;
  setImageUri(filePath: string, uri: string): void;
  addNode(node: CanvasNode): void;
  setNodeFileMissing(nodeId: string, missing: boolean): void;
  updateNodeFilePath(nodeId: string, newFilePath: string, newTitle: string): void;
  updateNodePreview(nodeId: string, preview: string): void;
  setFullContent(nodeId: string, content: string): void;
  addToStaging(nodes: CanvasNode[]): void;
  removeFromStaging(nodeId: string): void;
  commitStagingNode(nodeId: string, position: { x: number; y: number }): void;
  createFunctionNode(tool: AiTool | string, position: { x: number; y: number }): void;
  createDataNode(nodeType: 'experiment_log' | 'task', position: { x: number; y: number }): void;
  updateNodeParamValue(nodeId: string, key: string, value: unknown): void;
  updateNodeMeta(nodeId: string, patch: Partial<import('../../../src/core/canvas-model').NodeMeta>): void;
  updateNodeSize(nodeId: string, width: number, height: number): void;
  updateInputOrder(nodeId: string, order: string[]): void;
  duplicateNode(nodeId: string): void;
  setAiPanelOpen(open: boolean): void;
  setAiToolsPanelOpen(open: boolean): void;
  setError(message: string): void;
  clearError(): void;
  setModelCache(provider: string, models: ModelInfo[]): void;
  setSettings(s: SettingsSnapshot): void;
  setSettingsPanelOpen(open: boolean): void;
  setToolDefs(defs: JsonToolDef[]): void;
  setNodeDefs(defs: DataNodeDef[]): void;
  setOutputHistory(data: { nodeId: string; entries: import('../../../src/core/canvas-model').OutputHistoryEntry[] } | null): void;
  setSelectedNodeIds(ids: string[]): void;
  setSelectionMode(on: boolean): void;
  // ── Board methods ──
  createBoard(board: Board): void;
  deleteBoard(boardId: string): void;
  moveBoard(boardId: string, dx: number, dy: number): void;
  resizeBoard(boardId: string, newBounds: Board['bounds']): void;
  updateBoard(boardId: string, updates: Partial<Board>): void;
  setActiveBoardId(id: string | null): void;
  setBoardDropdownOpen(open: boolean): void;
  addBoardToStaging(name: string, color: string, borderColor: string): void;
  openPreview(nodeId: string): void;
  closePreview(): void;
  pushUndo(): void;
  undo(): void;
  redo(): void;
}

// ── Debounce save ───────────────────────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function debouncedSave(file: CanvasFile | null) {
  if (!file) { return; }
  if (saveTimer) { clearTimeout(saveTimer); }
  saveTimer = setTimeout(() => {
    postMessage({ type: 'canvasChanged', data: file });
  }, 500);
}

// ── Undo/redo helpers ───────────────────────────────────────────────────────
const MAX_UNDO = 50;
let _dragUndoPushed = false;

// ── Conversion helpers ──────────────────────────────────────────────────────

function canvasToFlow(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): { flowNodes: FlowNode[]; flowEdges: FlowEdge[] } {
  const flowNodes: FlowNode[] = nodes
    .filter(n => n && n.id && n.position && n.size)
    .map(n => {
      // Sanitize size: cap at reasonable bounds, use defaults if out of range
      const w = (n.size.width >= 120 && n.size.width <= 800) ? n.size.width : 280;
      const h = (n.size.height >= 50 && n.size.height <= 1200) ? n.size.height : 160;
      const base: FlowNode = {
        id: n.id,
        type: nodeTypeToFlowType(n.node_type),
        position: { x: n.position.x ?? 0, y: n.position.y ?? 0 },
        data: n,
        // Provide explicit width/height for NodeResizer support
        width: w,
        height: h,
      };
      return base;
    });

  const flowEdges: FlowEdge[] = edges
    .filter(e => e && e.id && e.source && e.target)
    .map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'custom',
      data: { edge_type: e.edge_type, label: e.label, role: e.role },
      animated: e.edge_type === 'ai_generated',
    }));

  return { flowNodes, flowEdges };
}

function nodeTypeToFlowType(t: CanvasNode['node_type']): string {
  if (t === 'function') { return 'functionNode'; }
  return 'dataNode';
}

function flowToCanvas(
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  _existingNodes?: CanvasNode[]
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = flowNodes.map(fn => ({
    ...fn.data,
    position: fn.position,
  }));

  const edges: CanvasEdge[] = flowEdges
    .filter(fe => !fe.data?.synthetic)
    .map(fe => ({
      id: fe.id,
      source: fe.source,
      target: fe.target,
      sourceHandle: fe.sourceHandle,
      targetHandle: fe.targetHandle,
      edge_type: fe.data?.edge_type ?? 'reference',
      label: fe.data?.label,
      role: fe.data?.role,
    }));

  return { nodes, edges };
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useCanvasStore = create<CanvasState>((set, get) => ({
  canvasFile: null,
  workspaceRoot: '',
  nodes: [],
  edges: [],
  syntheticEdges: [],
  imageUriMap: {},
  aiOutput: '',
  aiOutputRunId: '',
  aiOutputNodeTitle: '',
  aiPanelOpen: false,
  aiToolsPanelOpen: false,
  lastError: '',
  modelCache: {},
  stagingNodes: [],
  settings: null,
  settingsPanelOpen: false,
  toolDefs: [],
  nodeDefs: [],
  pendingConnection: null,
  outputHistory: null,
  boards: [],
  activeBoardId: null,
  boardDropdownOpen: false,
  selectedNodeIds: [],
  selectionMode: false,
  undoStack: [],
  redoStack: [],
  fullContentCache: {},
  previewNodeId: null,

  initCanvas(data, workspaceRoot) {
    const { flowNodes, flowEdges } = canvasToFlow(data.nodes ?? [], data.edges ?? []);

    // Migrate legacy summaryGroups → boards
    let boards = data.boards ?? [];
    if (boards.length === 0 && data.summaryGroups?.length) {
      boards = data.summaryGroups.map(g => ({
        id: g.id,
        name: g.name,
        borderColor: g.color || '#4fc3f7',
        color: hexToRgba(g.color || '#4fc3f7', 0.12),
        bounds: g.bounds,
      }));
    }

    for (const n of data.nodes ?? []) {
      if ((n.node_type === 'image' && n.meta?.display_mode !== 'mermaid' || n.node_type === 'video' || n.node_type === 'audio' || n.node_type === 'paper') && n.file_path) {
        postMessage({ type: 'requestImageUri', filePath: n.file_path });
      }
    }

    set({
      canvasFile: { ...data, boards, summaryGroups: undefined },
      workspaceRoot,
      nodes: flowNodes,
      edges: flowEdges,
      syntheticEdges: [],
      stagingNodes: data.stagingNodes ?? [],
      boards,
      aiOutput: '',
      aiOutputRunId: '',
      fullContentCache: {},
    });
  },

  onNodesChange(changes) {
    // Undo: snapshot before node deletion
    const hasRemove = changes.some(c => c.type === 'remove');
    if (hasRemove) {
      get().pushUndo();
      try { usePetStore.getState().notifyCanvasEvent('nodeDeleted'); } catch { /* pet may not be initialized */ }
    }

    // Undo: snapshot once at drag start
    const isDragging = changes.some(
      c => c.type === 'position' && (c as { dragging?: boolean }).dragging === true
    );
    if (isDragging && !_dragUndoPushed) {
      get().pushUndo();
      _dragUndoPushed = true;
    }
    const dragEnded = changes.some(
      c => c.type === 'position' && (c as { dragging?: boolean }).dragging === false
    );
    if (dragEnded && _dragUndoPushed) {
      _dragUndoPushed = false;
    }

    set(state => {
      if (!state.canvasFile) { return {}; }
      const updated = applyNodeChanges(changes, state.nodes) as FlowNode[];
      const { nodes, edges } = flowToCanvas(updated, state.edges);

      // Clean up fullContentCache for deleted nodes
      let newCache = state.fullContentCache;
      if (hasRemove) {
        const updatedIds = new Set(updated.map(n => n.id));
        const staleIds = Object.keys(state.fullContentCache).filter(id => !updatedIds.has(id));
        if (staleIds.length > 0) {
          newCache = { ...state.fullContentCache };
          for (const id of staleIds) { delete newCache[id]; }
        }
      }

      const newFile: CanvasFile = { ...state.canvasFile, nodes, edges };

      if (!isDragging) {
        debouncedSave(newFile);
      }

      return { nodes: updated, canvasFile: newFile, fullContentCache: newCache };
    });
  },

  onEdgesChange(changes) {
    const hasRemove = changes.some(c => c.type === 'remove');
    if (hasRemove) { get().pushUndo(); }
    set(state => {
      if (!state.canvasFile) { return {}; }
      const updated = applyEdgeChanges(changes, state.edges) as FlowEdge[];
      const { nodes, edges } = flowToCanvas(state.nodes, updated);
      const newFile: CanvasFile = { ...state.canvasFile, nodes, edges };
      debouncedSave(newFile);
      return { edges: updated, canvasFile: newFile };
    });
  },

  onConnect(connection) {
    const state = get();
    if (!state.canvasFile) { return; }

    // Determine source and target node types
    const sourceNode = state.canvasFile.nodes.find(n => n.id === connection.source);
    const targetNode = state.canvasFile.nodes.find(n => n.id === connection.target);

    // Only trigger role picker for data node → function node connections WITH slots
    const isDataToFunction =
      sourceNode && targetNode &&
      sourceNode.node_type !== 'function' &&
      targetNode.node_type === 'function';

    if (isDataToFunction && sourceNode && targetNode) {
      const toolId = targetNode.meta?.ai_tool as string | undefined;
      const targetToolDef = toolId ? state.toolDefs.find(d => d.id === toolId) : undefined;
      const hasSlots = (targetToolDef?.slots?.length ?? 0) > 0;

      if (hasSlots && targetToolDef) {
        // Show role picker dialog — confirmConnection will be called after user picks
        set({ pendingConnection: { connection, sourceNode, targetNode, targetToolDef } });
        return;
      }
    }

    // No role picker needed — create edge immediately (no slot role)
    get()._createEdge(connection, undefined);
  },

  confirmConnection(role) {
    const state = get();
    const connection = state.pendingConnection?.connection ?? null;
    if (!connection) {
      set({ pendingConnection: null });
      return;
    }
    get()._createEdge(connection, role);
    set({ pendingConnection: null });
  },

  _createEdge(connection, role) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const newEdge: FlowEdge = {
        id: uuid(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        type: 'custom',
        data: { edge_type: 'data_flow', role },
      };
      const updated = [...state.edges, newEdge];
      const { nodes, edges } = flowToCanvas(state.nodes, updated);
      const newFile: CanvasFile = { ...state.canvasFile, nodes, edges };
      debouncedSave(newFile);
      return { edges: updated, canvasFile: newFile };
    });
  },

  cancelConnection() {
    set({ pendingConnection: null });
  },

  updateNodeStatus(nodeId, status, progressText) {
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, meta: { ...n.data.meta, fn_status: status, fn_progress: progressText } } }
          : n
      ),
    }));
  },

  appendAiChunk(runId, chunk, title) {
    set(state => ({
      aiOutputRunId: runId,
      aiOutput: state.aiOutputRunId === runId ? state.aiOutput + chunk : chunk,
      aiOutputNodeTitle: title ?? state.aiOutputNodeTitle,
      aiPanelOpen: true,
    }));
  },

  finishAiRun(runId, node, edge) {
    if (!node?.id || !node?.position || !node?.size) {
      console.error('[RS] finishAiRun: invalid node', node);
      return;
    }
    if (!edge?.id || !edge?.source || !edge?.target) {
      console.error('[RS] finishAiRun: invalid edge', edge);
      return;
    }

    set(state => {
      if (!state.canvasFile) { return {}; }
      if (state.nodes.some(n => n.id === node.id)) { return {}; }

      const newFlowNode: FlowNode = {
        id: node.id,
        type: nodeTypeToFlowType(node.node_type),
        position: node.position,
        data: node,
        width: node.size.width,
        height: node.size.height,
      };
      const newFlowEdge: FlowEdge = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'custom',
        data: { edge_type: edge.edge_type },
        animated: edge.edge_type === 'ai_generated',
      };

      const updatedNodes = [...state.nodes, newFlowNode];
      const updatedEdges = [...state.edges, newFlowEdge];
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, updatedEdges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };

      if ((node.node_type === 'image' && node.meta?.display_mode !== 'mermaid' || node.node_type === 'video' || node.node_type === 'audio' || node.node_type === 'paper') && node.file_path) {
        postMessage({ type: 'requestImageUri', filePath: node.file_path });
      }

      debouncedSave(newFile);
      return { nodes: updatedNodes, edges: updatedEdges, canvasFile: newFile, aiOutputRunId: runId };
    });
  },

  setImageUri(filePath, uri) {
    set(state => ({ imageUriMap: { ...state.imageUriMap, [filePath]: uri } }));
  },

  addNode(node) {
    if (!node?.id || !node?.position || !node?.size) {
      console.error('[RS] addNode: invalid node', node);
      return;
    }

    set(state => {
      if (!state.canvasFile) { return {}; }
      if (state.nodes.some(n => n.id === node.id)) { return {}; }

      const flowNode: FlowNode = {
        id: node.id,
        type: nodeTypeToFlowType(node.node_type),
        position: { x: node.position.x ?? 0, y: node.position.y ?? 0 },
        data: node,
        width: node.size.width,
        height: node.size.height,
      };
      const updatedNodes = [...state.nodes, flowNode];
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };

      if ((node.node_type === 'image' && node.meta?.display_mode !== 'mermaid' || node.node_type === 'video' || node.node_type === 'audio' || node.node_type === 'paper') && node.file_path) {
        postMessage({ type: 'requestImageUri', filePath: node.file_path });
      }

      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  setNodeFileMissing(nodeId, missing) {
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, meta: { ...n.data.meta, file_missing: missing } } }
          : n
      ),
    }));
  },

  updateNodeFilePath(nodeId, newFilePath, newTitle) {
    set(state => {
      const nodes = state.nodes.map(n =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                title: newTitle,
                file_path: newFilePath,
                meta: { ...n.data.meta, file_missing: false },
              },
            }
          : n
      );
      const canvasFile = state.canvasFile
        ? {
            ...state.canvasFile,
            nodes: state.canvasFile.nodes.map(cn =>
              cn.id === nodeId
                ? { ...cn, title: newTitle, file_path: newFilePath, meta: { ...cn.meta, file_missing: false } }
                : cn
            ),
          }
        : state.canvasFile;
      return { nodes, canvasFile };
    });
  },

  updateNodePreview(nodeId, preview) {
    set(state => {
      // Invalidate fullContentCache so lazy-load re-fetches fresh content
      const newCache = { ...state.fullContentCache };
      delete newCache[nodeId];
      return {
        nodes: state.nodes.map(n =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, meta: { ...n.data.meta, content_preview: preview, file_missing: false } } }
            : n
        ),
        fullContentCache: newCache,
      };
    });
  },

  setFullContent(nodeId, content) {
    // Don't cache empty content — let content_preview show instead
    if (!content) { return; }
    set(state => ({
      fullContentCache: { ...state.fullContentCache, [nodeId]: content },
    }));
  },

  addToStaging(nodes) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const existingIds = new Set(state.stagingNodes.map(n => n.id));
      const toAdd = nodes.filter(n => n?.id && !existingIds.has(n.id));
      if (toAdd.length === 0) { return {}; }
      const stagingNodes = [...state.stagingNodes, ...toAdd];
      const newFile: CanvasFile = { ...state.canvasFile, stagingNodes };
      debouncedSave(newFile);
      return { stagingNodes, canvasFile: newFile };
    });
  },

  removeFromStaging(nodeId) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const removed = state.stagingNodes.find(n => n.id === nodeId);
      // If removing a note that has a file path, delete the file too
      if (removed?.node_type === 'note' && removed.file_path) {
        postMessage({ type: 'deleteNote', filePath: removed.file_path });
      }
      const stagingNodes = state.stagingNodes.filter(n => n.id !== nodeId);
      const newFile: CanvasFile = { ...state.canvasFile, stagingNodes };
      debouncedSave(newFile);
      return { stagingNodes, canvasFile: newFile };
    });
  },

  commitStagingNode(nodeId, position) {
    get().pushUndo();
    set(state => {
      const node = state.stagingNodes.find(n => n.id === nodeId);
      if (!node || !state.canvasFile) { return {}; }

      const remainingStaging = state.stagingNodes.filter(n => n.id !== nodeId);

      // Board staging node → create Board instead of FlowNode
      if ((node.node_type as string) === 'board') {
        const board: Board = {
          id: node.id,
          name: node.title,
          color: (node.meta?.boardColor as string) || 'rgba(79,195,247,0.12)',
          borderColor: (node.meta?.boardBorderColor as string) || '#4fc3f7',
          bounds: { x: position.x, y: position.y, width: node.size.width, height: node.size.height },
        };
        const newBoards = [...state.boards, board];
        const newFile: CanvasFile = { ...state.canvasFile, boards: newBoards, stagingNodes: remainingStaging };
        debouncedSave(newFile);
        return { boards: newBoards, canvasFile: newFile, stagingNodes: remainingStaging };
      }

      const placed: CanvasNode = { ...node, position };
      const flowNode: FlowNode = {
        id: placed.id,
        type: nodeTypeToFlowType(placed.node_type),
        position,
        data: placed,
        width: placed.size.width,
        height: placed.size.height,
      };
      const updatedNodes = [...state.nodes, flowNode];
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = {
        ...state.canvasFile,
        nodes: cnNodes,
        edges: cnEdges,
        stagingNodes: remainingStaging,
      };

      if ((placed.node_type === 'image' && placed.meta?.display_mode !== 'mermaid' || placed.node_type === 'video' || placed.node_type === 'audio' || placed.node_type === 'paper') && placed.file_path) {
        postMessage({ type: 'requestImageUri', filePath: placed.file_path });
      }

      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile, stagingNodes: remainingStaging };
    });
  },

  createFunctionNode(tool, position) {
    get().pushUndo();
    const toolDefs = get().toolDefs;
    const toolDef = toolDefs.find(d => d.id === tool);
    const toolParams = toolDef?.params ?? [];
    const toolName = toolDef?.name ?? String(tool);

    const settings = get().settings;
    const { provider, model } = resolveDefaultsFromSettings(settings);
    const defaultParamValues: Record<string, unknown> = { _provider: provider, _model: model };
    for (const p of toolParams) {
      if (p.default !== undefined) { defaultParamValues[p.name] = p.default; }
    }
    const node: CanvasNode = {
      id: uuid(),
      node_type: 'function',
      title: toolName,
      position,
      size: { width: 280, height: 180 },
      meta: {
        ai_tool: tool as AiTool,
        fn_status: 'idle',
        input_schema: toolParams,
        param_values: defaultParamValues,
      },
    };
    set(state => {
      if (!state.canvasFile) { return {}; }
      if (state.nodes.some(n => n.id === node.id)) { return {}; }
      const flowNode: FlowNode = {
        id: node.id,
        type: 'functionNode',
        position: node.position,
        data: node,
        width: node.size.width,
        height: node.size.height,
      };
      const updatedNodes = [...state.nodes, flowNode];
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  createDataNode(nodeType, position) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const labelMap: Record<string, string> = { experiment_log: '实验记录', task: '任务清单' };
      const sizeMap: Record<string, { width: number; height: number }> = {
        experiment_log: { width: 320, height: 300 },
        task: { width: 300, height: 240 },
      };
      const defaultMeta: Record<string, object> = {
        experiment_log: { experiment_status: 'running', experiment_date: new Date().toISOString().slice(0, 10) },
        task: { task_items: [] },
      };
      const node: CanvasNode = {
        id: uuid(),
        node_type: nodeType as CanvasNode['node_type'],
        title: labelMap[nodeType] ?? nodeType,
        position,
        size: sizeMap[nodeType] ?? { width: 280, height: 180 },
        meta: { ...defaultMeta[nodeType] },
      };

      // If position is not given (zeros), send to staging for the user to place manually
      const useStaging = position.x === 0 && position.y === 0;
      if (useStaging) {
        const newStaging = [...state.stagingNodes, node];
        const newFile: CanvasFile = { ...state.canvasFile, stagingNodes: newStaging };
        debouncedSave(newFile);
        return { stagingNodes: newStaging, canvasFile: newFile };
      }

      const flowNode: FlowNode = {
        id: node.id,
        type: 'dataNode',
        position: node.position,
        data: node,
        width: node.size.width,
        height: node.size.height,
      };
      const updatedNodes = [...state.nodes, flowNode];
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  updateNodeParamValue(nodeId, key, value) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== nodeId) { return n; }
        const paramValues = { ...(n.data.meta?.param_values ?? {}), [key]: value };
        return { ...n, data: { ...n.data, meta: { ...n.data.meta, param_values: paramValues } } };
      });
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  updateNodeMeta(nodeId, patch) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== nodeId) { return n; }
        return { ...n, data: { ...n.data, meta: { ...n.data.meta, ...patch } } };
      });
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  updateNodeSize(nodeId, width, height) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== nodeId) { return n; }
        return { ...n, width: Math.round(width), height: Math.round(height), data: { ...n.data, size: { width: Math.round(width), height: Math.round(height) } } };
      });
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  updateInputOrder(nodeId, order) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== nodeId) { return n; }
        return { ...n, data: { ...n.data, meta: { ...n.data.meta, input_order: order } } };
      });
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  duplicateNode(nodeId) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const original = state.canvasFile.nodes.find(n => n.id === nodeId);
      if (!original) { return {}; }
      const copy: CanvasNode = {
        ...original,
        id: uuid(),
        position: { x: original.position.x + 30, y: original.position.y + 30 },
        meta: original.meta ? { ...original.meta, fn_status: 'idle', fn_progress: undefined } : undefined,
      };
      const flowNode: FlowNode = {
        id: copy.id,
        type: nodeTypeToFlowType(copy.node_type),
        position: copy.position,
        data: copy,
      };
      const updatedNodes = [...state.nodes, flowNode];
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  getUpstreamNodes(nodeId) {
    const state = get();
    if (!state.canvasFile) { return []; }
    const upstreamIds = state.canvasFile.edges
      .filter(e => e.target === nodeId && e.edge_type === 'data_flow')
      .map(e => e.source);
    const fnNode = state.canvasFile.nodes.find(n => n.id === nodeId);
    const inputOrder = fnNode?.meta?.input_order ?? [];
    const allUpstream = state.canvasFile.nodes.filter(n => upstreamIds.includes(n.id));
    // Sort by input_order, append any unordered nodes at the end
    return [
      ...inputOrder.map(id => allUpstream.find(n => n.id === id)).filter((n): n is CanvasNode => !!n),
      ...allUpstream.filter(n => !inputOrder.includes(n.id)),
    ];
  },

  setAiPanelOpen(open)      { set({ aiPanelOpen: open }); },
  setAiToolsPanelOpen(open) { set({ aiToolsPanelOpen: open }); },
  setError(message)          { set({ lastError: message }); },
  clearError()               { set({ lastError: '' }); },
  setModelCache(provider, models) {
    set(state => ({ modelCache: { ...state.modelCache, [provider]: models } }));
  },
  setSettings(s) { set({ settings: s }); },
  setSettingsPanelOpen(open) { set({ settingsPanelOpen: open }); },
  setToolDefs(defs)           { set({ toolDefs: defs }); },
  setNodeDefs(defs)           { set({ nodeDefs: defs }); },
  setOutputHistory(data)      { set({ outputHistory: data }); },

  // ── Boards (画板/工作区) ─────────────────────────────────────────────────
  setSelectedNodeIds(ids) { set({ selectedNodeIds: ids }); },
  setSelectionMode(on) { set({ selectionMode: on }); },
  setActiveBoardId(id) { set({ activeBoardId: id }); },
  setBoardDropdownOpen(open) { set({ boardDropdownOpen: open }); },

  addBoardToStaging(name, color, borderColor) {
    // Create a pseudo-node for the staging shelf
    const boardNode: CanvasNode = {
      id: uuid(),
      node_type: 'board' as CanvasNode['node_type'],
      title: name,
      position: { x: 0, y: 0 },
      size: { width: 600, height: 400 },
      meta: { boardColor: color, boardBorderColor: borderColor },
    };
    get().addToStaging([boardNode]);
  },

  createBoard(board) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const newBoards = [...state.boards, board];
      const newFile: CanvasFile = { ...state.canvasFile, boards: newBoards };
      debouncedSave(newFile);
      return { boards: newBoards, canvasFile: newFile };
    });
  },

  deleteBoard(boardId) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const newBoards = state.boards.filter(b => b.id !== boardId);
      const newFile: CanvasFile = { ...state.canvasFile, boards: newBoards };
      debouncedSave(newFile);
      return { boards: newBoards, canvasFile: newFile, activeBoardId: state.activeBoardId === boardId ? null : state.activeBoardId };
    });
  },

  moveBoard(boardId, dx, dy) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const idx = state.boards.findIndex(b => b.id === boardId);
      if (idx < 0) { return {}; }

      const board = state.boards[idx];
      // Dynamic overlap: nodes whose bbox overlaps with the board
      const overlapping = state.nodes.filter(n => {
        const nw = n.data.size?.width ?? 280;
        const nh = n.data.size?.height ?? 160;
        return rectsOverlap(
          { x: n.position.x, y: n.position.y, width: nw, height: nh },
          board.bounds
        );
      });

      const movedIds = new Set(overlapping.map(n => n.id));
      const updatedNodes = state.nodes.map(n =>
        movedIds.has(n.id)
          ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
          : n
      );

      const updatedBoard: Board = {
        ...board,
        bounds: { ...board.bounds, x: board.bounds.x + dx, y: board.bounds.y + dy },
      };
      const newBoards = [...state.boards];
      newBoards[idx] = updatedBoard;

      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges, boards: newBoards };
      debouncedSave(newFile);

      return { boards: newBoards, nodes: updatedNodes, canvasFile: newFile };
    });
  },

  resizeBoard(boardId, newBounds) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const idx = state.boards.findIndex(b => b.id === boardId);
      if (idx < 0) { return {}; }

      // Enforce minimum size
      const MIN_W = 200, MIN_H = 150;
      const clamped = {
        x: newBounds.x,
        y: newBounds.y,
        width: Math.max(newBounds.width, MIN_W),
        height: Math.max(newBounds.height, MIN_H),
      };

      const updated: Board = { ...state.boards[idx], bounds: clamped };
      const newBoards = [...state.boards];
      newBoards[idx] = updated;

      const newFile: CanvasFile = { ...state.canvasFile, boards: newBoards };
      debouncedSave(newFile);
      return { boards: newBoards, canvasFile: newFile };
    });
  },

  updateBoard(boardId, updates) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const idx = state.boards.findIndex(b => b.id === boardId);
      if (idx < 0) { return {}; }

      const updated: Board = { ...state.boards[idx], ...updates };
      const newBoards = [...state.boards];
      newBoards[idx] = updated;

      const newFile: CanvasFile = { ...state.canvasFile, boards: newBoards };
      debouncedSave(newFile);
      return { boards: newBoards, canvasFile: newFile };
    });
  },

  // ── Preview ─────────────────────────────────────────────────────────────────
  openPreview(nodeId) { set({ previewNodeId: nodeId }); },
  closePreview() { set({ previewNodeId: null }); },

  // ── Undo / Redo ────────────────────────────────────────────────────────────

  pushUndo() {
    const { canvasFile, undoStack } = get();
    if (!canvasFile) { return; }
    const snapshot = JSON.parse(JSON.stringify(canvasFile)) as CanvasFile;
    const newStack = [...undoStack, snapshot];
    if (newStack.length > MAX_UNDO) { newStack.shift(); }
    set({ undoStack: newStack, redoStack: [] });
  },

  undo() {
    const { undoStack, canvasFile } = get();
    if (undoStack.length === 0 || !canvasFile) { return; }

    const newUndoStack = [...undoStack];
    const prev = newUndoStack.pop()!;
    const currentSnapshot = JSON.parse(JSON.stringify(canvasFile)) as CanvasFile;

    const { flowNodes, flowEdges } = canvasToFlow(prev.nodes ?? [], prev.edges ?? []);
    const boards = prev.boards ?? [];

    debouncedSave(prev);
    set({
      undoStack: newUndoStack,
      redoStack: [...get().redoStack, currentSnapshot],
      canvasFile: prev,
      nodes: flowNodes,
      edges: flowEdges,
      stagingNodes: prev.stagingNodes ?? [],
      boards,
    });
  },

  redo() {
    const { redoStack, canvasFile } = get();
    if (redoStack.length === 0 || !canvasFile) { return; }

    const newRedoStack = [...redoStack];
    const next = newRedoStack.pop()!;
    const currentSnapshot = JSON.parse(JSON.stringify(canvasFile)) as CanvasFile;

    const { flowNodes, flowEdges } = canvasToFlow(next.nodes ?? [], next.edges ?? []);
    const boards = next.boards ?? [];

    debouncedSave(next);
    set({
      redoStack: newRedoStack,
      undoStack: [...get().undoStack, currentSnapshot],
      canvasFile: next,
      nodes: flowNodes,
      edges: flowEdges,
      stagingNodes: next.stagingNodes ?? [],
      boards,
    });
  },
}));

// ── Settings default resolver ───────────────────────────────────────────────

function resolveDefaultsFromSettings(settings: SettingsSnapshot | null): { provider: string; model: string } {
  if (!settings) { return { provider: 'copilot', model: '' }; }
  const p = settings.globalProvider ?? 'copilot';
  let model = '';
  if (p === 'copilot')        { model = settings.copilotModel ?? ''; }
  else if (p === 'anthropic') { model = settings.anthropicModel ?? ''; }
  else if (p === 'ollama')    { model = settings.ollamaModel ?? ''; }
  else {
    const cp = settings.customProviders?.find(c => c.id === p);
    model = cp?.defaultModel ?? '';
  }
  return { provider: p, model };
}

// ── Board helpers ───────────────────────────────────────────────────────────

interface Rect { x: number; y: number; width: number; height: number }

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Suppress unused-import warning — ParamDef is referenced for type inference in toolParams
void (0 as unknown as ParamDef);
