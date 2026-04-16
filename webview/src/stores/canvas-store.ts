import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import { isDataNode, isGroupHubNodeType, isHubEdgeType } from '../../../src/core/canvas-model';
import type {
  CanvasFile,
  CanvasNode,
  CanvasEdge,
  NodeGroup,
  FnStatus,
  AiTool,
  ModelInfo,
  SettingsSnapshot,
  JsonToolDef,
  DataNodeDef,
  ParamDef,
  Board,
} from '../../../src/core/canvas-model';
import { collectExpandedInputs, getGroupByHubNodeId } from '../../../src/core/hub-utils';
import { postMessage } from '../bridge';
import { wouldCreateCycle } from '../utils/graph-utils';
import { usePetStore } from './pet-store';

// ── ReactFlow node/edge shapes ──────────────────────────────────────────────
export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: CanvasNode;
  width?: number;
  height?: number;
  zIndex?: number;
  style?: React.CSSProperties;
  selected?: boolean;
  hidden?: boolean;
  draggable?: boolean;
  selectable?: boolean;
  deletable?: boolean;
  focusable?: boolean;
  connectable?: boolean;
  dragHandle?: string;
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

// ── Pipeline UI state ─────────────────────────────────────────────────────
export type PipelineNodeStatus = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

export interface PipelineState {
  pipelineId: string;
  triggerNodeId: string;
  nodeStatuses: Record<string, PipelineNodeStatus>;
  totalNodes: number;
  completedNodes: number;
  isRunning: boolean;
  isPaused: boolean;
  currentNodeId: string | null;
  validationWarnings: Array<{ nodeId: string; message: string }>;
}

export type CanvasSaveState = 'saved' | 'pending' | 'saving' | 'error';

const INITIAL_CANVAS_LOAD_NODE_THRESHOLD = 18;
const INITIAL_CANVAS_LOAD_MIN_MS = 1200;
const INITIAL_CANVAS_LOAD_MAX_MS = 12000;

let initialCanvasLoadStartedAt = 0;
let initialCanvasLoadHideTimer: ReturnType<typeof setTimeout> | undefined;
let initialCanvasLoadSafetyTimer: ReturnType<typeof setTimeout> | undefined;
const initialCanvasLoadPendingKeys = new Set<string>();

function clearInitialCanvasLoadTimers() {
  if (initialCanvasLoadHideTimer) {
    clearTimeout(initialCanvasLoadHideTimer);
    initialCanvasLoadHideTimer = undefined;
  }
  if (initialCanvasLoadSafetyTimer) {
    clearTimeout(initialCanvasLoadSafetyTimer);
    initialCanvasLoadSafetyTimer = undefined;
  }
}

function finishInitialCanvasLoad(force = false) {
  const state = useCanvasStore.getState();
  if (!state.initialCanvasLoadActive) { return; }
  if (!force && initialCanvasLoadPendingKeys.size > 0) { return; }
  if (!force && !state.initialCanvasRenderReady) { return; }

  const remaining = INITIAL_CANVAS_LOAD_MIN_MS - (Date.now() - initialCanvasLoadStartedAt);
  if (!force && remaining > 0) {
    if (!initialCanvasLoadHideTimer) {
      initialCanvasLoadHideTimer = setTimeout(() => {
        initialCanvasLoadHideTimer = undefined;
        finishInitialCanvasLoad(true);
      }, remaining);
    }
    return;
  }

  clearInitialCanvasLoadTimers();
  initialCanvasLoadPendingKeys.clear();
  useCanvasStore.setState({
    initialCanvasLoadActive: false,
    initialCanvasLoadPending: 0,
  });
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
  _cycleErrorNodeId: string | null;
  outputHistory: { nodeId: string; entries: import('../../../src/core/canvas-model').OutputHistoryEntry[] } | null;
  boards: Board[];
  nodeGroups: NodeGroup[];
  activeBoardId: string | null;
  boardDropdownOpen: boolean;
  selectedNodeIds: string[];
  selectionMode: boolean;
  searchOpen: boolean;
  searchQuery: string;
  searchMatches: string[];
  searchIndex: number;
  undoStack: CanvasFile[];
  redoStack: CanvasFile[];
  fullContentCache: Record<string, string>;
  previewNodeId: string | null;
  pipelineState: PipelineState | null;
  saveState: CanvasSaveState;
  saveDueAt: number | null;
  lastSavedAt: number | null;
  saveError: string | null;
  initialCanvasLoadActive: boolean;
  initialCanvasLoadPending: number;
  initialCanvasRenderReady: boolean;

  initCanvas(data: CanvasFile, workspaceRoot: string): void;
  beginInitialCanvasLoad(nodeCount: number): void;
  trackInitialCanvasLoadRequest(key: string): void;
  resolveInitialCanvasLoadRequest(key: string): void;
  resolveInitialCanvasLoadRequests(keys: string[]): void;
  markInitialCanvasRenderReady(ready: boolean): void;
  onNodesChange(changes: NodeChange[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(connection: Connection): void;
  confirmConnection(role: string | undefined): void;
  _createEdge(connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }, role: string | undefined, edgeType?: CanvasEdge['edge_type']): void;
  cancelConnection(): void;
  updateNodeStatus(nodeId: string, status: FnStatus, progressText?: string): void;
  updateBpChildStatus(bpId: string, childId: string, status: FnStatus): void;
  appendAiChunk(runId: string, chunk: string, title?: string): void;
  finishAiRun(runId: string, node: CanvasNode, edge: CanvasEdge): void;
  setImageUri(filePath: string, uri: string): void;
  addNode(node: CanvasNode): void;
  setNodeFileMissing(nodeId: string, missing: boolean): void;
  updateNodeFilePath(nodeId: string, newFilePath: string, newTitle: string): void;
  updateNodePreview(nodeId: string, preview: string, metaPatch?: Partial<import('../../../src/core/canvas-model').NodeMeta>): void;
  setFullContent(nodeId: string, content: string): void;
  setFullContents(entries: Array<{ nodeId: string; content: string }>): void;
  addToStaging(nodes: CanvasNode[]): void;
  removeFromStaging(nodeId: string): void;
  commitStagingNode(nodeId: string, position: { x: number; y: number }): void;
  createFunctionNode(tool: AiTool | string, position: { x: number; y: number }): void;
  createDataNode(nodeType: 'experiment_log' | 'task', position: { x: number; y: number }): void;
  updateNodeParamValue(nodeId: string, key: string, value: unknown): void;
  updateNodeMeta(nodeId: string, patch: Partial<import('../../../src/core/canvas-model').NodeMeta>): void;
  previewNodeSize(nodeId: string, width: number, height: number): void;
  updateNodeSize(
    nodeId: string,
    width: number,
    height: number,
    metaPatch?: Partial<import('../../../src/core/canvas-model').NodeMeta>,
  ): void;
  updateInputOrder(nodeId: string, order: string[]): void;
  duplicateNode(nodeId: string): void;
  getUpstreamNodes(nodeId: string): CanvasNode[];
  hasDownstreamPipeline(nodeId: string): boolean;
  getPipelineHeadNodes(selectedIds: string[]): CanvasNode[];
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
  // ── Search methods ──
  setSearchOpen(open: boolean): void;
  setSearchQuery(query: string): void;
  nextSearchMatch(): void;
  prevSearchMatch(): void;
  // ── Node Group methods ──
  createNodeGroup(name: string, nodeIds: string[], color?: { color: string; borderColor: string }): void;
  deleteNodeGroup(groupId: string): void;
  renameNodeGroup(groupId: string, name: string): void;
  toggleNodeGroupCollapse(groupId: string): void;
  removeNodeFromGroup(groupId: string, nodeId: string): void;
  addNodeToGroup(groupId: string, nodeId: string): void;
  recalcGroupBounds(groupId: string): void;
  connectGroupToNode(groupId: string, targetNodeId: string, role?: string): void;
  connectNodeToGroup(sourceNodeId: string, groupId: string): void;
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
  // ── Pipeline state methods ──
  setPipelineState(state: PipelineState | null): void;
  updatePipelineNodeStatus(nodeId: string, status: PipelineNodeStatus): void;
  incrementPipelineCompleted(): void;
  setPipelinePaused(paused: boolean): void;
  addPipelineWarning(nodeId: string, message: string): void;
  saveNow(): void;
  runAutosaveCheck(): void;
  markSaveSuccess(savedAt?: number, requestId?: number): void;
  markSaveError(message: string, requestId?: number): void;
}

// ── Save scheduling ─────────────────────────────────────────────────────────
const AUTO_SAVE_INTERVAL_MS = 3 * 60 * 1000;
let lastPersistedSerialized = '';
let nextSaveRequestId = 0;
const inFlightSavePayloads = new Map<number, string>();
let nextAutosaveAt = Date.now() + AUTO_SAVE_INTERVAL_MS;
let pendingCanvasSyncFile: CanvasFile | null = null;
let pendingCanvasSyncTimer: ReturnType<typeof setTimeout> | undefined;

function flushCanvasStateSync() {
  pendingCanvasSyncTimer = undefined;
  const file = pendingCanvasSyncFile;
  pendingCanvasSyncFile = null;
  if (!file) { return; }
  postMessage({ type: 'canvasStateSync', data: file });
}

function syncCanvasState(file: CanvasFile | null, immediate = false) {
  if (!file) { return; }
  pendingCanvasSyncFile = file;
  if (immediate) {
    if (pendingCanvasSyncTimer) {
      clearTimeout(pendingCanvasSyncTimer);
      pendingCanvasSyncTimer = undefined;
    }
    flushCanvasStateSync();
    return;
  }
  if (pendingCanvasSyncTimer) { return; }
  pendingCanvasSyncTimer = setTimeout(() => {
    flushCanvasStateSync();
  }, 120);
}

function serializeCanvasFile(file: CanvasFile | null): string {
  return file ? JSON.stringify(file) : '';
}

function resetAutosaveWindow() {
  nextAutosaveAt = Date.now() + AUTO_SAVE_INTERVAL_MS;
}

function ensureAutosaveWindow() {
  if (nextAutosaveAt > Date.now()) { return; }
  resetAutosaveWindow();
}

function markPersistedFromExternal(file: CanvasFile) {
  lastPersistedSerialized = serializeCanvasFile(file);
  inFlightSavePayloads.clear();
}

function markCanvasDirty(fileOverride?: CanvasFile | null) {
  const state = useCanvasStore.getState();
  const file = fileOverride ?? state.canvasFile;
  const serialized = serializeCanvasFile(file);
  if (!serialized) { return; }
  if (serialized === lastPersistedSerialized && inFlightSavePayloads.size === 0) {
    useCanvasStore.setState({
      saveState: 'saved',
      saveDueAt: null,
      saveError: null,
    });
    return;
  }

  ensureAutosaveWindow();
  useCanvasStore.setState({
    saveState: 'pending',
    saveDueAt: state.settings?.autoSave ? nextAutosaveAt : null,
    saveError: null,
  });
}

function dispatchSave(mode: 'auto' | 'manual', fileOverride?: CanvasFile | null) {
  const file = fileOverride ?? useCanvasStore.getState().canvasFile;
  if (!file) { return; }
  const serialized = serializeCanvasFile(file);
  if (!serialized) { return; }
  if (serialized === lastPersistedSerialized && inFlightSavePayloads.size === 0) {
    useCanvasStore.setState({
      saveState: 'saved',
      saveDueAt: null,
      saveError: null,
    });
    return;
  }

  const requestId = ++nextSaveRequestId;
  inFlightSavePayloads.set(requestId, serialized);
  useCanvasStore.setState({
    saveState: 'saving',
    saveDueAt: null,
    saveError: null,
  });
  postMessage({
    type: mode === 'auto' ? 'canvasChanged' : 'saveCanvas',
    data: file,
    requestId,
  });
}

function debouncedSave(file: CanvasFile | null, syncMode: 'deferred' | 'immediate' = 'deferred') {
  if (!file) { return; }
  syncCanvasState(file, syncMode === 'immediate');
  markCanvasDirty(file);
}

function saveImmediately(file: CanvasFile | null) {
  if (!file) { return; }
  syncCanvasState(file, true);
  dispatchSave('manual', file);
}

// ── Undo/redo helpers ───────────────────────────────────────────────────────
const MAX_UNDO = 50;
let _dragUndoPushed = false;

// ── Board-drag membership snapshot ─────────────────────────────────────────
// Captured once at drag-start in BoardOverlay; cleared on mouseup.
// moveBoard reads this set rather than dynamically scanning for overlaps.
let _boardDragMembers = new Set<string>();

export function startBoardDrag(boardId: string, nodes: FlowNode[], boards: Board[]) {
  const board = boards.find(b => b.id === boardId);
  if (!board) { _boardDragMembers = new Set(); return; }
  // Snapshot: only nodes fully or partially inside the board right now
  _boardDragMembers = new Set(
    nodes.filter(n => {
      const nw = n.data.size?.width ?? 280;
      const nh = n.data.size?.height ?? 160;
      return rectsOverlap(
        { x: n.position.x, y: n.position.y, width: nw, height: nh },
        board.bounds
      );
    }).map(n => n.id)
  );
}

export function endBoardDrag() {
  _boardDragMembers = new Set();
}

const GROUP_PADDING = 30;
const GROUP_MIN_WIDTH = 220;
const GROUP_MIN_HEIGHT = 140;
const HUB_COLLAPSED_WIDTH = 220;
const HUB_COLLAPSED_HEIGHT = 72;

function getNodeSize(n: FlowNode): { width: number; height: number } {
  return {
    width: n.width ?? n.data.size?.width ?? 280,
    height: n.height ?? n.data.size?.height ?? 160,
  };
}

function calcGroupBounds(nodes: FlowNode[], nodeIds: string[], fallback?: NodeGroup['bounds']): NodeGroup['bounds'] {
  const idSet = new Set(nodeIds);
  const members = nodes.filter(n => idSet.has(n.id));
  if (members.length === 0) {
    return fallback ?? { x: 0, y: 0, width: GROUP_MIN_WIDTH, height: GROUP_MIN_HEIGHT };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const n of members) {
    const { width, height } = getNodeSize(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + width);
    maxY = Math.max(maxY, n.position.y + height);
  }

  const x = minX - GROUP_PADDING;
  const y = minY - GROUP_PADDING;
  const width = Math.max(maxX - minX + GROUP_PADDING * 2, GROUP_MIN_WIDTH);
  const height = Math.max(maxY - minY + GROUP_PADDING * 2, GROUP_MIN_HEIGHT);
  return { x, y, width, height };
}

function getHubDisplaySize(group: NodeGroup): { width: number; height: number } {
  return group.collapsed
    ? { width: HUB_COLLAPSED_WIDTH, height: HUB_COLLAPSED_HEIGHT }
    : { width: group.bounds.width, height: group.bounds.height };
}

function buildHubCanvasNode(group: NodeGroup): CanvasNode {
  const { width, height } = getHubDisplaySize(group);
  return {
    id: group.hubNodeId,
    node_type: 'group_hub',
    title: group.name,
    position: { x: group.bounds.x, y: group.bounds.y },
    size: { width, height },
    meta: {
      hub_group_id: group.id,
      input_order: group.nodeIds,
    },
  };
}

function syncHubFlowNode(node: FlowNode, group: NodeGroup): FlowNode {
  const hubData = buildHubCanvasNode(group);
  return {
    ...node,
    type: 'nodeGroup',
    position: hubData.position,
    data: {
      ...node.data,
      ...hubData,
      meta: { ...node.data.meta, ...hubData.meta },
    },
    width: hubData.size.width,
    height: hubData.size.height,
    zIndex: 5,
    draggable: true,
    selectable: true,
    deletable: true,
    focusable: true,
    connectable: true,
    dragHandle: '.rs-group-header',
    style: {
      ...(node.style ?? {}),
      pointerEvents: 'none',
      overflow: 'visible',
    },
  };
}

function syncGroupHubNodes(nodes: FlowNode[], nodeGroups: NodeGroup[]): FlowNode[] {
  if (nodeGroups.length === 0) { return nodes; }
  return nodes.map(node => {
    if (node.data.node_type !== 'group_hub') { return node; }
    const group = getGroupByHubNodeId(nodeGroups, node.id);
    if (!group) { return node; }
    return syncHubFlowNode(node, group);
  });
}

function recalcGroupsForNodeIds(nodeGroups: NodeGroup[], nodes: FlowNode[], nodeIds: Iterable<string>): NodeGroup[] {
  const changedIds = new Set(nodeIds);
  if (changedIds.size === 0) { return nodeGroups; }
  return nodeGroups.map(group => {
    const needRecalc = group.nodeIds.some(id => changedIds.has(id));
    return needRecalc ? { ...group, bounds: calcGroupBounds(nodes, group.nodeIds, group.bounds) } : group;
  });
}

function normalizeNodeGroups(file: CanvasFile): CanvasFile {
  const nodeGroups = file.nodeGroups ?? [];
  if (nodeGroups.length === 0) { return file; }

  const nodes = [...file.nodes];
  const edges = [...file.edges];
  const normalizedGroups = nodeGroups.map(group => {
    const hubNodeId = group.hubNodeId ?? uuid();
    const nextGroup: NodeGroup = { ...group, hubNodeId };
    const existingHub = nodes.find(node => node.id === hubNodeId && node.node_type === 'group_hub');
    const hubNode = buildHubCanvasNode(nextGroup);

    if (existingHub) {
      const idx = nodes.findIndex(node => node.id === hubNodeId);
      nodes[idx] = {
        ...existingHub,
        ...hubNode,
        meta: { ...existingHub.meta, ...hubNode.meta },
      };
    } else {
      nodes.push(hubNode);
    }

    const memberEdgeKeys = new Set(
      edges
        .filter(edge => edge.target === hubNodeId && edge.edge_type === 'hub_member')
        .map(edge => `${edge.source}|${edge.target}`)
    );

    for (const memberId of nextGroup.nodeIds) {
      const key = `${memberId}|${hubNodeId}`;
      if (memberEdgeKeys.has(key)) { continue; }
      memberEdgeKeys.add(key);
      edges.push({
        id: uuid(),
        source: memberId,
        target: hubNodeId,
        edge_type: 'hub_member',
      });
    }

    return nextGroup;
  });

  return { ...file, nodes, edges, nodeGroups: normalizedGroups };
}

function calcSearchMatches(nodes: CanvasNode[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) { return []; }
  return nodes
    .filter(n => {
      const title = n.title?.toLowerCase() ?? '';
      const preview = n.meta?.content_preview?.toLowerCase() ?? '';
      return title.includes(q) || preview.includes(q);
    })
    .map(n => n.id);
}

// ── Conversion helpers ──────────────────────────────────────────────────────

function canvasToFlow(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): { flowNodes: FlowNode[]; flowEdges: FlowEdge[] } {
  const flowNodes: FlowNode[] = nodes
    .filter(n => n && n.id && n.position && n.size)
    .map(n => {
      // Sanitize size: cap at reasonable bounds, use defaults if out of range
      const w = isGroupHubNodeType(n.node_type)
        ? Math.max(n.size.width, GROUP_MIN_WIDTH)
        : ((n.size.width >= 120 && n.size.width <= 800) ? n.size.width : 280);
      const h = isGroupHubNodeType(n.node_type)
        ? Math.max(n.size.height, GROUP_MIN_HEIGHT)
        : ((n.size.height >= 50 && n.size.height <= 1200) ? n.size.height : 160);
      const base: FlowNode = {
        id: n.id,
        type: nodeTypeToFlowType(n.node_type),
        position: { x: n.position.x ?? 0, y: n.position.y ?? 0 },
        data: n,
        // Provide explicit width/height for NodeResizer support
        width: w,
        height: h,
      };
      if (isGroupHubNodeType(n.node_type)) {
        base.zIndex = 5;
        base.draggable = true;
        base.selectable = true;
        base.deletable = true;
        base.focusable = true;
        base.connectable = true;
        base.dragHandle = '.rs-group-header';
        base.style = {
          ...(base.style ?? {}),
          pointerEvents: 'none',
          overflow: 'visible',
        };
      }
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
      type: e.edge_type === 'pipeline_flow' ? 'pipeline' : 'custom',
      data: { edge_type: e.edge_type, label: e.label, role: e.role },
      animated: e.edge_type === 'ai_generated',
      hidden: e.edge_type === 'hub_member',
    }));

  return { flowNodes, flowEdges };
}

function nodeTypeToFlowType(t: CanvasNode['node_type']): string {
  if (t === 'function') { return 'functionNode'; }
  if (t === 'group_hub') { return 'nodeGroup'; }
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
  _cycleErrorNodeId: null as string | null,
  outputHistory: null,
  boards: [],
  nodeGroups: [],
  activeBoardId: null,
  boardDropdownOpen: false,
  selectedNodeIds: [],
  selectionMode: false,
  searchOpen: false,
  searchQuery: '',
  searchMatches: [],
  searchIndex: -1,
  undoStack: [],
  redoStack: [],
  fullContentCache: {},
  previewNodeId: null,
  pipelineState: null,
  saveState: 'saved',
  saveDueAt: null,
  lastSavedAt: Date.now(),
  saveError: null,
  initialCanvasLoadActive: false,
  initialCanvasLoadPending: 0,
  initialCanvasRenderReady: true,

  beginInitialCanvasLoad(nodeCount) {
    clearInitialCanvasLoadTimers();
    initialCanvasLoadPendingKeys.clear();

    const shouldShow = nodeCount >= INITIAL_CANVAS_LOAD_NODE_THRESHOLD;
    if (!shouldShow) {
      set({
        initialCanvasLoadActive: false,
        initialCanvasLoadPending: 0,
        initialCanvasRenderReady: true,
      });
      return;
    }

    initialCanvasLoadStartedAt = Date.now();
    initialCanvasLoadSafetyTimer = setTimeout(() => {
      initialCanvasLoadSafetyTimer = undefined;
      finishInitialCanvasLoad(true);
    }, INITIAL_CANVAS_LOAD_MAX_MS);

    set({
      initialCanvasLoadActive: true,
      initialCanvasLoadPending: 0,
      initialCanvasRenderReady: false,
    });

    finishInitialCanvasLoad();
  },

  trackInitialCanvasLoadRequest(key) {
    if (!get().initialCanvasLoadActive) { return; }
    if (initialCanvasLoadPendingKeys.has(key)) { return; }
    initialCanvasLoadPendingKeys.add(key);
    set({ initialCanvasLoadPending: initialCanvasLoadPendingKeys.size });
  },

  resolveInitialCanvasLoadRequest(key) {
    if (!get().initialCanvasLoadActive) {
      return;
    }
    if (!initialCanvasLoadPendingKeys.has(key)) {
      return;
    }
    initialCanvasLoadPendingKeys.delete(key);
    set({ initialCanvasLoadPending: initialCanvasLoadPendingKeys.size });
    finishInitialCanvasLoad();
  },

  resolveInitialCanvasLoadRequests(keys) {
    if (!get().initialCanvasLoadActive || keys.length === 0) {
      return;
    }

    let changed = false;
    for (const key of keys) {
      if (!initialCanvasLoadPendingKeys.has(key)) { continue; }
      initialCanvasLoadPendingKeys.delete(key);
      changed = true;
    }

    if (!changed) {
      return;
    }

    set({ initialCanvasLoadPending: initialCanvasLoadPendingKeys.size });
    finishInitialCanvasLoad();
  },

  markInitialCanvasRenderReady(ready) {
    if (get().initialCanvasRenderReady === ready) {
      if (ready) { finishInitialCanvasLoad(); }
      return;
    }
    set({ initialCanvasRenderReady: ready });
    if (ready) {
      finishInitialCanvasLoad();
    }
  },

  initCanvas(data, workspaceRoot) {
    const normalized = normalizeNodeGroups(data);
    const nodeGroups = normalized.nodeGroups ?? [];
    resetAutosaveWindow();
    inFlightSavePayloads.clear();
    const { flowNodes, flowEdges } = canvasToFlow(normalized.nodes ?? [], normalized.edges ?? []);
    const syncedFlowNodes = syncGroupHubNodes(flowNodes, nodeGroups);
    get().beginInitialCanvasLoad(normalized.nodes?.length ?? 0);

    // Migrate legacy summaryGroups → boards
    let boards = normalized.boards ?? [];
    if (boards.length === 0 && normalized.summaryGroups?.length) {
      boards = normalized.summaryGroups.map(g => ({
        id: g.id,
        name: g.name,
        borderColor: g.color || '#4fc3f7',
        color: hexToRgba(g.color || '#4fc3f7', 0.12),
        bounds: g.bounds,
      }));
    }

    for (const n of normalized.nodes ?? []) {
      if ((n.node_type === 'image' && n.meta?.display_mode !== 'mermaid' || n.node_type === 'video' || n.node_type === 'audio' || n.node_type === 'paper') && n.file_path) {
        get().trackInitialCanvasLoadRequest(`media:${n.file_path}`);
        postMessage({ type: 'requestImageUri', filePath: n.file_path });
      }
    }

    const normalizedCanvasFile: CanvasFile = { ...normalized, boards, nodeGroups, summaryGroups: undefined };
    lastPersistedSerialized = serializeCanvasFile(normalizedCanvasFile);

    set({
      canvasFile: normalizedCanvasFile,
      workspaceRoot,
      nodes: syncedFlowNodes,
      edges: flowEdges,
      syntheticEdges: [],
      stagingNodes: normalized.stagingNodes ?? [],
      boards,
      nodeGroups,
      aiOutput: '',
      aiOutputRunId: '',
      fullContentCache: {},
      searchOpen: false,
      searchQuery: '',
      searchMatches: [],
      searchIndex: -1,
      saveState: 'saved',
      saveDueAt: null,
      lastSavedAt: Date.now(),
      saveError: null,
      initialCanvasRenderReady: normalized.nodes.length < INITIAL_CANVAS_LOAD_NODE_THRESHOLD,
    });
  },

  onNodesChange(changes) {
    // Undo: snapshot before node deletion
    const hasRemove = changes.some(c => c.type === 'remove');
    if (hasRemove) {
      get().pushUndo();
      try { usePetStore.getState().notifyCanvasEvent('nodeDeleted'); } catch { /* pet may not be initialized */ }
    }

    const stateAtStart = get();
    const expandedChanges: NodeChange[] = [];
    for (const change of changes) {
      if (change.type === 'position') {
        const group = stateAtStart.nodeGroups.find(item => item.hubNodeId === change.id);
        if (group) {
          const hubNode = stateAtStart.nodes.find(node => node.id === change.id);
          const fromPosition = hubNode?.position ?? { x: group.bounds.x, y: group.bounds.y };
          const toPosition = change.position ?? fromPosition;
          const dx = toPosition.x - fromPosition.x;
          const dy = toPosition.y - fromPosition.y;

          if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 || change.dragging !== undefined) {
            for (const memberId of group.nodeIds) {
              const memberNode = stateAtStart.nodes.find(node => node.id === memberId);
              if (!memberNode) { continue; }
              expandedChanges.push({
                ...change,
                id: memberId,
                position: {
                  x: memberNode.position.x + dx,
                  y: memberNode.position.y + dy,
                },
              });
            }
          }
          continue;
        }
      }
      expandedChanges.push(change);
    }

    // Undo: snapshot once at drag start
    const isDragging = expandedChanges.some(
      c => c.type === 'position' && (c as { dragging?: boolean }).dragging === true
    );
    if (isDragging && !_dragUndoPushed) {
      get().pushUndo();
      _dragUndoPushed = true;
    }
    const dragEnded = expandedChanges.some(
      c => c.type === 'position' && (c as { dragging?: boolean }).dragging === false
    );
    if (dragEnded && _dragUndoPushed) {
      _dragUndoPushed = false;
    }

    set(state => {
      if (!state.canvasFile) { return {}; }
      const updated = applyNodeChanges(expandedChanges, state.nodes) as FlowNode[];

      const removedIds = new Set(
        expandedChanges.filter(c => c.type === 'remove').map(c => c.id)
      );
      const movedIds = new Set(
        expandedChanges.filter(c => c.type === 'position').map(c => c.id)
      );

      let nodeGroups = state.nodeGroups;
      if (removedIds.size > 0) {
        nodeGroups = nodeGroups
          .map(g => {
            if (removedIds.has(g.hubNodeId)) { return null; }
            return { ...g, nodeIds: g.nodeIds.filter(id => !removedIds.has(id)) };
          })
          .filter((g): g is NodeGroup => !!g && g.nodeIds.length > 0);
      }
      if (movedIds.size > 0) {
        nodeGroups = recalcGroupsForNodeIds(nodeGroups, updated, movedIds);
      }

      const activeHubIds = new Set(nodeGroups.map(group => group.hubNodeId));
      const prunedNodes = updated.filter(node => !isGroupHubNodeType(node.data.node_type) || activeHubIds.has(node.id));
      const prunedEdges = state.edges.filter(edge => {
        if (isHubEdgeType(edge.data?.edge_type)) {
          return activeHubIds.has(edge.target);
        }
        const sourceExists = prunedNodes.some(node => node.id === edge.source);
        const targetExists = prunedNodes.some(node => node.id === edge.target);
        return sourceExists && targetExists;
      });
      const syncedNodes = syncGroupHubNodes(prunedNodes, nodeGroups);

      // Clean up fullContentCache for deleted nodes
      let newCache = state.fullContentCache;
      if (hasRemove) {
        const updatedIds = new Set(syncedNodes.map(n => n.id));
        const staleIds = Object.keys(state.fullContentCache).filter(id => !updatedIds.has(id));
        if (staleIds.length > 0) {
          newCache = { ...state.fullContentCache };
          for (const id of staleIds) { delete newCache[id]; }
        }
      }

      const { nodes: syncedCanvasNodes, edges: syncedCanvasEdges } = flowToCanvas(syncedNodes, prunedEdges);
      const searchMatches = state.searchQuery
        ? calcSearchMatches(syncedCanvasNodes, state.searchQuery)
        : [];
      const searchIndex = searchMatches.length === 0
        ? -1
        : Math.min(Math.max(state.searchIndex, 0), searchMatches.length - 1);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: syncedCanvasNodes, edges: syncedCanvasEdges, nodeGroups };

      if (!isDragging || dragEnded) {
        debouncedSave(newFile);
      }

      return {
        nodes: syncedNodes,
        edges: prunedEdges,
        canvasFile: newFile,
        fullContentCache: newCache,
        nodeGroups,
        selectedNodeIds: state.selectedNodeIds.filter(id => !removedIds.has(id)),
        searchMatches,
        searchIndex,
      };
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

    // v2.0: Function → Function = pipeline_flow (with cycle detection)
    const isFnToFn =
      sourceNode && targetNode &&
      sourceNode.node_type === 'function' &&
      targetNode.node_type === 'function';

    if (isFnToFn) {
      // Cycle detection
      if (wouldCreateCycle(state.canvasFile.edges, connection.source, connection.target)) {
        // Shake the target node briefly to indicate error
        set({ _cycleErrorNodeId: connection.target });
        setTimeout(() => set({ _cycleErrorNodeId: null }), 600);
        return;
      }
      get()._createEdge(connection, undefined, 'pipeline_flow');
      return;
    }

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

  connectGroupToNode(groupId, targetNodeId, role) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const group = state.nodeGroups.find(g => g.id === groupId);
      if (!group) { return {}; }

      const targetNode = state.canvasFile.nodes.find(n => n.id === targetNodeId);
      if (!targetNode || targetNode.node_type !== 'function') { return {}; }
      const exists = state.edges.some(
        edge =>
          edge.source === group.hubNodeId &&
          edge.target === targetNodeId &&
          edge.data?.edge_type === 'data_flow' &&
          (edge.data?.role ?? '') === (role ?? '')
      );
      if (exists) { return {}; }

      const updated = [...state.edges, {
        id: uuid(),
        source: group.hubNodeId,
        target: targetNodeId,
        type: 'custom',
        data: { edge_type: 'data_flow', role },
      } satisfies FlowEdge];
      const { nodes, edges } = flowToCanvas(state.nodes, updated);
      const newFile: CanvasFile = { ...state.canvasFile, nodes, edges, nodeGroups: state.nodeGroups };
      debouncedSave(newFile);
      return { edges: updated, canvasFile: newFile };
    });
  },

  connectNodeToGroup(sourceNodeId, groupId) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const group = state.nodeGroups.find(g => g.id === groupId);
      if (!group) { return {}; }

      const sourceNode = state.canvasFile.nodes.find(n => n.id === sourceNodeId);
      if (!sourceNode) { return {}; }
      if (sourceNodeId === group.hubNodeId) { return {}; }

      const edgeType: CanvasEdge['edge_type'] = 'reference';
      const exists = state.edges.some(
        edge =>
          edge.source === sourceNodeId &&
          edge.target === group.hubNodeId &&
          edge.data?.edge_type === edgeType
      );
      if (exists) { return {}; }

      const updated = [...state.edges, {
        id: uuid(),
        source: sourceNodeId,
        target: group.hubNodeId,
        type: 'custom',
        data: { edge_type: edgeType },
      } satisfies FlowEdge];
      const { nodes, edges } = flowToCanvas(state.nodes, updated);
      const newFile: CanvasFile = { ...state.canvasFile, nodes, edges, nodeGroups: state.nodeGroups };
      debouncedSave(newFile);
      return { edges: updated, canvasFile: newFile };
    });
  },

  _createEdge(connection, role, edgeType = 'data_flow') {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const newEdge: FlowEdge = {
        id: uuid(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        type: edgeType === 'pipeline_flow' ? 'pipeline' : 'custom',
        data: { edge_type: edgeType, role },
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

      debouncedSave(newFile, 'immediate');
      return { nodes: updatedNodes, edges: updatedEdges, canvasFile: newFile, aiOutputRunId: runId };
    });
  },

  setImageUri(filePath, uri) {
    get().resolveInitialCanvasLoadRequest(`media:${filePath}`);
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

      debouncedSave(newFile, 'immediate');
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  setNodeFileMissing(nodeId, missing) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const nodes = state.nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, meta: { ...n.data.meta, file_missing: missing } } }
          : n
      );
      const canvasFile = {
        ...state.canvasFile,
        nodes: state.canvasFile.nodes.map(cn =>
          cn.id === nodeId
            ? { ...cn, meta: { ...cn.meta, file_missing: missing } }
            : cn
        ),
      };
      markPersistedFromExternal(canvasFile);
      return {
        nodes,
        canvasFile,
        saveState: 'saved',
        saveDueAt: null,
        saveError: null,
        lastSavedAt: Date.now(),
      };
    });
  },

  updateNodeFilePath(nodeId, newFilePath, newTitle) {
    set(state => {
      if (!state.canvasFile) { return {}; }
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
      const canvasFile: CanvasFile = {
        ...state.canvasFile,
        nodes: state.canvasFile.nodes.map(cn =>
          cn.id === nodeId
            ? { ...cn, title: newTitle, file_path: newFilePath, meta: { ...cn.meta, file_missing: false } }
            : cn
        ),
      };
      markPersistedFromExternal(canvasFile);
      return {
        nodes,
        canvasFile,
        saveState: 'saved',
        saveDueAt: null,
        saveError: null,
        lastSavedAt: Date.now(),
      };
    });
  },

  updateNodePreview(nodeId, preview, metaPatch) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      // Invalidate fullContentCache so lazy-load re-fetches fresh content
      const newCache = { ...state.fullContentCache };
      delete newCache[nodeId];
      const applyPatch = (meta: typeof state.nodes[number]['data']['meta']) => ({
        ...meta,
        content_preview: preview,
        file_missing: false,
        ...(metaPatch ?? {}),
      });
      const updatedNodes = state.nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, meta: applyPatch(n.data.meta) } }
          : n
      );
      const canvasFile: CanvasFile = {
        ...state.canvasFile,
        nodes: state.canvasFile.nodes.map(cn =>
          cn.id === nodeId
            ? { ...cn, meta: applyPatch(cn.meta) }
            : cn
        ),
      };
      markPersistedFromExternal(canvasFile);
      return {
        nodes: updatedNodes,
        canvasFile,
        fullContentCache: newCache,
        saveState: 'saved',
        saveDueAt: null,
        saveError: null,
        lastSavedAt: Date.now(),
      };
    });
  },

  setFullContent(nodeId, content) {
    get().setFullContents([{ nodeId, content }]);
  },

  setFullContents(entries) {
    if (!entries.length) { return; }
    get().resolveInitialCanvasLoadRequests(entries.map(entry => `file:${entry.nodeId}`));

    set(state => {
      const fullContentCache = { ...state.fullContentCache };

      for (const { nodeId, content } of entries) {
        if (!content) { continue; }
        fullContentCache[nodeId] = content;
      }

      return { fullContentCache };
    });
  },

  addToStaging(nodes) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const existingIds = new Set(state.stagingNodes.map(n => n.id));
      const toAdd = nodes.filter(n => n?.id && !existingIds.has(n.id));
      if (toAdd.length === 0) { return {}; }
      const stagingNodes = [...state.stagingNodes, ...toAdd];
      const newFile: CanvasFile = { ...state.canvasFile, stagingNodes };
      debouncedSave(newFile, 'immediate');
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
      debouncedSave(newFile, 'immediate');
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
        debouncedSave(newFile, 'immediate');
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

      debouncedSave(newFile, 'immediate');
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
      debouncedSave(newFile, 'immediate');
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
        debouncedSave(newFile, 'immediate');
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
      debouncedSave(newFile, 'immediate');
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

  previewNodeSize(nodeId, width, height) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const nextWidth = Math.round(width);
      const nextHeight = Math.round(height);
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== nodeId) { return n; }
        return {
          ...n,
          width: nextWidth,
          height: nextHeight,
          data: { ...n.data, size: { width: nextWidth, height: nextHeight } },
        };
      });
      const nodeGroups = recalcGroupsForNodeIds(state.nodeGroups, updatedNodes, [nodeId]);
      const syncedNodes = syncGroupHubNodes(updatedNodes, nodeGroups);
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(syncedNodes, state.edges);
      const canvasFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges, nodeGroups };
      return { nodes: syncedNodes, canvasFile, nodeGroups };
    });
  },

  updateNodeSize(nodeId, width, height, metaPatch) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== nodeId) { return n; }
        return {
          ...n,
          width: Math.round(width),
          height: Math.round(height),
          data: {
            ...n.data,
            size: { width: Math.round(width), height: Math.round(height) },
            meta: metaPatch ? { ...n.data.meta, ...metaPatch } : n.data.meta,
          },
        };
      });
      const nodeGroups = recalcGroupsForNodeIds(state.nodeGroups, updatedNodes, [nodeId]);
      const syncedNodes = syncGroupHubNodes(updatedNodes, nodeGroups);
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(syncedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges, nodeGroups };
      debouncedSave(newFile);
      return { nodes: syncedNodes, canvasFile: newFile, nodeGroups };
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
    return collectExpandedInputs(nodeId, state.canvasFile, ['data_flow', 'pipeline_flow']).map(ref => ref.node);
  },

  /** Check if a function node has downstream pipeline connections */
  hasDownstreamPipeline(nodeId) {
    const state = get();
    if (!state.canvasFile) { return false; }
    return state.canvasFile.edges.some(
      e => e.source === nodeId && e.edge_type === 'pipeline_flow'
    );
  },

  /**
   * Find the "head" function node(s) of a pipeline starting from selected nodes.
   * A head node is a function node that has pipeline_flow edges downstream
   * but no pipeline_flow edges upstream (or is the topmost in the selection).
   */
  getPipelineHeadNodes(selectedIds: string[]) {
    const state = get();
    if (!state.canvasFile) { return []; }
    const selectedSet = new Set(selectedIds);
    const fnNodes = state.canvasFile.nodes.filter(
      n => selectedSet.has(n.id) && n.node_type === 'function'
    );
    // Filter to nodes involved in pipeline_flow edges (source or target)
    const pipelineEdges = state.canvasFile.edges.filter(e => e.edge_type === 'pipeline_flow');
    const pipelineFnIds = new Set<string>();
    for (const e of pipelineEdges) {
      if (selectedSet.has(e.source)) { pipelineFnIds.add(e.source); }
      if (selectedSet.has(e.target)) { pipelineFnIds.add(e.target); }
    }
    if (pipelineFnIds.size === 0) { return []; }
    // Head nodes: in pipeline but no pipeline_flow edge points to them from within selection
    const hasIncoming = new Set<string>();
    for (const e of pipelineEdges) {
      if (pipelineFnIds.has(e.source) && pipelineFnIds.has(e.target)) {
        hasIncoming.add(e.target);
      }
    }
    return fnNodes.filter(n => pipelineFnIds.has(n.id) && !hasIncoming.has(n.id));
  },

  setAiPanelOpen(open)      { set({ aiPanelOpen: open }); },
  setAiToolsPanelOpen(open) { set({ aiToolsPanelOpen: open }); },
  setError(message)          { set({ lastError: message }); },
  clearError()               { set({ lastError: '' }); },
  setModelCache(provider, models) {
    set(state => ({ modelCache: { ...state.modelCache, [provider]: models } }));
  },
  setSettings(s) {
    set({ settings: s });
    const currentSerialized = serializeCanvasFile(get().canvasFile);
    const hasUnsavedChanges = !!currentSerialized && currentSerialized !== lastPersistedSerialized;
    if (!s.autoSave) {
      if (hasUnsavedChanges) {
        set({ saveState: 'pending', saveDueAt: null });
      }
      return;
    }
    if (hasUnsavedChanges) {
      markCanvasDirty();
    }
  },
  setSettingsPanelOpen(open) { set({ settingsPanelOpen: open }); },
  setToolDefs(defs)           { set({ toolDefs: defs }); },
  setNodeDefs(defs)           { set({ nodeDefs: defs }); },
  setOutputHistory(data)      { set({ outputHistory: data }); },

  // ── Selection / Search / Node Group ─────────────────────────────────────
  setSelectedNodeIds(ids) {
    set(state => {
      if (
        state.selectedNodeIds.length === ids.length &&
        state.selectedNodeIds.every((id, index) => id === ids[index])
      ) {
        return {};
      }
      return { selectedNodeIds: ids };
    });
  },
  setSelectionMode(on) { set({ selectionMode: on }); },

  setSearchOpen(open) {
    set(state => {
      if (open) { return { searchOpen: true }; }
      return {
        searchOpen: false,
        searchQuery: '',
        searchMatches: [],
        searchIndex: -1,
      };
    });
  },

  setSearchQuery(query) {
    set(state => {
      const matches = state.canvasFile ? calcSearchMatches(state.canvasFile.nodes ?? [], query) : [];
      return {
        searchQuery: query,
        searchMatches: matches,
        searchIndex: matches.length > 0 ? 0 : -1,
      };
    });
  },

  nextSearchMatch() {
    set(state => {
      if (state.searchMatches.length === 0) { return {}; }
      const next = (state.searchIndex + 1 + state.searchMatches.length) % state.searchMatches.length;
      return { searchIndex: next };
    });
  },

  prevSearchMatch() {
    set(state => {
      if (state.searchMatches.length === 0) { return {}; }
      const prev = (state.searchIndex - 1 + state.searchMatches.length) % state.searchMatches.length;
      return { searchIndex: prev };
    });
  },

  createNodeGroup(name, nodeIds, color) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const uniqueIds = Array.from(new Set(nodeIds)).filter(id => {
        const node = state.nodes.find(n => n.id === id);
        return !!node && isDataNode(node.data);
      });
      if (uniqueIds.length < 2) { return {}; }

      const groupId = uuid();
      const group: NodeGroup = {
        id: groupId,
        name: name.trim() || '节点组',
        hubNodeId: uuid(),
        nodeIds: uniqueIds,
        color: color?.color ?? 'rgba(216, 182, 72, 0.16)',
        borderColor: color?.borderColor ?? '#d8b648',
        bounds: calcGroupBounds(state.nodes, uniqueIds),
        collapsed: false,
      };
      const hubCanvasNode = buildHubCanvasNode(group);
      const hubFlowNode = syncHubFlowNode({
        id: hubCanvasNode.id,
        type: 'nodeGroup',
        position: hubCanvasNode.position,
        data: hubCanvasNode,
        width: hubCanvasNode.size.width,
        height: hubCanvasNode.size.height,
      }, group);

      const memberEdges: FlowEdge[] = uniqueIds.map(memberId => ({
        id: uuid(),
        source: memberId,
        target: group.hubNodeId,
        type: 'custom',
        data: { edge_type: 'hub_member' },
        hidden: true,
      }));

      const nodeGroups = [...state.nodeGroups, group];
      const nodes = [...state.nodes, hubFlowNode];
      const edges = [...state.edges, ...memberEdges];
      const { nodes: canvasNodes, edges: canvasEdges } = flowToCanvas(nodes, edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: canvasNodes, edges: canvasEdges, nodeGroups };
      debouncedSave(newFile);
      return { nodeGroups, nodes, edges, canvasFile: newFile, selectedNodeIds: [] };
    });
  },

  deleteNodeGroup(groupId) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const group = state.nodeGroups.find(g => g.id === groupId);
      if (!group) { return {}; }
      const nodeGroups = state.nodeGroups.filter(g => g.id !== groupId);
      const nodes = state.nodes.filter(node => node.id !== group.hubNodeId);
      const edges = state.edges.filter(edge => edge.source !== group.hubNodeId && edge.target !== group.hubNodeId);
      const { nodes: canvasNodes, edges: canvasEdges } = flowToCanvas(nodes, edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: canvasNodes, edges: canvasEdges, nodeGroups };
      debouncedSave(newFile);
      return { nodeGroups, nodes, edges, canvasFile: newFile };
    });
  },

  renameNodeGroup(groupId, name) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const trimmed = name.trim();
      if (!trimmed) { return {}; }
      const nodeGroups = state.nodeGroups.map(g => g.id === groupId ? { ...g, name: trimmed } : g);
      const nodes = syncGroupHubNodes(state.nodes, nodeGroups);
      const { nodes: canvasNodes, edges } = flowToCanvas(nodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: canvasNodes, edges, nodeGroups };
      debouncedSave(newFile);
      return { nodeGroups, nodes, canvasFile: newFile };
    });
  },

  toggleNodeGroupCollapse(groupId) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const nodeGroups = state.nodeGroups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g);
      const nodes = syncGroupHubNodes(state.nodes, nodeGroups);
      const { nodes: canvasNodes, edges } = flowToCanvas(nodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: canvasNodes, edges, nodeGroups };
      debouncedSave(newFile);
      return { nodeGroups, nodes, canvasFile: newFile };
    });
  },

  removeNodeFromGroup(groupId, nodeId) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const nodeGroups = state.nodeGroups
        .map(g => {
          if (g.id !== groupId) { return g; }
          const nextIds = g.nodeIds.filter(id => id !== nodeId);
          if (nextIds.length === 0) { return null; }
          return {
            ...g,
            nodeIds: nextIds,
            bounds: calcGroupBounds(state.nodes, nextIds, g.bounds),
          };
        })
        .filter((g): g is NodeGroup => !!g);
      const activeHubIds = new Set(nodeGroups.map(group => group.hubNodeId));
      const nodes = syncGroupHubNodes(
        state.nodes.filter(node => !isGroupHubNodeType(node.data.node_type) || activeHubIds.has(node.id)),
        nodeGroups,
      );
      const edges = state.edges.filter(edge => {
        const sourceExists = nodes.some(node => node.id === edge.source);
        const targetExists = nodes.some(node => node.id === edge.target);
        if (!sourceExists || !targetExists) { return false; }
        if (!isHubEdgeType(edge.data?.edge_type)) { return true; }
        const group = nodeGroups.find(item => item.hubNodeId === edge.target);
        return !!group && group.nodeIds.includes(edge.source);
      });
      const { nodes: canvasNodes, edges: canvasEdges } = flowToCanvas(nodes, edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: canvasNodes, edges: canvasEdges, nodeGroups };
      debouncedSave(newFile);
      return { nodeGroups, nodes, edges, canvasFile: newFile };
    });
  },

  addNodeToGroup(groupId, nodeId) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const node = state.nodes.find(n => n.id === nodeId);
      if (!node || !isDataNode(node.data)) { return {}; }
      let addedToHubId = '';
      const nodeGroups = state.nodeGroups.map(g => {
        if (g.id !== groupId) { return g; }
        if (g.nodeIds.includes(nodeId)) { return g; }
        const nextIds = [...g.nodeIds, nodeId];
        addedToHubId = g.hubNodeId;
        return {
          ...g,
          nodeIds: nextIds,
          bounds: calcGroupBounds(state.nodes, nextIds, g.bounds),
        };
      });
      const nodes = syncGroupHubNodes(state.nodes, nodeGroups);
      const edges = addedToHubId
        ? [...state.edges, {
            id: uuid(),
            source: nodeId,
            target: addedToHubId,
            type: 'custom',
            data: { edge_type: 'hub_member' },
            hidden: true,
          } satisfies FlowEdge]
        : state.edges;
      const { nodes: canvasNodes, edges: canvasEdges } = flowToCanvas(nodes, edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: canvasNodes, edges: canvasEdges, nodeGroups };
      debouncedSave(newFile);
      return { nodeGroups, nodes, edges, canvasFile: newFile };
    });
  },

  recalcGroupBounds(groupId) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const nodeGroups = state.nodeGroups.map(g => {
        if (g.id !== groupId) { return g; }
        return { ...g, bounds: calcGroupBounds(state.nodes, g.nodeIds, g.bounds) };
      });
      const nodes = syncGroupHubNodes(state.nodes, nodeGroups);
      const { nodes: canvasNodes, edges } = flowToCanvas(nodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: canvasNodes, edges, nodeGroups };
      debouncedSave(newFile);
      return { nodeGroups, nodes, canvasFile: newFile };
    });
  },

  // ── Boards (画板/工作区) ─────────────────────────────────────────────────
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

      // ── Snapshot-based move: only move nodes that were ALREADY inside the
      //    board at drag-start, NOT dynamically detected overlaps.  This
      //    prevents the "sticky" effect where passing over nodes drags them.
      const memberIds = _boardDragMembers;
      const updatedNodes = memberIds.size > 0
        ? state.nodes.map(n =>
            memberIds.has(n.id)
              ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
              : n
          )
        : state.nodes;

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

  // ── Pipeline state management ──────────────────────────────────────────────

  setPipelineState(state) { set({ pipelineState: state }); },

  updatePipelineNodeStatus(nodeId, status) {
    set(s => {
      if (!s.pipelineState) { return {}; }
      const nextCurrentNodeId = status === 'running'
        ? nodeId
        : (s.pipelineState.currentNodeId === nodeId ? null : s.pipelineState.currentNodeId);
      return {
        pipelineState: {
          ...s.pipelineState,
          nodeStatuses: { ...s.pipelineState.nodeStatuses, [nodeId]: status },
          currentNodeId: nextCurrentNodeId,
        },
      };
    });
  },

  incrementPipelineCompleted() {
    set(s => {
      if (!s.pipelineState) { return {}; }
      return {
        pipelineState: {
          ...s.pipelineState,
          completedNodes: s.pipelineState.completedNodes + 1,
        },
      };
    });
  },

  setPipelinePaused(paused) {
    set(s => {
      if (!s.pipelineState) { return {}; }
      return {
        pipelineState: { ...s.pipelineState, isPaused: paused },
      };
    });
  },

  addPipelineWarning(nodeId, message) {
    set(s => {
      if (!s.pipelineState) { return {}; }
      return {
        pipelineState: {
          ...s.pipelineState,
          validationWarnings: [...s.pipelineState.validationWarnings, { nodeId, message }],
        },
      };
    });
  },

  saveNow() {
    saveImmediately(get().canvasFile);
  },

  runAutosaveCheck() {
    resetAutosaveWindow();
    const state = get();
    if (!state.settings?.autoSave || !state.canvasFile) {
      if (state.saveState === 'pending') {
        set({ saveDueAt: null });
      }
      return;
    }
    if (state.saveState === 'saving') { return; }

    const currentSerialized = serializeCanvasFile(state.canvasFile);
    if (!currentSerialized || currentSerialized === lastPersistedSerialized) {
      set({
        saveState: 'saved',
        saveDueAt: null,
        saveError: null,
      });
      return;
    }

    dispatchSave('auto', state.canvasFile);
  },

  markSaveSuccess(savedAt, requestId) {
    if (requestId !== undefined) {
      const serialized = inFlightSavePayloads.get(requestId);
      if (!serialized) { return; }
      inFlightSavePayloads.delete(requestId);
      lastPersistedSerialized = serialized;
    }

    const currentSerialized = serializeCanvasFile(get().canvasFile);
    if (inFlightSavePayloads.size > 0) {
      set({
        saveState: 'saving',
        saveDueAt: null,
        lastSavedAt: savedAt ?? Date.now(),
        saveError: null,
      });
      return;
    }

    if (currentSerialized && currentSerialized !== lastPersistedSerialized) {
      markCanvasDirty();
      set({ lastSavedAt: savedAt ?? Date.now() });
      return;
    }

    set({
      saveState: 'saved',
      saveDueAt: null,
      lastSavedAt: savedAt ?? Date.now(),
      saveError: null,
    });
  },

  markSaveError(message, requestId) {
    if (requestId !== undefined) {
      inFlightSavePayloads.delete(requestId);
    }
    set({
      saveState: 'error',
      saveDueAt: null,
      saveError: message,
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
    const boards = prev.boards ?? [];
    const nodeGroups = prev.nodeGroups ?? [];

    debouncedSave(prev);
    set({
      undoStack: newUndoStack,
      redoStack: [...get().redoStack, currentSnapshot],
      canvasFile: prev,
      nodes: flowNodes,
      edges: flowEdges,
      stagingNodes: prev.stagingNodes ?? [],
      boards,
      nodeGroups,
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
    const nodeGroups = next.nodeGroups ?? [];

    debouncedSave(next);
    set({
      redoStack: newRedoStack,
      undoStack: [...get().undoStack, currentSnapshot],
      canvasFile: next,
      nodes: flowNodes,
      edges: flowEdges,
      stagingNodes: next.stagingNodes ?? [],
      boards,
      nodeGroups,
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
