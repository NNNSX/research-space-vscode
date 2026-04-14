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
  SummaryGroup,
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
  summaryGroups: SummaryGroup[];
  selectedNodeIds: string[];
  showSummaryDialog: boolean;
  editingSummaryId: string | null;
  selectionMode: boolean;
  undoStack: CanvasFile[];
  redoStack: CanvasFile[];
  fullContentCache: Record<string, string>;

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
  setShowSummaryDialog(open: boolean): void;
  setEditingSummaryId(id: string | null): void;
  setSelectionMode(on: boolean): void;
  createSummary(name: string, nodeIds: string[], bounds: { x: number; y: number; width: number; height: number }, color?: string): void;
  deleteSummary(summaryId: string): void;
  moveSummary(summaryId: string, dx: number, dy: number): void;
  updateSummary(summaryId: string, updates: { name?: string; color?: string }): void;
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
  summaryGroups: [],
  selectedNodeIds: [],
  showSummaryDialog: false,
  editingSummaryId: null,
  selectionMode: false,
  undoStack: [],
  redoStack: [],
  fullContentCache: {},

  initCanvas(data, workspaceRoot) {
    const { flowNodes, flowEdges } = canvasToFlow(data.nodes ?? [], data.edges ?? []);

    const groups = data.summaryGroups ?? [];

    for (const n of data.nodes ?? []) {
      if ((n.node_type === 'image' && n.meta?.display_mode !== 'mermaid' || n.node_type === 'video' || n.node_type === 'audio' || n.node_type === 'paper') && n.file_path) {
        postMessage({ type: 'requestImageUri', filePath: n.file_path });
      }
    }

    set({
      canvasFile: data,
      workspaceRoot,
      nodes: flowNodes,
      edges: flowEdges,
      syntheticEdges: [],
      stagingNodes: data.stagingNodes ?? [],
      summaryGroups: groups,
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

      // Recompute summary group bounds if any member node moved
      const hasPositionChange = changes.some(c => c.type === 'position');
      let updatedGroups = state.summaryGroups;
      if (hasPositionChange && updatedGroups.length > 0) {
        const PAD = 30;
        updatedGroups = updatedGroups.map(g => {
          const members = updated.filter(n => g.nodeIds.includes(n.id));
          if (members.length < 2) { return g; }
          // Use actual DOM-measured node dimensions when available
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const n of members) {
            const el = document.querySelector(`[data-id="${n.id}"]`) as HTMLElement | null;
            const w = el ? el.offsetWidth : (n.data.size?.width ?? 280);
            const h = el ? el.offsetHeight : (n.data.size?.height ?? 160);
            minX = Math.min(minX, n.position.x);
            minY = Math.min(minY, n.position.y);
            maxX = Math.max(maxX, n.position.x + w);
            maxY = Math.max(maxY, n.position.y + h);
          }
          return {
            ...g,
            bounds: {
              x: minX - PAD,
              y: minY - PAD,
              width: maxX - minX + PAD * 2,
              height: maxY - minY + PAD * 2,
            },
          };
        });
      }

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

      const newFile: CanvasFile = { ...state.canvasFile, nodes, edges, summaryGroups: updatedGroups };

      if (!isDragging) {
        debouncedSave(newFile);
      }

      return { nodes: updated, canvasFile: newFile, summaryGroups: updatedGroups, fullContentCache: newCache };
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
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, meta: { ...n.data.meta, content_preview: preview, file_missing: false } } }
          : n
      ),
    }));
  },

  setFullContent(nodeId, content) {
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
      const remainingStaging = state.stagingNodes.filter(n => n.id !== nodeId);
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

  // ── Summary groups (归纳) ───────────────────────────────────────────────
  setSelectedNodeIds(ids) { set({ selectedNodeIds: ids }); },
  setShowSummaryDialog(open) { set({ showSummaryDialog: open }); },
  setEditingSummaryId(id) { set({ editingSummaryId: id }); },
  setSelectionMode(on) { set({ selectionMode: on }); },

  createSummary(name, nodeIds, bounds, color) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      if (nodeIds.length < 2) { return {}; }

      const PAD = 30;
      const group: SummaryGroup = {
        id: uuid(),
        name,
        color,
        nodeIds: [...nodeIds],
        bounds: {
          x: bounds.x - PAD,
          y: bounds.y - PAD,
          width: bounds.width + PAD * 2,
          height: bounds.height + PAD * 2,
        },
      };

      const newGroups = [...state.summaryGroups, group];
      const newFile: CanvasFile = { ...state.canvasFile, summaryGroups: newGroups };
      debouncedSave(newFile);

      return { summaryGroups: newGroups, canvasFile: newFile, showSummaryDialog: false };
    });
  },

  deleteSummary(summaryId) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }

      const newGroups = state.summaryGroups.filter(g => g.id !== summaryId);
      const newFile: CanvasFile = { ...state.canvasFile, summaryGroups: newGroups };
      debouncedSave(newFile);

      return { summaryGroups: newGroups, canvasFile: newFile };
    });
  },

  moveSummary(summaryId, dx, dy) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const idx = state.summaryGroups.findIndex(g => g.id === summaryId);
      if (idx < 0) { return {}; }

      const group = state.summaryGroups[idx];
      const memberSet = new Set(group.nodeIds);

      // Move all member nodes
      const updatedNodes = state.nodes.map(n =>
        memberSet.has(n.id)
          ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
          : n
      );

      // Move the group bounds
      const updatedGroup: SummaryGroup = {
        ...group,
        bounds: { ...group.bounds, x: group.bounds.x + dx, y: group.bounds.y + dy },
      };
      const newGroups = [...state.summaryGroups];
      newGroups[idx] = updatedGroup;

      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges, summaryGroups: newGroups };
      debouncedSave(newFile);

      return { summaryGroups: newGroups, nodes: updatedNodes, canvasFile: newFile };
    });
  },

  updateSummary(summaryId, updates) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const idx = state.summaryGroups.findIndex(g => g.id === summaryId);
      if (idx < 0) { return {}; }

      const updated: SummaryGroup = { ...state.summaryGroups[idx], ...updates };
      const newGroups = [...state.summaryGroups];
      newGroups[idx] = updated;

      const newFile: CanvasFile = { ...state.canvasFile, summaryGroups: newGroups };
      debouncedSave(newFile);

      return { summaryGroups: newGroups, canvasFile: newFile };
    });
  },

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
    const groups = prev.summaryGroups ?? [];

    debouncedSave(prev);
    set({
      undoStack: newUndoStack,
      redoStack: [...get().redoStack, currentSnapshot],
      canvasFile: prev,
      nodes: flowNodes,
      edges: flowEdges,
      stagingNodes: prev.stagingNodes ?? [],
      summaryGroups: groups,
    });
  },

  redo() {
    const { redoStack, canvasFile } = get();
    if (redoStack.length === 0 || !canvasFile) { return; }

    const newRedoStack = [...redoStack];
    const next = newRedoStack.pop()!;
    const currentSnapshot = JSON.parse(JSON.stringify(canvasFile)) as CanvasFile;

    const { flowNodes, flowEdges } = canvasToFlow(next.nodes ?? [], next.edges ?? []);
    const groups = next.summaryGroups ?? [];

    debouncedSave(next);
    set({
      redoStack: newRedoStack,
      undoStack: [...get().undoStack, currentSnapshot],
      canvasFile: next,
      nodes: flowNodes,
      edges: flowEdges,
      stagingNodes: next.stagingNodes ?? [],
      summaryGroups: groups,
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

// Suppress unused-import warning — ParamDef is referenced for type inference in toolParams
void (0 as unknown as ParamDef);
