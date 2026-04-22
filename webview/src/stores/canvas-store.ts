import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import {
  isBlueprintInstanceContainerNode,
  isBlueprintInputPlaceholderNode,
  isDataNode,
  isGroupHubNodeType,
  isHubEdgeType,
} from '../../../src/core/canvas-model';
import type {
  CanvasFile,
  CanvasNode,
  CanvasEdge,
  NodeGroup,
  FnStatus,
  RunIssueKind,
  AiTool,
  ModelInfo,
  SettingsSnapshot,
  JsonToolDef,
  DataNodeDef,
  ParamDef,
  Board,
} from '../../../src/core/canvas-model';
import { DEFAULT_SIZES } from '../../../src/core/canvas-model';
import { collectExpandedInputs, getGroupByHubNodeId } from '../../../src/core/hub-utils';
import { postMessage } from '../bridge';
import { wouldCreateCycle } from '../utils/graph-utils';
import { normalizeNodePortId } from '../utils/node-port';
import { usePetStore } from './pet-store';
import type { BlueprintDataNodeDef, BlueprintDefinition, BlueprintDraft, BlueprintSlotDef } from '../../../src/blueprint/blueprint-types';
import type { BlueprintRegistryEntry } from '../../../src/blueprint/blueprint-registry';

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
  selected?: boolean;
}

// ── Store state ─────────────────────────────────────────────────────────────
interface PendingConnection {
  connection: Connection;
  sourceNode: CanvasNode;
  targetNode: CanvasNode;
  targetToolDef: JsonToolDef;
}

interface BlueprintDefinitionEnvelope {
  filePath: string;
  definition: BlueprintDefinition;
}

// ── Pipeline UI state ─────────────────────────────────────────────────────
export type PipelineNodeStatus = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

export interface PipelineState {
  pipelineId: string;
  triggerNodeId: string;
  nodeStatuses: Record<string, PipelineNodeStatus>;
  nodeIssues: Record<string, { kind: RunIssueKind; message: string }>;
  totalNodes: number;
  completedNodes: number;
  isRunning: boolean;
  isPaused: boolean;
  cancelRequested: boolean;
  completionStatus: 'succeeded' | 'failed' | 'cancelled' | null;
  currentNodeId: string | null;
  validationWarnings: Array<{ nodeId: string; message: string }>;
  runMode?: 'full' | 'resume';
  reusedCachedNodeCount?: number;
}

export type CanvasSaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface InitialCanvasLoadStats {
  sessionId: number;
  nodeCount: number;
  mediaRequestCount: number;
  fullContentRequestCount: number;
  groupBoundsRecalcCount: number;
  startedAt: number;
  renderReadyAt: number | null;
  finishedAt: number | null;
  renderReadyMs: number | null;
  totalMs: number | null;
  finishedByTimeout: boolean;
}

const INITIAL_CANVAS_LOAD_NODE_THRESHOLD = 18;
const INITIAL_CANVAS_LOAD_MIN_MS = 1200;
const INITIAL_CANVAS_LOAD_MAX_MS = 12000;
const CARD_HYDRATABLE_NODE_TYPES = new Set<CanvasNode['node_type']>(['note', 'ai_output', 'code', 'data']);
const BLUEPRINT_CONTAINER_Z_INDEX = 12;

let initialCanvasLoadStartedAt = 0;
let initialCanvasLoadHideTimer: ReturnType<typeof setTimeout> | undefined;
let initialCanvasLoadSafetyTimer: ReturnType<typeof setTimeout> | undefined;
const initialCanvasLoadPendingKeys = new Set<string>();
let nextInitialCanvasLoadSessionId = 0;

function updateCurrentInitialCanvasLoadStats(
  updater: (stats: InitialCanvasLoadStats) => InitialCanvasLoadStats
) {
  const state = useCanvasStore.getState();
  const currentStats = state.currentInitialCanvasLoadStats;
  if (!currentStats) { return; }
  useCanvasStore.setState({ currentInitialCanvasLoadStats: updater(currentStats) });
}

function bumpInitialCanvasGroupBoundsRecalc(count = 1) {
  if (count <= 0) { return; }
  updateCurrentInitialCanvasLoadStats(stats => ({
    ...stats,
    groupBoundsRecalcCount: stats.groupBoundsRecalcCount + count,
  }));
}

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

function finishInitialCanvasLoad(force = false, reason: 'ready' | 'min_delay' | 'timeout' = 'ready') {
  const state = useCanvasStore.getState();
  if (!state.currentInitialCanvasLoadStats) { return; }
  if (!state.initialCanvasLoadActive) { return; }
  if (!force && initialCanvasLoadPendingKeys.size > 0) { return; }
  if (!force && !state.initialCanvasRenderReady) { return; }

  const remaining = INITIAL_CANVAS_LOAD_MIN_MS - (Date.now() - initialCanvasLoadStartedAt);
  if (!force && remaining > 0) {
    if (!initialCanvasLoadHideTimer) {
      initialCanvasLoadHideTimer = setTimeout(() => {
        initialCanvasLoadHideTimer = undefined;
        finishInitialCanvasLoad(true, 'min_delay');
      }, remaining);
    }
    return;
  }

  clearInitialCanvasLoadTimers();
  initialCanvasLoadPendingKeys.clear();
  const currentStats = useCanvasStore.getState().currentInitialCanvasLoadStats;
  const finishedAt = Date.now();
  useCanvasStore.setState({
    initialCanvasLoadActive: false,
    initialCanvasLoadPending: 0,
    currentInitialCanvasLoadStats: null,
    lastInitialCanvasLoadStats: currentStats ? {
      ...currentStats,
      finishedAt,
      totalMs: Math.max(0, finishedAt - currentStats.startedAt),
      finishedByTimeout: reason === 'timeout',
    } : null,
  });
}

function resolveCardContentModeForLoad(node: CanvasNode): 'preview' | 'full' | undefined {
  if (!CARD_HYDRATABLE_NODE_TYPES.has(node.node_type)) { return undefined; }
  const defaultSize = DEFAULT_SIZES[node.node_type];
  const nextWidth = node.size?.width ?? defaultSize.width;
  const nextHeight = node.size?.height ?? defaultSize.height;
  const expandedEnough =
    nextHeight >= defaultSize.height + 60 ||
    nextWidth >= defaultSize.width + 80;
  return expandedEnough ? 'full' : 'preview';
}

function shouldTrackInitialFullContentLoad(node: CanvasNode, hiddenNodeIds: Set<string>): boolean {
  if (hiddenNodeIds.has(node.id)) { return false; }
  if (!node.file_path || node.meta?.file_missing) { return false; }
  const desiredMode = node.meta?.card_content_mode ?? resolveCardContentModeForLoad(node);
  return desiredMode === 'full';
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
  modelRequestState: Record<string, 'loading' | 'loaded'>;
  stagingNodes: CanvasNode[];
  pendingStagingMaterializations: Record<string, { position: { x: number; y: number } }>;
  settings: SettingsSnapshot | null;
  settingsPanelOpen: boolean;
  toolDefs: JsonToolDef[];
  nodeDefs: DataNodeDef[];
  pendingConnection: PendingConnection | null;
  _cycleErrorNodeId: string | null;
  outputHistory: import('../../../src/core/canvas-model').OutputHistoryPayload | null;
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
  blueprintDraft: BlueprintDraft | null;
  blueprintIndex: BlueprintRegistryEntry[];
  pipelineState: PipelineState | null;
  saveState: CanvasSaveState;
  saveDueAt: number | null;
  lastSavedAt: number | null;
  saveError: string | null;
  initialCanvasLoadActive: boolean;
  initialCanvasLoadPending: number;
  initialCanvasRenderReady: boolean;
  currentInitialCanvasLoadStats: InitialCanvasLoadStats | null;
  lastInitialCanvasLoadStats: InitialCanvasLoadStats | null;

  initCanvas(data: CanvasFile, workspaceRoot: string): void;
  beginInitialCanvasLoad(summary: { nodeCount: number; mediaRequestCount: number; fullContentRequestCount: number }): void;
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
  updateNodeStatus(nodeId: string, status: FnStatus, progressText?: string, issueKind?: RunIssueKind, issueMessage?: string): void;
  updateBpChildStatus(bpId: string, childId: string, status: FnStatus): void;
  appendAiChunk(runId: string, chunk: string, title?: string): void;
  finishAiRun(runId: string, node: CanvasNode, edge: CanvasEdge): void;
  setImageUri(filePath: string, uri: string): void;
  setImageUris(entries: Array<{ filePath: string; uri: string }>): void;
  addNode(node: CanvasNode): void;
  setNodeFileMissing(nodeId: string, missing: boolean): void;
  updateNodeFilePath(nodeId: string, newFilePath: string, newTitle: string): void;
  updateNodePreview(nodeId: string, preview: string, metaPatch?: Partial<import('../../../src/core/canvas-model').NodeMeta>): void;
  updateNodePreviews(entries: Array<{ nodeId: string; preview: string; metaPatch?: Partial<import('../../../src/core/canvas-model').NodeMeta> }>): void;
  setFullContent(nodeId: string, content: string): void;
  setFullContents(entries: Array<{ nodeId: string; content: string }>): void;
  addToStaging(nodes: CanvasNode[]): void;
  removeFromStaging(nodeId: string): void;
  commitStagingNode(nodeId: string, position: { x: number; y: number }): void;
  resolveStagingMaterialization(sourceNodeId: string, node: CanvasNode, position: { x: number; y: number }): void;
  failStagingMaterialization(sourceNodeId: string): void;
  createFunctionNode(tool: AiTool | string, position: { x: number; y: number }): void;
  createBlueprintInstance(entry: BlueprintRegistryEntry, position?: { x: number; y: number }): void;
  instantiateBlueprintDefinition(
    entry: BlueprintRegistryEntry,
    definition: BlueprintDefinition,
    position?: { x: number; y: number },
  ): void;
  createDataNode(nodeType: 'experiment_log' | 'task', position: { x: number; y: number }): void;
  updateNodeParamValue(nodeId: string, key: string, value: unknown): void;
  updateNodeMeta(
    nodeId: string,
    patch: Partial<import('../../../src/core/canvas-model').NodeMeta>,
    syncMode?: 'deferred' | 'immediate',
  ): void;
  syncBlueprintDefinitionAvailability(succeededPaths: string[], failedPaths: string[]): void;
  updateViewport(viewport: { x: number; y: number; zoom: number }): void;
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
  requestModelCache(provider: string, opts?: { force?: boolean }): void;
  setModelCache(provider: string, models: ModelInfo[]): void;
  setSettings(s: SettingsSnapshot): void;
  setSettingsPanelOpen(open: boolean): void;
  setToolDefs(defs: JsonToolDef[]): void;
  setNodeDefs(defs: DataNodeDef[]): void;
  setOutputHistory(data: import('../../../src/core/canvas-model').OutputHistoryPayload | null): void;
  setSelectedNodeIds(ids: string[]): void;
  selectExclusiveNode(nodeId: string): void;
  selectExclusiveEdge(edgeId: string): void;
  clearSelection(): void;
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
  moveBlueprintInstance(instanceId: string, dx: number, dy: number): void;
  openPreview(nodeId: string): void;
  closePreview(): void;
  setBlueprintDraft(draft: BlueprintDraft | null): void;
  clearBlueprintDraft(): void;
  setBlueprintIndex(entries: BlueprintRegistryEntry[]): void;
  migrateBlueprintDefinitions(definitions: BlueprintDefinitionEnvelope[]): void;
  pushUndo(): void;
  undo(): void;
  redo(): void;
  // ── Pipeline state methods ──
  setPipelineState(state: PipelineState | null): void;
  updatePipelineNodeStatus(nodeId: string, status: PipelineNodeStatus): void;
  setPipelineNodeIssue(nodeId: string, issue: { kind: RunIssueKind; message: string } | null): void;
  incrementPipelineCompleted(): void;
  setPipelinePaused(paused: boolean): void;
  setPipelineCancelRequested(requested: boolean): void;
  addPipelineWarning(nodeId: string, message: string): void;
  saveNow(): void;
  runAutosaveCheck(): void;
  markSaveSuccess(savedAt?: number, requestId?: number): void;
  markSaveError(message: string, requestId?: number): void;
}

// ── Save scheduling ─────────────────────────────────────────────────────────
const AUTO_SAVE_INTERVAL_MS = 3 * 60 * 1000;
const BLUEPRINT_STATUS_COLUMN_MIN_HEIGHT = 372;
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

function computeBlueprintInstanceSize(entry: BlueprintRegistryEntry): { width: number; height: number } {
  const width = Math.max(DEFAULT_SIZES.blueprint.width, 700);
  const inputRows = Math.max(1, entry.input_slots);
  const outputRows = Math.max(1, entry.output_slots);
  const leftColumnHeight = 28 + inputRows * 62;
  const middleColumnHeight = BLUEPRINT_STATUS_COLUMN_MIN_HEIGHT;
  const rightColumnHeight = 28 + outputRows * 62;
  const contentHeight = Math.max(leftColumnHeight, middleColumnHeight, rightColumnHeight);
  const footerHeight = 56;
  const height = Math.max(DEFAULT_SIZES.blueprint.height, 40 + 24 + contentHeight + footerHeight);
  return { width, height };
}

function computeBlueprintSizeFromCounts(inputSlots: number, outputSlots: number): { width: number; height: number } {
  const width = Math.max(DEFAULT_SIZES.blueprint.width, 700);
  const inputRows = Math.max(1, inputSlots);
  const outputRows = Math.max(1, outputSlots);
  const leftColumnHeight = 28 + inputRows * 62;
  const middleColumnHeight = BLUEPRINT_STATUS_COLUMN_MIN_HEIGHT;
  const rightColumnHeight = 28 + outputRows * 62;
  const contentHeight = Math.max(leftColumnHeight, middleColumnHeight, rightColumnHeight);
  const footerHeight = 56;
  const height = Math.max(DEFAULT_SIZES.blueprint.height, 40 + 24 + contentHeight + footerHeight);
  return { width, height };
}

function computeBlueprintSizeFromNode(node: CanvasNode): { width: number; height: number } {
  const inputSlots = node.meta?.blueprint_input_slot_defs?.length
    ?? node.meta?.blueprint_input_slots
    ?? 0;
  const outputSlots = node.meta?.blueprint_output_slot_defs?.length
    ?? node.meta?.blueprint_output_slots
    ?? 0;
  return computeBlueprintSizeFromCounts(inputSlots, outputSlots);
}

function buildBlueprintMetaFromEntry(
  entry: BlueprintRegistryEntry,
  previousMeta?: CanvasNode['meta'],
): NonNullable<CanvasNode['meta']> {
  return {
    ...(previousMeta ?? {}),
    blueprint_def_id: entry.id,
    blueprint_file_path: entry.file_path,
    blueprint_color: entry.color,
    blueprint_version: entry.version,
    blueprint_input_slots: entry.input_slots,
    blueprint_intermediate_slots: entry.intermediate_slots,
    blueprint_output_slots: entry.output_slots,
    blueprint_function_count: entry.function_nodes,
    blueprint_input_slot_defs: entry.input_slot_defs,
    blueprint_output_slot_defs: entry.output_slot_defs,
  };
}

function buildBlueprintMetaFromDefinition(
  filePath: string,
  definition: BlueprintDefinition,
  previousMeta?: CanvasNode['meta'],
): NonNullable<CanvasNode['meta']> {
  const normalizedDefinition = synthesizeImplicitBlueprintOutputSlots(definition);
  return {
    ...(previousMeta ?? {}),
    blueprint_def_id: normalizedDefinition.id,
    blueprint_file_path: filePath,
    blueprint_color: normalizedDefinition.color,
    blueprint_version: normalizedDefinition.version,
    blueprint_input_slots: normalizedDefinition.input_slots.length,
    blueprint_intermediate_slots: normalizedDefinition.intermediate_slots.length,
    blueprint_output_slots: normalizedDefinition.output_slots.length,
    blueprint_function_count: normalizedDefinition.function_nodes.length,
    blueprint_input_slot_defs: normalizedDefinition.input_slots,
    blueprint_output_slot_defs: normalizedDefinition.output_slots,
  };
}

function computeBlueprintContainerBounds(nodes: CanvasNode[]): Rect {
  const TOP_PAD = 64;
  const SIDE_PAD = 28;
  const BOTTOM_PAD = 28;
  if (nodes.length === 0) {
    return {
      x: 0,
      y: 0,
      width: Math.max(DEFAULT_SIZES.blueprint.width, 700),
      height: Math.max(DEFAULT_SIZES.blueprint.height, 320),
    };
  }

  const minX = Math.min(...nodes.map(node => node.position.x));
  const minY = Math.min(...nodes.map(node => node.position.y));
  const maxX = Math.max(...nodes.map(node => node.position.x + node.size.width));
  const maxY = Math.max(...nodes.map(node => node.position.y + node.size.height));

  return {
    x: minX - SIDE_PAD,
    y: minY - TOP_PAD,
    width: Math.max(DEFAULT_SIZES.blueprint.width, maxX - minX + SIDE_PAD * 2),
    height: Math.max(DEFAULT_SIZES.blueprint.height, maxY - minY + TOP_PAD + BOTTOM_PAD),
  };
}

function computeBlueprintContainerBoundsFromFlowNodes(nodes: FlowNode[]): Rect {
  const TOP_PAD = 64;
  const SIDE_PAD = 28;
  const BOTTOM_PAD = 28;
  if (nodes.length === 0) {
    return {
      x: 0,
      y: 0,
      width: Math.max(DEFAULT_SIZES.blueprint.width, 700),
      height: Math.max(DEFAULT_SIZES.blueprint.height, 320),
    };
  }

  const minX = Math.min(...nodes.map(node => node.position.x));
  const minY = Math.min(...nodes.map(node => node.position.y));
  const maxX = Math.max(...nodes.map(node => node.position.x + (node.width ?? node.data.size.width)));
  const maxY = Math.max(...nodes.map(node => node.position.y + (node.height ?? node.data.size.height)));

  return {
    x: minX - SIDE_PAD,
    y: minY - TOP_PAD,
    width: Math.max(DEFAULT_SIZES.blueprint.width, maxX - minX + SIDE_PAD * 2),
    height: Math.max(DEFAULT_SIZES.blueprint.height, maxY - minY + TOP_PAD + BOTTOM_PAD),
  };
}

function createBlueprintContainerCanvasNode(
  entry: BlueprintRegistryEntry,
  definition: BlueprintDefinition,
  instanceId: string,
  bounds: Rect,
): CanvasNode {
  const normalizedDefinition = synthesizeImplicitBlueprintOutputSlots(definition);
  return {
    id: uuid(),
    node_type: 'blueprint',
    title: entry.title,
    position: { x: bounds.x, y: bounds.y },
    size: { width: bounds.width, height: bounds.height },
    meta: {
      ...buildBlueprintMetaFromEntry(entry),
      blueprint_instance_id: instanceId,
      blueprint_input_slots: normalizedDefinition.input_slots.length,
      blueprint_intermediate_slots: normalizedDefinition.intermediate_slots.length,
      blueprint_output_slots: normalizedDefinition.output_slots.length,
      blueprint_function_count: normalizedDefinition.function_nodes.length,
      blueprint_input_slot_defs: normalizedDefinition.input_slots,
      blueprint_output_slot_defs: normalizedDefinition.output_slots,
    },
  };
}

function syncBlueprintNodeFromEntry(node: FlowNode, entry: BlueprintRegistryEntry): FlowNode {
  const size = node.data.meta?.blueprint_instance_id
    ? node.data.size
    : computeBlueprintInstanceSize(entry);
  return {
    ...node,
    type: 'blueprintNode',
    width: size.width,
    height: size.height,
    data: {
      ...node.data,
      node_type: 'blueprint',
      title: entry.title,
      size,
      meta: buildBlueprintMetaFromEntry(entry, node.data.meta),
    },
  };
}

function syncBlueprintNodeFromDefinition(
  node: FlowNode,
  filePath: string,
  definition: BlueprintDefinition,
): FlowNode {
  const normalizedDefinition = synthesizeImplicitBlueprintOutputSlots(definition);
  const size = node.data.meta?.blueprint_instance_id
    ? node.data.size
    : computeBlueprintSizeFromCounts(normalizedDefinition.input_slots.length, normalizedDefinition.output_slots.length);
  return {
    ...node,
    type: 'blueprintNode',
    width: size.width,
    height: size.height,
    data: {
      ...node.data,
      node_type: 'blueprint',
      title: definition.title,
      size,
      meta: buildBlueprintMetaFromDefinition(filePath, normalizedDefinition, node.data.meta),
    },
  };
}

function hydrateBlueprintNodesFromIndex(
  nodes: FlowNode[],
  entries: BlueprintRegistryEntry[],
): { nodes: FlowNode[]; changed: boolean } {
  if (nodes.length === 0 || entries.length === 0) {
    return { nodes, changed: false };
  }

  const entryById = new Map(entries.map(entry => [entry.id, entry]));
  const entryByPath = new Map(entries.map(entry => [entry.file_path, entry]));
  let changed = false;

  const nextNodes = nodes.map(node => {
    if (node.data.node_type !== 'blueprint') { return node; }

    const matchedEntry = (
      (node.data.meta?.blueprint_def_id ? entryById.get(node.data.meta.blueprint_def_id) : undefined) ??
      (node.data.meta?.blueprint_file_path ? entryByPath.get(node.data.meta.blueprint_file_path) : undefined)
    );
    if (!matchedEntry) { return node; }

    const nextNode = syncBlueprintNodeFromEntry(node, matchedEntry);
    const sameTitle = node.data.title === nextNode.data.title;
    const sameWidth = (node.width ?? node.data.size.width) === nextNode.width;
    const sameHeight = (node.height ?? node.data.size.height) === nextNode.height;
    const sameSize =
      node.data.size.width === nextNode.data.size.width &&
      node.data.size.height === nextNode.data.size.height;
    const sameMeta = JSON.stringify(node.data.meta ?? {}) === JSON.stringify(nextNode.data.meta ?? {});
    if (sameTitle && sameWidth && sameHeight && sameSize && sameMeta) {
      return node;
    }

    changed = true;
    return nextNode;
  });

  return { nodes: nextNodes, changed };
}

function normalizeBlueprintNodes(file: CanvasFile): CanvasFile {
  const nodes = file.nodes ?? [];
  if (nodes.length === 0) { return file; }

  let changed = false;
  const nextNodes = nodes.map(node => {
    if (node.node_type !== 'blueprint') { return node; }
    const currentMeta = node.meta ?? {};
    const currentRunHistory = Array.isArray(currentMeta.blueprint_run_history) ? currentMeta.blueprint_run_history : null;
    const normalizedRunHistory = currentRunHistory
      ? currentRunHistory
        .map((entry, index) => ({ entry, index, time: Date.parse(entry.finishedAt) }))
        .sort((left, right) => {
          const leftTime = Number.isFinite(left.time) ? left.time : Number.NEGATIVE_INFINITY;
          const rightTime = Number.isFinite(right.time) ? right.time : Number.NEGATIVE_INFINITY;
          if (rightTime !== leftTime) {
            return rightTime - leftTime;
          }
          return left.index - right.index;
        })
        .map(item => item.entry)
      : null;
    const runHistoryChanged = !!(
      currentRunHistory &&
      normalizedRunHistory &&
      normalizedRunHistory.some((entry, index) => entry !== currentRunHistory[index])
    );

    if (node.meta?.blueprint_instance_id) {
      if (!runHistoryChanged) { return node; }
      changed = true;
      return {
        ...node,
        meta: {
          ...currentMeta,
          blueprint_run_history: normalizedRunHistory ?? undefined,
        },
      };
    }

    const normalizedSize = computeBlueprintSizeFromNode(node);
    const sameWidth = node.size.width === normalizedSize.width;
    const sameHeight = node.size.height === normalizedSize.height;
    if (sameWidth && sameHeight && !runHistoryChanged) { return node; }
    changed = true;
    return {
      ...node,
      size: normalizedSize,
      meta: runHistoryChanged
        ? {
          ...currentMeta,
          blueprint_run_history: normalizedRunHistory ?? undefined,
        }
        : node.meta,
    };
  });

  return changed ? { ...file, nodes: nextNodes } : file;
}

function normalizeFunctionNodeAgainstToolDefs(node: CanvasNode, toolDefs: JsonToolDef[]): CanvasNode {
  if (node.node_type !== 'function') { return node; }
  const toolId = node.meta?.ai_tool;
  if (!toolId) { return node; }

  const toolDef = toolDefs.find(tool => tool.id === toolId);
  if (!toolDef) { return node; }

  const nextSchema = toolDef.params ?? [];
  const currentMeta = node.meta ?? {};
  const currentSchema = Array.isArray(currentMeta.input_schema) ? currentMeta.input_schema : [];
  const currentParamValues = (
    currentMeta.param_values && typeof currentMeta.param_values === 'object'
      ? currentMeta.param_values
      : {}
  ) as Record<string, unknown>;

  const nextParamValues: Record<string, unknown> = { ...currentParamValues };
  let changed = JSON.stringify(currentSchema) !== JSON.stringify(nextSchema);

  for (const param of nextSchema) {
    if (nextParamValues[param.name] === undefined && param.default !== undefined) {
      nextParamValues[param.name] = param.default;
      changed = true;
    }
  }

  if (!changed) { return node; }

  return {
    ...node,
    meta: {
      ...currentMeta,
      input_schema: nextSchema,
      param_values: nextParamValues,
    },
  };
}

function normalizeFunctionNodes(file: CanvasFile, toolDefs: JsonToolDef[]): CanvasFile {
  const nodes = file.nodes ?? [];
  if (nodes.length === 0 || toolDefs.length === 0) { return file; }

  let changed = false;
  const nextNodes = nodes.map(node => {
    const nextNode = normalizeFunctionNodeAgainstToolDefs(node, toolDefs);
    if (nextNode !== node) {
      changed = true;
    }
    return nextNode;
  });

  return changed ? { ...file, nodes: nextNodes } : file;
}

function createFlowNodeFromCanvasNode(node: CanvasNode): FlowNode {
  return {
    id: node.id,
    type: nodeTypeToFlowType(node.node_type),
    position: node.position,
    data: node,
    width: node.size.width,
    height: node.size.height,
    zIndex: isBlueprintInstanceContainerNode(node) ? BLUEPRINT_CONTAINER_Z_INDEX : undefined,
    hidden: isBlueprintInstanceContainerNode(node) || node.meta?.blueprint_runtime_hidden === true,
  };
}

function upsertFlowNode(
  nodes: FlowNode[],
  nextNode: FlowNode,
): { nodes: FlowNode[]; changed: boolean } {
  const idx = nodes.findIndex(node => node.id === nextNode.id);
  if (idx < 0) {
    return { nodes: [...nodes, nextNode], changed: true };
  }

  const prev = nodes[idx];
  const same =
    prev.type === nextNode.type &&
    prev.position.x === nextNode.position.x &&
    prev.position.y === nextNode.position.y &&
    prev.width === nextNode.width &&
    prev.height === nextNode.height &&
    prev.zIndex === nextNode.zIndex &&
    JSON.stringify(prev.data) === JSON.stringify(nextNode.data);
  if (same) {
    return { nodes, changed: false };
  }

  const nextNodes = [...nodes];
  nextNodes[idx] = { ...prev, ...nextNode };
  return { nodes: nextNodes, changed: true };
}

function getDefinitionRectPosition(origin: { x: number; y: number }, rect: BlueprintDefinition['input_slots'][number]['rect']): { x: number; y: number } {
  return { x: origin.x + rect.x, y: origin.y + rect.y };
}

function inferBlueprintInstanceOrigin(
  containerNode: FlowNode,
  definition: BlueprintDefinition,
  flowNodes: FlowNode[],
): { x: number; y: number } {
  const instanceId = containerNode.data.meta?.blueprint_instance_id;
  if (!instanceId) {
    return { x: containerNode.position.x + 28, y: containerNode.position.y + 64 };
  }

  const candidates = flowNodes.filter(node =>
    node.id !== containerNode.id &&
    node.data.meta?.blueprint_instance_id === instanceId
  );

  for (const slot of [...definition.input_slots, ...definition.output_slots]) {
    const match = candidates.find(node =>
      node.data.meta?.blueprint_placeholder_slot_id === slot.id
    );
    if (match) {
      return {
        x: match.position.x - slot.rect.x,
        y: match.position.y - slot.rect.y,
      };
    }
  }

  for (const fnNode of definition.function_nodes) {
    const match = candidates.find(node =>
      node.data.meta?.blueprint_source_kind === 'function_node' &&
      node.data.meta?.blueprint_source_id === fnNode.id
    );
    if (match) {
      return {
        x: match.position.x - fnNode.rect.x,
        y: match.position.y - fnNode.rect.y,
      };
    }
  }

  for (const dataNode of definition.data_nodes) {
    const match = candidates.find(node =>
      node.data.meta?.blueprint_source_kind === 'data_node' &&
      node.data.meta?.blueprint_source_id === dataNode.id
    );
    if (match) {
      return {
        x: match.position.x - dataNode.rect.x,
        y: match.position.y - dataNode.rect.y,
      };
    }
  }

  return { x: containerNode.position.x + 28, y: containerNode.position.y + 64 };
}

function findMatchingBlueprintFunctionFlowNode(
  instanceId: string,
  nodeDef: BlueprintDefinition['function_nodes'][number],
  origin: { x: number; y: number },
  nodes: FlowNode[],
  usedIds: Set<string>,
): FlowNode | undefined {
  const expected = getDefinitionRectPosition(origin, nodeDef.rect);
  const candidates = nodes.filter(node =>
    !usedIds.has(node.id) &&
    node.data.meta?.blueprint_instance_id === instanceId &&
    node.data.node_type === 'function'
  );

  let best: { node: FlowNode; score: number } | undefined;
  for (const candidate of candidates) {
    const meta = candidate.data.meta ?? {};
    const exactSource = meta.blueprint_source_kind === 'function_node' && meta.blueprint_source_id === nodeDef.id;
    const sameTool = meta.ai_tool === nodeDef.tool_id;
    const sameTitle = candidate.data.title === nodeDef.title;
    if (!exactSource && !sameTool && !sameTitle) { continue; }

    const distance = Math.hypot(candidate.position.x - expected.x, candidate.position.y - expected.y);
    const score =
      (exactSource ? -100000 : 0) +
      (sameTool ? 0 : 5000) +
      (sameTitle ? 0 : 500) +
      distance;
    if (!best || score < best.score) {
      best = { node: candidate, score };
    }
  }

  return best?.node;
}

function findMatchingBlueprintDataFlowNode(
  instanceId: string,
  nodeDef: BlueprintDefinition['data_nodes'][number],
  origin: { x: number; y: number },
  nodes: FlowNode[],
  usedIds: Set<string>,
): FlowNode | undefined {
  const expected = getDefinitionRectPosition(origin, nodeDef.rect);
  const candidates = nodes.filter(node =>
    !usedIds.has(node.id) &&
    node.data.meta?.blueprint_instance_id === instanceId &&
    node.data.node_type === nodeDef.node_type
  );

  let best: { node: FlowNode; score: number } | undefined;
  for (const candidate of candidates) {
    const meta = candidate.data.meta ?? {};
    const exactSource = meta.blueprint_source_kind === 'data_node' && meta.blueprint_source_id === nodeDef.id;
    const sameTitle = candidate.data.title === nodeDef.title;
    if (!exactSource && !sameTitle) { continue; }

    const distance = Math.hypot(candidate.position.x - expected.x, candidate.position.y - expected.y);
    const score =
      (exactSource ? -100000 : 0) +
      (sameTitle ? 0 : 500) +
      distance;
    if (!best || score < best.score) {
      best = { node: candidate, score };
    }
  }

  return best?.node;
}

function migrateBlueprintInstancesAgainstDefinitions(
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  definitions: BlueprintDefinitionEnvelope[],
  blueprintIndex: BlueprintRegistryEntry[],
  toolDefs: JsonToolDef[],
): { nodes: FlowNode[]; edges: FlowEdge[]; changed: boolean } {
  if (definitions.length === 0) {
    return { nodes: flowNodes, edges: flowEdges, changed: false };
  }

  const entryByPath = new Map(blueprintIndex.map(entry => [entry.file_path, entry]));
  const definitionByPath = new Map(definitions.map(item => [item.filePath, item.definition]));
  let nodes = flowNodes;
  let edges = flowEdges;
  let changed = false;
  const changedInstanceIds = new Set<string>();

  for (const containerNode of nodes.filter(node => isBlueprintInstanceContainerNode(node.data))) {
    const instanceId = containerNode.data.meta?.blueprint_instance_id;
    const filePath = containerNode.data.meta?.blueprint_file_path;
    if (!instanceId || !filePath) { continue; }

    const rawDefinition = definitionByPath.get(filePath);
    if (!rawDefinition) { continue; }
    const definition = synthesizeImplicitBlueprintOutputSlots(rawDefinition);
    const entry = entryByPath.get(filePath);
    const origin = inferBlueprintInstanceOrigin(containerNode, definition, nodes);
    const usedNodeIds = new Set<string>();
    const slotNodeById = new Map<string, FlowNode>();
    const functionNodeById = new Map<string, FlowNode>();
    const dataNodeById = new Map<string, FlowNode>();
    const validInputSlotIds = new Set(definition.input_slots.map(slot => slot.id));
    const validOutputSlotIds = new Set(definition.output_slots.map(slot => slot.id));
    const inputSlotMap = new Map(definition.input_slots.map(slot => [slot.id, slot]));
    const outputSlotMap = new Map(definition.output_slots.map(slot => [slot.id, slot]));
    const expectedInstanceEdges: FlowEdge[] = [];
    let instanceChanged = false;

    for (const slot of definition.input_slots) {
      const existingPlaceholder = nodes.find(node =>
        node.data.meta?.blueprint_instance_id === instanceId &&
        node.data.meta?.blueprint_placeholder_kind === 'input' &&
        node.data.meta?.blueprint_placeholder_slot_id === slot.id
      );

      if (existingPlaceholder) {
        const expectedNode = createBlueprintPlaceholderNode(slot, instanceId, definition, getDefinitionRectPosition(origin, slot.rect));
        expectedNode.id = existingPlaceholder.id;
        const result = upsertFlowNode(nodes, createFlowNodeFromCanvasNode(expectedNode));
        nodes = result.nodes;
        changed = changed || result.changed;
        instanceChanged = instanceChanged || result.changed;
        slotNodeById.set(slot.id, result.nodes.find(node => node.id === expectedNode.id) ?? createFlowNodeFromCanvasNode(expectedNode));
        usedNodeIds.add(expectedNode.id);
      } else {
        const createdNode = createBlueprintPlaceholderNode(slot, instanceId, definition, getDefinitionRectPosition(origin, slot.rect));
        const result = upsertFlowNode(nodes, createFlowNodeFromCanvasNode(createdNode));
        nodes = result.nodes;
        changed = changed || result.changed;
        instanceChanged = instanceChanged || result.changed;
        slotNodeById.set(slot.id, result.nodes.find(node => node.id === createdNode.id) ?? createFlowNodeFromCanvasNode(createdNode));
        usedNodeIds.add(createdNode.id);
      }
    }

    for (const slot of definition.output_slots) {
      const existingPlaceholder = nodes.find(node =>
        node.data.meta?.blueprint_instance_id === instanceId &&
        node.data.meta?.blueprint_placeholder_kind === 'output' &&
        node.data.meta?.blueprint_placeholder_slot_id === slot.id
      );

      if (existingPlaceholder) {
        const expectedNode = createBlueprintPlaceholderNode(slot, instanceId, definition, getDefinitionRectPosition(origin, slot.rect));
        expectedNode.id = existingPlaceholder.id;
        const result = upsertFlowNode(nodes, createFlowNodeFromCanvasNode(expectedNode));
        nodes = result.nodes;
        changed = changed || result.changed;
        instanceChanged = instanceChanged || result.changed;
        slotNodeById.set(slot.id, result.nodes.find(node => node.id === expectedNode.id) ?? createFlowNodeFromCanvasNode(expectedNode));
        usedNodeIds.add(expectedNode.id);
      } else {
        const createdNode = createBlueprintPlaceholderNode(slot, instanceId, definition, getDefinitionRectPosition(origin, slot.rect));
        const result = upsertFlowNode(nodes, createFlowNodeFromCanvasNode(createdNode));
        nodes = result.nodes;
        changed = changed || result.changed;
        instanceChanged = instanceChanged || result.changed;
        slotNodeById.set(slot.id, result.nodes.find(node => node.id === createdNode.id) ?? createFlowNodeFromCanvasNode(createdNode));
        usedNodeIds.add(createdNode.id);
      }
    }

    for (const fnNode of definition.function_nodes) {
      const matched = findMatchingBlueprintFunctionFlowNode(instanceId, fnNode, origin, nodes, usedNodeIds);
      if (matched) {
        const currentMeta = matched.data.meta ?? {};
        const mergedNode = normalizeFunctionNodeAgainstToolDefs({
          ...matched.data,
          meta: {
            ...currentMeta,
            ai_tool: fnNode.tool_id,
            ai_provider: fnNode.provider ?? currentMeta.ai_provider,
            ai_model: fnNode.model ?? currentMeta.ai_model,
            param_values: {
              ...(fnNode.param_values ?? {}),
              ...((currentMeta.param_values ?? {}) as Record<string, unknown>),
            },
            fn_status: currentMeta.fn_status ?? 'idle',
            blueprint_instance_id: instanceId,
            blueprint_def_id: definition.id,
            blueprint_color: definition.color,
            blueprint_source_kind: 'function_node',
            blueprint_source_id: fnNode.id,
          },
        }, toolDefs);
        const result = upsertFlowNode(nodes, createFlowNodeFromCanvasNode(mergedNode));
        nodes = result.nodes;
        changed = changed || result.changed;
        instanceChanged = instanceChanged || result.changed;
        functionNodeById.set(fnNode.id, result.nodes.find(node => node.id === matched.id) ?? createFlowNodeFromCanvasNode(mergedNode));
        usedNodeIds.add(matched.id);
      } else {
        const createdNode = normalizeFunctionNodeAgainstToolDefs(
          createBlueprintFunctionCanvasNode(fnNode, instanceId, definition, toolDefs, getDefinitionRectPosition(origin, fnNode.rect)),
          toolDefs,
        );
        const result = upsertFlowNode(nodes, createFlowNodeFromCanvasNode(createdNode));
        nodes = result.nodes;
        changed = changed || result.changed;
        instanceChanged = instanceChanged || result.changed;
        functionNodeById.set(fnNode.id, result.nodes.find(node => node.id === createdNode.id) ?? createFlowNodeFromCanvasNode(createdNode));
        usedNodeIds.add(createdNode.id);
      }
    }

    for (const dataNode of definition.data_nodes) {
      const matched = findMatchingBlueprintDataFlowNode(instanceId, dataNode, origin, nodes, usedNodeIds);
      if (matched) {
        const mergedNode: CanvasNode = {
          ...matched.data,
          meta: {
            ...(matched.data.meta ?? {}),
            blueprint_instance_id: instanceId,
            blueprint_def_id: definition.id,
            blueprint_color: definition.color,
            blueprint_source_kind: 'data_node',
            blueprint_source_id: dataNode.id,
          },
        };
        const result = upsertFlowNode(nodes, createFlowNodeFromCanvasNode(mergedNode));
        nodes = result.nodes;
        changed = changed || result.changed;
        instanceChanged = instanceChanged || result.changed;
        dataNodeById.set(dataNode.id, result.nodes.find(node => node.id === matched.id) ?? createFlowNodeFromCanvasNode(mergedNode));
        usedNodeIds.add(matched.id);
      } else {
        const createdNode = createBlueprintInternalDataNode(dataNode, instanceId, definition, getDefinitionRectPosition(origin, dataNode.rect));
        const result = upsertFlowNode(nodes, createFlowNodeFromCanvasNode(createdNode));
        nodes = result.nodes;
        changed = changed || result.changed;
        instanceChanged = instanceChanged || result.changed;
        dataNodeById.set(dataNode.id, result.nodes.find(node => node.id === createdNode.id) ?? createFlowNodeFromCanvasNode(createdNode));
        usedNodeIds.add(createdNode.id);
      }
    }

    for (const edge of definition.edges) {
      const sourceNode = edge.source.kind === 'input_slot' || edge.source.kind === 'output_slot'
        ? slotNodeById.get(edge.source.id)
        : edge.source.kind === 'function_node'
          ? functionNodeById.get(edge.source.id)
          : dataNodeById.get(edge.source.id);
      const targetNode = edge.target.kind === 'input_slot' || edge.target.kind === 'output_slot'
        ? slotNodeById.get(edge.target.id)
        : edge.target.kind === 'function_node'
          ? functionNodeById.get(edge.target.id)
          : dataNodeById.get(edge.target.id);
      if (!sourceNode || !targetNode) { continue; }

      const nextEdge: FlowEdge = {
        id: uuid(),
        source: sourceNode.id,
        target: targetNode.id,
        type: edge.edge_type === 'pipeline_flow' ? 'pipeline' : 'custom',
        data: {
          edge_type: edge.edge_type === 'pipeline_flow' ? 'pipeline_flow' : (
            edge.source.kind === 'function_node' && edge.target.kind === 'output_slot'
              ? 'ai_generated'
              : 'data_flow'
          ),
          role: edge.role,
        },
      };
      expectedInstanceEdges.push(nextEdge);
      if (edges.some(existing => sameEdgeSemantics(existing, nextEdge))) {
        continue;
      }
      edges = [...edges, nextEdge];
      changed = true;
      instanceChanged = true;
    }

    const staleInternalNodeIds = new Set(
      nodes
        .filter(node =>
          node.id !== containerNode.id &&
          node.data.meta?.blueprint_instance_id === instanceId &&
          node.data.meta?.blueprint_runtime_hidden !== true &&
          !usedNodeIds.has(node.id)
        )
        .map(node => node.id),
    );
    if (staleInternalNodeIds.size > 0) {
      nodes = nodes.filter(node => !staleInternalNodeIds.has(node.id));
      changed = true;
      instanceChanged = true;
    }

    let reboundLegacyBoundNode = false;
    nodes = nodes.map(node => {
      if (node.data.meta?.blueprint_bound_instance_id !== instanceId || !node.data.meta?.blueprint_bound_slot_kind) {
        return node;
      }

      const slotKind = node.data.meta.blueprint_bound_slot_kind;
      const slotRef = resolveCompatibleBlueprintSlotReference(
        slotKind === 'input' ? inputSlotMap : outputSlotMap,
        slotKind,
        node.data.meta.blueprint_bound_slot_id,
        node.data.meta.blueprint_bound_slot_title,
      );
      if (!slotRef || slotRef.slotId === node.data.meta.blueprint_bound_slot_id) {
        return node;
      }

      reboundLegacyBoundNode = true;
      return {
        ...node,
        data: {
          ...node.data,
          meta: {
            ...(node.data.meta ?? {}),
            blueprint_bound_slot_id: slotRef.slotId,
            blueprint_bound_slot_title: slotRef.slotDef.title,
          },
        },
      };
    });
    if (reboundLegacyBoundNode) {
      changed = true;
      instanceChanged = true;
    }

    const invalidBoundNodeIds = new Set(
      nodes
        .filter(node =>
          node.data.meta?.blueprint_bound_instance_id === instanceId
        )
        .filter(node => {
          const slotId = node.data.meta?.blueprint_bound_slot_id;
          const slotKind = node.data.meta?.blueprint_bound_slot_kind;
          if (!slotId || !slotKind) { return true; }
          return slotKind === 'input'
            ? !validInputSlotIds.has(slotId)
            : !validOutputSlotIds.has(slotId);
        })
        .map(node => node.id),
    );
    if (invalidBoundNodeIds.size > 0) {
      nodes = nodes.map(node => {
        if (!invalidBoundNodeIds.has(node.id)) { return node; }
        const meta = { ...(node.data.meta ?? {}) };
        delete meta.blueprint_bound_instance_id;
        delete meta.blueprint_bound_slot_id;
        delete meta.blueprint_bound_slot_title;
        delete meta.blueprint_bound_slot_kind;
        return {
          ...node,
          data: {
            ...node.data,
            meta,
          },
        };
      });
      changed = true;
      instanceChanged = true;
    }

    const activeInternalInstanceNodeIds = new Set(
      nodes
        .filter(node =>
          node.id !== containerNode.id &&
          node.data.meta?.blueprint_instance_id === instanceId
        )
        .map(node => node.id),
    );
    const activeBoundInstanceNodeIds = new Set(
      nodes
        .filter(node =>
          node.data.meta?.blueprint_bound_instance_id === instanceId
        )
        .map(node => node.id),
    );
    const nextEdges: FlowEdge[] = [];
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    let instanceEdgePruned = false;
    for (const edge of edges) {
      if (staleInternalNodeIds.has(edge.source) || staleInternalNodeIds.has(edge.target)) {
        instanceEdgePruned = true;
        continue;
      }
      const touchesActiveBlueprintStructure =
        activeInternalInstanceNodeIds.has(edge.source) ||
        activeInternalInstanceNodeIds.has(edge.target) ||
        activeBoundInstanceNodeIds.has(edge.source) ||
        activeBoundInstanceNodeIds.has(edge.target);
      if (!touchesActiveBlueprintStructure) {
        nextEdges.push(edge);
        continue;
      }
      const keepExpectedEdge = expectedInstanceEdges.some(expected => sameEdgeSemantics(expected, edge));
      const keepRuntimeSupportEdge = isBlueprintRuntimeSupportEdgeForInstance(edge, instanceId, nodeById);
      if (!keepExpectedEdge && !keepRuntimeSupportEdge) {
        instanceEdgePruned = true;
        continue;
      }
      if (nextEdges.some(existing => sameEdgeSemantics(existing, edge))) {
        instanceEdgePruned = true;
        continue;
      }
      nextEdges.push(edge);
    }
    if (instanceEdgePruned) {
      edges = nextEdges;
      changed = true;
      instanceChanged = true;
    }

    const currentContainer = nodes.find(node => node.id === containerNode.id) ?? containerNode;
    const nextContainer = syncBlueprintNodeFromDefinition(currentContainer, filePath, definition);
    const result = upsertFlowNode(nodes, nextContainer);
    nodes = result.nodes;
    changed = changed || result.changed;
    instanceChanged = instanceChanged || result.changed;

    if (instanceChanged) {
      changedInstanceIds.add(instanceId);
    }
  }

  if (changedInstanceIds.size > 0) {
    nodes = recalcBlueprintContainersForInstanceIds(nodes, changedInstanceIds);
  }

  return { nodes, edges, changed };
}

function preferredPlaceholderNodeType(slot: BlueprintSlotDef): CanvasNode['node_type'] {
  if (slot.kind === 'output') { return 'ai_output'; }
  const preferred = slot.accepts[0];
  if (preferred === 'paper' || preferred === 'image' || preferred === 'audio' || preferred === 'video') {
    return 'note';
  }
  return preferred ?? 'note';
}

function getBlueprintPlaceholderSize(slot: BlueprintSlotDef): { width: number; height: number } {
  if (slot.kind === 'input') {
    return {
      width: Math.max(250, Math.min(300, slot.rect.width || 0)),
      height: Math.max(150, Math.min(210, slot.rect.height || 0)),
    };
  }
  return {
    width: 240,
    height: 136,
  };
}

function createBlueprintPlaceholderNodeBase(
  slot: BlueprintSlotDef,
  instanceId: string,
  blueprintDefId: string | undefined,
  blueprintColor: string | undefined,
  position: { x: number; y: number },
): CanvasNode {
  const nodeType = preferredPlaceholderNodeType(slot);
  const placeholderSize = getBlueprintPlaceholderSize(slot);
  return {
    id: uuid(),
    node_type: nodeType,
    title: slot.kind === 'input' ? '输入占位' : '输出占位',
    position,
    size: {
      width: placeholderSize.width,
      height: placeholderSize.height,
    },
    meta: {
      blueprint_instance_id: instanceId,
      blueprint_def_id: blueprintDefId,
      blueprint_color: blueprintColor,
      blueprint_placeholder_kind: slot.kind === 'input' ? 'input' : 'output',
      blueprint_placeholder_slot_id: slot.id,
      blueprint_placeholder_title: slot.title,
      blueprint_placeholder_accepts: [...slot.accepts],
      blueprint_placeholder_required: slot.required,
      blueprint_placeholder_allow_multiple: slot.allow_multiple,
      blueprint_placeholder_replacement_mode: slot.replacement_mode,
      blueprint_placeholder_hint: slot.binding_hint,
      content_preview: slot.binding_hint ?? (slot.kind === 'input'
        ? '请将外部节点直接连到此输入占位，作为蓝图实例输入传递。'
        : '运行完成后，最终输出会优先回填到此占位位置。'),
      card_content_mode: 'preview',
    },
  };
}

function createBlueprintPlaceholderNode(
  slot: BlueprintSlotDef,
  instanceId: string,
  definition: BlueprintDefinition,
  position: { x: number; y: number },
): CanvasNode {
  return createBlueprintPlaceholderNodeBase(slot, instanceId, definition.id, definition.color, position);
}

function createBlueprintPlaceholderNodeFromContainer(
  slot: BlueprintSlotDef,
  containerNode: CanvasNode,
  position: { x: number; y: number },
): CanvasNode {
  return createBlueprintPlaceholderNodeBase(
    slot,
    containerNode.meta?.blueprint_instance_id ?? '',
    containerNode.meta?.blueprint_def_id,
    containerNode.meta?.blueprint_color,
    position,
  );
}

function buildImplicitBlueprintOutputSlotId(sourceFunctionId: string): string {
  return `output_${sourceFunctionId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function buildImplicitBlueprintOutputTitle(sourceFunctionTitle: string | undefined): string {
  const normalizedTitle = sourceFunctionTitle?.trim();
  return normalizedTitle ? `输出结果 · ${normalizedTitle}` : '输出结果';
}

function resolveCompatibleBlueprintSlotReference(
  slotMap: Map<string, BlueprintSlotDef>,
  slotKind: 'input' | 'output',
  slotId: string | undefined,
  slotTitle: string | undefined,
): { slotId: string; slotDef: BlueprintSlotDef } | undefined {
  if (!slotId || slotMap.size === 0) { return undefined; }

  const direct = slotMap.get(slotId);
  if (direct) {
    return { slotId, slotDef: direct };
  }

  if (slotKind === 'output') {
    const implicitMatches = Array.from(slotMap.values()).filter(slot =>
      !!slot.source_function_node_id &&
      buildImplicitBlueprintOutputSlotId(slot.source_function_node_id) === slotId,
    );
    if (implicitMatches.length === 1) {
      const match = implicitMatches[0];
      return { slotId: match.id, slotDef: match };
    }
  }

  const normalizedTitle = slotTitle?.trim();
  if (!normalizedTitle) { return undefined; }
  const titleMatches = Array.from(slotMap.values()).filter(slot => slot.title.trim() === normalizedTitle);
  if (titleMatches.length === 1) {
    const match = titleMatches[0];
    return { slotId: match.id, slotDef: match };
  }

  return undefined;
}

function synthesizeImplicitBlueprintOutputSlots(definition: BlueprintDefinition): BlueprintDefinition {
  if (definition.output_slots.length > 0) { return definition; }

  const explicitOutputSourceFnIds = new Set(
    definition.output_slots
      .map(slot => slot.source_function_node_id)
      .filter((value): value is string => !!value),
  );
  const producedDataNodeIds = new Set(
    definition.data_nodes
      .map(node => node.source_function_node_id)
      .filter((value): value is string => !!value),
  );
  const downstreamPipelineSourceIds = new Set(
    definition.edges
      .filter(edge => edge.edge_type === 'pipeline_flow' && edge.source.kind === 'function_node')
      .map(edge => edge.source.id),
  );

  const syntheticOutputSlots: BlueprintSlotDef[] = [];
  for (const fnNode of definition.function_nodes) {
    if (explicitOutputSourceFnIds.has(fnNode.id)) { continue; }
    if (downstreamPipelineSourceIds.has(fnNode.id)) { continue; }
    if (producedDataNodeIds.has(fnNode.id)) { continue; }

    syntheticOutputSlots.push({
      id: buildImplicitBlueprintOutputSlotId(fnNode.id),
      kind: 'output',
      title: buildImplicitBlueprintOutputTitle(fnNode.title),
      required: false,
      allow_multiple: false,
      accepts: ['ai_output'],
      source_function_node_id: fnNode.id,
      placeholder_style: 'output_placeholder',
      replacement_mode: 'attach_by_edge',
      binding_hint: '蓝图运行完成后，最终输出会优先回填到该占位位置。',
      rect: {
        x: fnNode.rect.x + fnNode.rect.width + 60,
        y: fnNode.rect.y + Math.max((fnNode.rect.height - 136) / 2, 0),
        width: 240,
        height: 136,
      },
    });
  }

  if (syntheticOutputSlots.length === 0) { return definition; }

  const syntheticEdges: BlueprintEdgeDef[] = syntheticOutputSlots
    .map(slot => slot.source_function_node_id ? {
      id: uuid(),
      edge_type: 'data_flow' as const,
      source: { kind: 'function_node' as const, id: slot.source_function_node_id },
      target: { kind: 'output_slot' as const, id: slot.id },
    } : null)
    .filter((edge): edge is BlueprintEdgeDef => !!edge);

  return {
    ...definition,
    output_slots: [...definition.output_slots, ...syntheticOutputSlots],
    edges: [...definition.edges, ...syntheticEdges],
  };
}

function createBlueprintInternalDataNode(
  nodeDef: BlueprintDataNodeDef,
  instanceId: string,
  definition: BlueprintDefinition,
  position: { x: number; y: number },
): CanvasNode {
  const nodeType = nodeDef.node_type;
  return {
    id: uuid(),
    node_type: nodeType,
    title: nodeDef.title,
    position,
    size: {
      width: Math.max(180, nodeDef.rect.width || DEFAULT_SIZES[nodeType].width),
      height: Math.max(120, nodeDef.rect.height || DEFAULT_SIZES[nodeType].height),
    },
    meta: {
      blueprint_instance_id: instanceId,
      blueprint_def_id: definition.id,
      blueprint_color: definition.color,
      blueprint_source_kind: 'data_node',
      blueprint_source_id: nodeDef.id,
      content_preview: `蓝图内部节点：${nodeDef.title}`,
      card_content_mode: 'preview',
    },
  };
}

function createBlueprintFunctionCanvasNode(
  nodeDef: BlueprintDefinition['function_nodes'][number],
  instanceId: string,
  definition: BlueprintDefinition,
  toolDefs: JsonToolDef[],
  position: { x: number; y: number },
): CanvasNode {
  const toolDef = toolDefs.find(tool => tool.id === nodeDef.tool_id);
  return {
    id: uuid(),
    node_type: 'function',
    title: nodeDef.title,
    position,
    size: {
      width: Math.max(260, nodeDef.rect.width || DEFAULT_SIZES.function.width),
      height: Math.max(220, nodeDef.rect.height || DEFAULT_SIZES.function.height),
    },
    meta: {
      ai_tool: nodeDef.tool_id,
      ai_provider: nodeDef.provider,
      ai_model: nodeDef.model,
      input_schema: toolDef?.params,
      param_values: nodeDef.param_values ? { ...nodeDef.param_values } : {},
      fn_status: 'idle',
      blueprint_instance_id: instanceId,
      blueprint_def_id: definition.id,
      blueprint_color: definition.color,
      blueprint_source_kind: 'function_node',
      blueprint_source_id: nodeDef.id,
    },
  };
}

function buildBlueprintInstanceArtifacts(
  entry: BlueprintRegistryEntry,
  definition: BlueprintDefinition,
  toolDefs: JsonToolDef[],
  origin: { x: number; y: number },
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const normalizedDefinition = synthesizeImplicitBlueprintOutputSlots(definition);
  const instanceId = uuid();
  const nodeIdByBlueprintRef = new Map<string, string>();
  const instantiatedNodes: CanvasNode[] = [];

  for (const slot of normalizedDefinition.input_slots) {
    const node = createBlueprintPlaceholderNode(slot, instanceId, definition, {
      x: origin.x + slot.rect.x,
      y: origin.y + slot.rect.y,
    });
    nodeIdByBlueprintRef.set(`input_slot:${slot.id}`, node.id);
    instantiatedNodes.push(node);
  }

  for (const slot of normalizedDefinition.output_slots) {
    const node = createBlueprintPlaceholderNode(slot, instanceId, definition, {
      x: origin.x + slot.rect.x,
      y: origin.y + slot.rect.y,
    });
    nodeIdByBlueprintRef.set(`output_slot:${slot.id}`, node.id);
    instantiatedNodes.push(node);
  }

  for (const dataNode of normalizedDefinition.data_nodes) {
    const node = createBlueprintInternalDataNode(dataNode, instanceId, definition, {
      x: origin.x + dataNode.rect.x,
      y: origin.y + dataNode.rect.y,
    });
    nodeIdByBlueprintRef.set(`data_node:${dataNode.id}`, node.id);
    instantiatedNodes.push(node);
  }

  for (const fnNode of normalizedDefinition.function_nodes) {
    const node = createBlueprintFunctionCanvasNode(fnNode, instanceId, definition, toolDefs, {
      x: origin.x + fnNode.rect.x,
      y: origin.y + fnNode.rect.y,
    });
    nodeIdByBlueprintRef.set(`function_node:${fnNode.id}`, node.id);
    instantiatedNodes.push(node);
  }

  const containerBounds = computeBlueprintContainerBounds(instantiatedNodes);
  const containerNode = createBlueprintContainerCanvasNode(entry, normalizedDefinition, instanceId, containerBounds);
  instantiatedNodes.push(containerNode);

  const flowNodes: FlowNode[] = instantiatedNodes.map(node => ({
    id: node.id,
    type: nodeTypeToFlowType(node.node_type),
    position: node.position,
    data: node,
    width: node.size.width,
    height: node.size.height,
    zIndex: isBlueprintInstanceContainerNode(node) ? BLUEPRINT_CONTAINER_Z_INDEX : undefined,
    hidden: isBlueprintInstanceContainerNode(node),
  }));

  const flowEdges: FlowEdge[] = [];
  for (const edge of normalizedDefinition.edges) {
    const sourceId = nodeIdByBlueprintRef.get(`${edge.source.kind}:${edge.source.id}`);
    const targetId = nodeIdByBlueprintRef.get(`${edge.target.kind}:${edge.target.id}`);
    if (!sourceId || !targetId) { continue; }
    flowEdges.push({
      id: uuid(),
      source: sourceId,
      target: targetId,
      type: edge.edge_type === 'pipeline_flow' ? 'pipeline' : 'custom',
      data: {
        edge_type: edge.edge_type === 'pipeline_flow' ? 'pipeline_flow' : (
          edge.source.kind === 'function_node' && edge.target.kind === 'output_slot'
            ? 'ai_generated'
            : 'data_flow'
        ),
        role: edge.role,
      },
      animated: false,
    });
  }

  return { nodes: flowNodes, edges: flowEdges };
}

function markPersistedFromExternal(file: CanvasFile) {
  lastPersistedSerialized = serializeCanvasFile(file);
  inFlightSavePayloads.clear();
}

function reconcileSaveStateAfterSaveAck(savedAt?: number) {
  const currentSerialized = serializeCanvasFile(useCanvasStore.getState().canvasFile);
  if (inFlightSavePayloads.size > 0) {
    useCanvasStore.setState({
      saveState: 'saving',
      saveDueAt: null,
      lastSavedAt: savedAt ?? Date.now(),
      saveError: null,
    });
    return;
  }

  if (currentSerialized && currentSerialized !== lastPersistedSerialized) {
    markCanvasDirty();
    useCanvasStore.setState({ lastSavedAt: savedAt ?? Date.now() });
    return;
  }

  useCanvasStore.setState({
    saveState: 'saved',
    saveDueAt: null,
    lastSavedAt: savedAt ?? Date.now(),
    saveError: null,
  });
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
  const immediate = syncMode === 'immediate';
  syncCanvasState(file, immediate);
  if (immediate) {
    dispatchSave('auto', file);
    return;
  }
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
let _blueprintDragMembers = new Set<string>();

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

export function startBlueprintDrag(instanceId: string, nodes: FlowNode[]) {
  _blueprintDragMembers = new Set(
    nodes
      .filter(node => node.data.meta?.blueprint_instance_id === instanceId)
      .map(node => node.id)
  );
}

export function endBlueprintDrag() {
  _blueprintDragMembers = new Set();
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
  bumpInitialCanvasGroupBoundsRecalc();
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

function getBlueprintContainerMemberIds(instanceId: string, nodes: FlowNode[]): string[] {
  return nodes
    .filter(node =>
      node.data.id !== undefined &&
      node.data.meta?.blueprint_instance_id === instanceId &&
      !isBlueprintInstanceContainerNode(node.data)
    )
    .map(node => node.id);
}

function getBlueprintContainerBoundExternalIds(instanceId: string, nodes: FlowNode[]): string[] {
  return nodes
    .filter(node =>
      node.data.meta?.blueprint_bound_instance_id === instanceId &&
      node.data.meta?.blueprint_instance_id !== instanceId
    )
    .map(node => node.id);
}

function recalcBlueprintContainersForInstanceIds(
  nodes: FlowNode[],
  instanceIds: Iterable<string>,
): FlowNode[] {
  const changedInstanceIds = Array.from(new Set(Array.from(instanceIds).filter(Boolean)));
  if (changedInstanceIds.length === 0) { return nodes; }
  const targetSet = new Set(changedInstanceIds);

  return nodes.map(node => {
    if (!isBlueprintInstanceContainerNode(node.data)) { return node; }
    const instanceId = node.data.meta?.blueprint_instance_id;
    if (!instanceId || !targetSet.has(instanceId)) { return node; }

    const memberNodes = nodes.filter(candidate =>
      candidate.id !== node.id &&
      candidate.data.meta?.blueprint_instance_id === instanceId
    );
    if (memberNodes.length === 0) { return node; }

    const bounds = computeBlueprintContainerBoundsFromFlowNodes(memberNodes);
    return {
      ...node,
      position: { x: bounds.x, y: bounds.y },
      data: {
        ...node.data,
        position: { x: bounds.x, y: bounds.y },
        size: { width: bounds.width, height: bounds.height },
      },
      width: bounds.width,
      height: bounds.height,
      zIndex: BLUEPRINT_CONTAINER_Z_INDEX,
    };
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

function sameEdgeSemantics(a: FlowEdge, b: FlowEdge): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    normalizeNodePortId(a.sourceHandle) === normalizeNodePortId(b.sourceHandle) &&
    normalizeNodePortId(a.targetHandle) === normalizeNodePortId(b.targetHandle) &&
    (a.data?.edge_type ?? 'reference') === (b.data?.edge_type ?? 'reference') &&
    (a.data?.role ?? '') === (b.data?.role ?? '')
  );
}

function sameCanvasEdgeSemantics(a: CanvasEdge, b: CanvasEdge): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    normalizeNodePortId(a.sourceHandle) === normalizeNodePortId(b.sourceHandle) &&
    normalizeNodePortId(a.targetHandle) === normalizeNodePortId(b.targetHandle) &&
    (a.edge_type ?? 'reference') === (b.edge_type ?? 'reference') &&
    (a.role ?? '') === (b.role ?? '')
  );
}

function isBlueprintSlotDataFlowEdge(edge: CanvasEdge): boolean {
  return edge.edge_type === 'data_flow';
}

function isBlueprintRuntimeSupportEdgeForInstance(
  edge: FlowEdge,
  instanceId: string,
  nodeById: Map<string, FlowNode>,
): boolean {
  const sourceNode = nodeById.get(edge.source)?.data;
  const targetNode = nodeById.get(edge.target)?.data;
  if (!sourceNode || !targetNode) { return false; }

  const sourceInternal = sourceNode.meta?.blueprint_instance_id === instanceId;
  const targetInternal = targetNode.meta?.blueprint_instance_id === instanceId;
  const sourceBound = sourceNode.meta?.blueprint_bound_instance_id === instanceId;
  const targetBound = targetNode.meta?.blueprint_bound_instance_id === instanceId;
  const sourceInputPlaceholder = sourceInternal && sourceNode.meta?.blueprint_placeholder_kind === 'input';
  const targetInputPlaceholder = targetInternal && targetNode.meta?.blueprint_placeholder_kind === 'input';
  const sourceOutputPlaceholder = sourceInternal && sourceNode.meta?.blueprint_placeholder_kind === 'output';
  const targetOutputPlaceholder = targetInternal && targetNode.meta?.blueprint_placeholder_kind === 'output';

  if (edge.data?.edge_type === 'ai_generated') {
    return (sourceInternal || sourceBound) && (targetInternal || targetBound);
  }

  if (edge.data?.edge_type === 'data_flow') {
    if (sourceInputPlaceholder || targetInputPlaceholder || sourceOutputPlaceholder || targetOutputPlaceholder) {
      return true;
    }
    if (sourceBound || targetBound) {
      return sourceInternal || targetInternal || sourceBound || targetBound;
    }
  }

  return false;
}

function buildBlueprintRuntimeResultTitle(
  sourceFunctionTitle: string | undefined,
  mode: 'intermediate' | 'output',
  fallbackTitle: string,
): string {
  const normalizedFnTitle = sourceFunctionTitle?.trim();
  if (!normalizedFnTitle) { return fallbackTitle; }
  return mode === 'intermediate'
    ? `中间结果 · ${normalizedFnTitle}`
    : `输出结果 · ${normalizedFnTitle}`;
}

function applyBlueprintOutputFill(
  generatedNode: CanvasNode,
  generatedEdge: CanvasEdge,
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
): { nodes: FlowNode[]; edges: FlowEdge[]; filledInstanceId?: string } {
  const sourceFn = flowNodes.find(node => node.id === generatedEdge.source)?.data;
  const instanceId = sourceFn?.meta?.blueprint_instance_id;

  const appendNormally = (): { nodes: FlowNode[]; edges: FlowEdge[]; filledInstanceId?: string } => ({
    nodes: [...flowNodes, createFlowNodeFromCanvasNode(generatedNode)],
    edges: [
      ...flowEdges,
      {
        id: generatedEdge.id,
        source: generatedEdge.source,
        target: generatedEdge.target,
        type: 'custom',
        data: { edge_type: generatedEdge.edge_type },
        animated: generatedEdge.edge_type === 'ai_generated',
      },
    ],
    filledInstanceId: instanceId,
  });

  if (!sourceFn || !instanceId) {
    return appendNormally();
  }

  const directBlueprintTargets = flowEdges
    .filter(edge =>
      edge.source === generatedEdge.source &&
      (edge.data?.edge_type === 'ai_generated' || edge.data?.edge_type === 'data_flow')
    )
    .map(edge => flowNodes.find(node => node.id === edge.target)?.data)
    .filter((node): node is CanvasNode => !!node);

  const outputPlaceholderNode = directBlueprintTargets.find(node =>
    node.meta?.blueprint_instance_id === instanceId &&
    node.meta?.blueprint_placeholder_kind === 'output'
  );

  const existingBoundOutputNode = directBlueprintTargets.find(node =>
    node.meta?.blueprint_bound_instance_id === instanceId &&
    node.meta?.blueprint_bound_slot_kind === 'output'
  );

  const outputTargetNode = outputPlaceholderNode ?? existingBoundOutputNode;
  const intermediateTargetNode = directBlueprintTargets.find(node =>
    node.meta?.blueprint_instance_id === instanceId &&
    !node.meta?.blueprint_placeholder_kind
  );
  const fillMode: 'output' | 'intermediate' | null = outputTargetNode
    ? 'output'
    : (intermediateTargetNode ? 'intermediate' : null);
  const fillTargetNode = outputTargetNode ?? intermediateTargetNode;

  if (!fillMode || !fillTargetNode) {
    return appendNormally();
  }

  const slotId = fillTargetNode.meta?.blueprint_placeholder_slot_id ?? fillTargetNode.meta?.blueprint_bound_slot_id;
  const slotTitle = fillTargetNode.meta?.blueprint_placeholder_title ?? fillTargetNode.meta?.blueprint_bound_slot_title ?? fillTargetNode.title;
  const outputPlaceholderCarrier = fillMode === 'output' && slotId
    ? (flowNodes.find(node =>
        node.data.meta?.blueprint_instance_id === instanceId &&
        node.data.meta?.blueprint_placeholder_kind === 'output' &&
        node.data.meta?.blueprint_placeholder_slot_id === slotId
      )?.data ?? (outputPlaceholderNode && outputPlaceholderNode.meta?.blueprint_placeholder_slot_id === slotId ? outputPlaceholderNode : undefined))
    : undefined;
  const existingActiveBoundOutputCount = fillMode === 'output' && slotId
    ? flowNodes.filter(node =>
      node.data.meta?.blueprint_bound_instance_id === instanceId &&
      node.data.meta?.blueprint_bound_slot_kind === 'output' &&
      node.data.meta?.blueprint_bound_slot_id === slotId
    ).length
    : 0;
  const anchorNode = fillMode === 'output'
    ? (outputPlaceholderCarrier ?? fillTargetNode)
    : fillTargetNode;
  const filledPosition = fillMode === 'output'
    ? {
      x: anchorNode.position.x + anchorNode.size.width + 72,
      y: anchorNode.position.y + Math.max((anchorNode.size.height - generatedNode.size.height) / 2, 0) + (existingActiveBoundOutputCount * 36),
    }
    : { ...anchorNode.position };
  const filledNode: CanvasNode = {
    ...generatedNode,
    title: fillMode === 'intermediate'
      ? buildBlueprintRuntimeResultTitle(sourceFn.title, 'intermediate', slotTitle ?? generatedNode.title)
      : (slotTitle ?? buildBlueprintRuntimeResultTitle(sourceFn.title, 'output', generatedNode.title)),
    position: filledPosition,
    meta: {
      ...(generatedNode.meta ?? {}),
      ...(fillMode === 'output'
        ? {
            blueprint_bound_instance_id: instanceId,
            blueprint_bound_slot_id: slotId,
            blueprint_bound_slot_title: slotTitle,
            blueprint_bound_slot_kind: 'output' as const,
          }
        : {
            blueprint_instance_id: instanceId,
            blueprint_def_id: sourceFn.meta?.blueprint_def_id,
            blueprint_color: sourceFn.meta?.blueprint_color,
          }),
    },
  };

  const generatedFlowEdge: FlowEdge = {
    id: generatedEdge.id,
    source: generatedEdge.source,
    target: fillMode === 'output' && outputPlaceholderCarrier ? outputPlaceholderCarrier.id : filledNode.id,
    type: 'custom',
    data: { edge_type: generatedEdge.edge_type },
    animated: generatedEdge.edge_type === 'ai_generated',
  };

  if (fillMode === 'output') {
    const placeholderNode = outputPlaceholderCarrier;
    const historicalBoundOutputNodeIds = slotId
      ? new Set(
          flowNodes
            .filter(node =>
              node.data.meta?.blueprint_bound_instance_id === instanceId &&
              node.data.meta?.blueprint_bound_slot_kind === 'output' &&
              node.data.meta?.blueprint_bound_slot_id === slotId
            )
            .map(node => node.id),
        )
      : new Set<string>();

    const nextNodes = flowNodes.concat(createFlowNodeFromCanvasNode(filledNode));

    const nextEdges: FlowEdge[] = [];
    for (const edge of flowEdges) {
      if (
        historicalBoundOutputNodeIds.has(edge.target) &&
        edge.source === generatedEdge.source &&
        (edge.data?.edge_type === 'ai_generated' || edge.data?.edge_type === 'data_flow')
      ) {
        continue;
      }
      if (!nextEdges.some(existing => sameEdgeSemantics(existing, edge))) {
        nextEdges.push(edge);
      }
    }

    if (!nextEdges.some(existing => sameEdgeSemantics(existing, generatedFlowEdge))) {
      nextEdges.push(generatedFlowEdge);
    }

    const bindingEdge: FlowEdge | null = placeholderNode && slotId
      ? {
        id: uuid(),
        source: placeholderNode.id,
        target: filledNode.id,
        type: 'custom',
        data: { edge_type: 'data_flow', role: slotId },
        animated: false,
      }
      : null;
    if (bindingEdge && !nextEdges.some(existing => sameEdgeSemantics(existing, bindingEdge))) {
      nextEdges.push(bindingEdge);
    }

    return { nodes: nextNodes, edges: nextEdges, filledInstanceId: instanceId };
  }

  const nextNodes = flowNodes
    .filter(node => node.id !== fillTargetNode.id)
    .concat(createFlowNodeFromCanvasNode(filledNode));

  const nextEdges: FlowEdge[] = [];
  for (const edge of flowEdges) {
    const touchesFillTarget = edge.source === fillTargetNode.id || edge.target === fillTargetNode.id;
    if (!touchesFillTarget) {
      nextEdges.push(edge);
      continue;
    }

    if (
      edge.source === generatedEdge.source &&
      edge.target === fillTargetNode.id &&
      (edge.data?.edge_type === 'ai_generated' || edge.data?.edge_type === 'data_flow')
    ) {
      continue;
    }

    const reboundEdge: FlowEdge = {
      ...edge,
      id: uuid(),
      source: edge.source === fillTargetNode.id ? filledNode.id : edge.source,
      target: edge.target === fillTargetNode.id ? filledNode.id : edge.target,
    };
    if (reboundEdge.source === reboundEdge.target) {
      continue;
    }
    if (!nextEdges.some(existing => sameEdgeSemantics(existing, reboundEdge))) {
      nextEdges.push(reboundEdge);
    }
  }

  if (!nextEdges.some(existing => sameEdgeSemantics(existing, generatedFlowEdge))) {
    nextEdges.push(generatedFlowEdge);
  }

  return { nodes: nextNodes, edges: nextEdges, filledInstanceId: instanceId };
}

function normalizeNodeGroups(file: CanvasFile): CanvasFile {
  const originalGroups = file.nodeGroups ?? [];
  const nonHubNodes = file.nodes.filter(node => node.node_type !== 'group_hub');
  const nonHubNodeIds = new Set(nonHubNodes.map(node => node.id));
  const nonHubNodeById = new Map(nonHubNodes.map(node => [node.id, node]));

  const calcCanvasNodeGroupBounds = (nodeIds: string[], fallback?: NodeGroup['bounds']): NodeGroup['bounds'] => {
    const members = nodeIds
      .map(nodeId => nonHubNodeById.get(nodeId))
      .filter((node): node is CanvasNode => !!node);
    if (members.length === 0) {
      return fallback ?? { x: 0, y: 0, width: GROUP_MIN_WIDTH, height: GROUP_MIN_HEIGHT };
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const member of members) {
      minX = Math.min(minX, member.position.x);
      minY = Math.min(minY, member.position.y);
      maxX = Math.max(maxX, member.position.x + member.size.width);
      maxY = Math.max(maxY, member.position.y + member.size.height);
    }

    return {
      x: minX - GROUP_PADDING,
      y: minY - GROUP_PADDING,
      width: Math.max(maxX - minX + GROUP_PADDING * 2, GROUP_MIN_WIDTH),
      height: Math.max(maxY - minY + GROUP_PADDING * 2, GROUP_MIN_HEIGHT),
    };
  };

  const normalizedGroups = originalGroups.map(group => {
    const hubNodeId = group.hubNodeId ?? uuid();
    const normalizedNodeIds = Array.from(new Set(
      group.nodeIds.filter(nodeId => nodeId !== hubNodeId && nonHubNodeIds.has(nodeId)),
    ));
    const normalizedBounds = calcCanvasNodeGroupBounds(normalizedNodeIds, group.bounds);

    return {
      ...group,
      hubNodeId,
      nodeIds: normalizedNodeIds,
      bounds: normalizedBounds,
    };
  }).filter(group => group.nodeIds.length > 0);

  if (normalizedGroups.length === 0) {
    const cleanedNodes = nonHubNodes;
    const cleanedEdges = file.edges.filter(edge => edge.edge_type !== 'hub_member');
    if (cleanedNodes.length === file.nodes.length && cleanedEdges.length === file.edges.length) {
      return file;
    }
    return { ...file, nodes: cleanedNodes, edges: cleanedEdges, nodeGroups: normalizedGroups };
  }

  const hubNodeIds = new Set(normalizedGroups.map(group => group.hubNodeId));
  const expectedMemberEdgeKeys = new Set<string>();
  const existingHubById = new Map(
    file.nodes
      .filter(node => node.node_type === 'group_hub' && hubNodeIds.has(node.id))
      .map(node => [node.id, node]),
  );

  const nodes = [...nonHubNodes];
  for (const group of normalizedGroups) {
    const existingHub = existingHubById.get(group.hubNodeId);
    const hubNode = buildHubCanvasNode(group);
    if (existingHub) {
      nodes.push({
        ...existingHub,
        ...hubNode,
        meta: { ...existingHub.meta, ...hubNode.meta },
      });
    } else {
      nodes.push(hubNode);
    }

    for (const memberId of group.nodeIds) {
      expectedMemberEdgeKeys.add(`${memberId}|${group.hubNodeId}`);
    }
  }

  const edges = file.edges.filter(edge => {
    if (edge.edge_type !== 'hub_member') { return true; }
    return expectedMemberEdgeKeys.has(`${edge.source}|${edge.target}`);
  });

  for (const key of expectedMemberEdgeKeys) {
    const [source, target] = key.split('|');
    if (edges.some(edge => edge.edge_type === 'hub_member' && edge.source === source && edge.target === target)) {
      continue;
    }
    edges.push({
      id: uuid(),
      source,
      target,
      edge_type: 'hub_member',
    });
  }

  return { ...file, nodes, edges, nodeGroups: normalizedGroups };
}

function normalizeLegacyBoardArtifacts(file: CanvasFile): CanvasFile {
  const legacyBoardNodes = file.nodes.filter(node => String(node.node_type) === 'board');
  if (legacyBoardNodes.length === 0) {
    return file;
  }

  const existingBoards = file.boards ?? [];
  const existingBoardIds = new Set(existingBoards.map(board => board.id));
  const migratedBoards = [...existingBoards];
  let boardsChanged = false;

  for (const node of legacyBoardNodes) {
    if (existingBoardIds.has(node.id)) {
      boardsChanged = true;
      continue;
    }
    migratedBoards.push({
      id: node.id,
      name: node.title,
      color: (node.meta as Record<string, unknown> | undefined)?.boardColor as string ?? 'rgba(79,195,247,0.12)',
      borderColor: (node.meta as Record<string, unknown> | undefined)?.boardBorderColor as string ?? '#4fc3f7',
      bounds: {
        x: node.position?.x ?? 0,
        y: node.position?.y ?? 0,
        width: Math.max(240, node.size?.width ?? 640),
        height: Math.max(160, node.size?.height ?? 360),
      },
    });
    existingBoardIds.add(node.id);
    boardsChanged = true;
  }

  const legacyBoardNodeIds = new Set(legacyBoardNodes.map(node => node.id));
  const nodes = file.nodes.filter(node => !legacyBoardNodeIds.has(node.id));
  const edges = file.edges.filter(edge => !legacyBoardNodeIds.has(edge.source) && !legacyBoardNodeIds.has(edge.target));

  if (!boardsChanged && nodes.length === file.nodes.length && edges.length === file.edges.length) {
    return file;
  }

  return {
    ...file,
    nodes,
    edges,
    boards: migratedBoards,
  };
}

function normalizeCanvasShellArtifacts(file: CanvasFile): CanvasFile {
  const viewport = file.viewport ?? { x: 0, y: 0, zoom: 1 };
  const normalizedViewport = {
    x: Number.isFinite(viewport.x) ? viewport.x : 0,
    y: Number.isFinite(viewport.y) ? viewport.y : 0,
    zoom: Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? Math.min(Math.max(viewport.zoom, 0.05), 4) : 1,
  };
  const viewportChanged =
    normalizedViewport.x !== viewport.x ||
    normalizedViewport.y !== viewport.y ||
    normalizedViewport.zoom !== viewport.zoom;

  const normalizedBoards: Board[] = [];
  const seenBoardIds = new Set<string>();
  let boardsChanged = false;
  for (const board of file.boards ?? []) {
    const boardId = typeof board.id === 'string' ? board.id.trim() : '';
    if (!boardId || seenBoardIds.has(boardId)) {
      boardsChanged = true;
      continue;
    }
    seenBoardIds.add(boardId);
    const bounds = board.bounds ?? { x: 0, y: 0, width: 640, height: 360 };
    const normalizedBoard: Board = {
      id: boardId,
      name: (typeof board.name === 'string' && board.name.trim()) ? board.name : 'Board',
      color: (typeof board.color === 'string' && board.color.trim()) ? board.color : 'rgba(79,195,247,0.12)',
      borderColor: (typeof board.borderColor === 'string' && board.borderColor.trim()) ? board.borderColor : '#4fc3f7',
      bounds: {
        x: Number.isFinite(bounds.x) ? bounds.x : 0,
        y: Number.isFinite(bounds.y) ? bounds.y : 0,
        width: Number.isFinite(bounds.width) ? Math.max(bounds.width, 240) : 640,
        height: Number.isFinite(bounds.height) ? Math.max(bounds.height, 160) : 360,
      },
    };
    if (JSON.stringify(normalizedBoard) !== JSON.stringify(board)) {
      boardsChanged = true;
    }
    normalizedBoards.push(normalizedBoard);
  }

  for (const legacyGroup of file.summaryGroups ?? []) {
    const groupId = typeof legacyGroup.id === 'string' ? legacyGroup.id.trim() : '';
    if (!groupId || seenBoardIds.has(groupId)) {
      boardsChanged = true;
      continue;
    }
    seenBoardIds.add(groupId);
    const bounds = legacyGroup.bounds ?? { x: 0, y: 0, width: 640, height: 360 };
    normalizedBoards.push({
      id: groupId,
      name: (typeof legacyGroup.name === 'string' && legacyGroup.name.trim()) ? legacyGroup.name : 'Board',
      color: (typeof legacyGroup.color === 'string' && legacyGroup.color.trim()) ? hexToRgba(legacyGroup.color, 0.12) : 'rgba(79,195,247,0.12)',
      borderColor: (typeof legacyGroup.color === 'string' && legacyGroup.color.trim()) ? legacyGroup.color : '#4fc3f7',
      bounds: {
        x: Number.isFinite(bounds.x) ? bounds.x : 0,
        y: Number.isFinite(bounds.y) ? bounds.y : 0,
        width: Number.isFinite(bounds.width) ? Math.max(bounds.width, 240) : 640,
        height: Number.isFinite(bounds.height) ? Math.max(bounds.height, 160) : 360,
      },
    });
    boardsChanged = true;
  }

  const existingNodeIds = new Set(file.nodes.map(node => node.id));
  const normalizedStagingNodes: CanvasNode[] = [];
  const seenStagingIds = new Set<string>();
  let stagingChanged = false;
  for (const node of file.stagingNodes ?? []) {
    const nodeId = typeof node.id === 'string' ? node.id.trim() : '';
    const hasBlueprintResidue =
      !!node.meta?.blueprint_instance_id ||
      !!node.meta?.blueprint_bound_instance_id ||
      !!node.meta?.blueprint_placeholder_kind;
    const invalidNodeType = node.node_type === 'group_hub';
    const collidesWithPlacedNode = existingNodeIds.has(nodeId);
    const collidesWithBoard = seenBoardIds.has(nodeId);
    if (!nodeId || seenStagingIds.has(nodeId) || invalidNodeType || hasBlueprintResidue || collidesWithPlacedNode || collidesWithBoard) {
      stagingChanged = true;
      continue;
    }
    seenStagingIds.add(nodeId);
    normalizedStagingNodes.push(node);
  }

  if (!viewportChanged && !boardsChanged && !stagingChanged) {
    return file;
  }

  return {
    ...file,
    viewport: normalizedViewport,
    boards: normalizedBoards,
    stagingNodes: normalizedStagingNodes,
    summaryGroups: undefined,
  };
}

function normalizeDanglingBlueprintArtifacts(file: CanvasFile): CanvasFile {
  const validBlueprintInstanceIds = new Set(
    file.nodes
      .filter(isBlueprintInstanceContainerNode)
      .map(node => node.meta?.blueprint_instance_id)
      .filter((value): value is string => !!value),
  );

  let nodesChanged = false;
  const nodes: CanvasNode[] = [];
  for (const node of file.nodes) {
    if (isBlueprintInstanceContainerNode(node)) {
      nodes.push(node);
      continue;
    }

    const meta = node.meta ?? {};
    const instanceId = meta.blueprint_instance_id;
    const boundInstanceId = meta.blueprint_bound_instance_id;
    const isPlaceholder = !!meta.blueprint_placeholder_kind;
    const isBlueprintInternal = !!instanceId;

    if (isPlaceholder && (!instanceId || !validBlueprintInstanceIds.has(instanceId) || !meta.blueprint_placeholder_slot_id)) {
      nodesChanged = true;
      continue;
    }

    if (isBlueprintInternal && !validBlueprintInstanceIds.has(instanceId)) {
      nodesChanged = true;
      continue;
    }

    if (boundInstanceId && (!validBlueprintInstanceIds.has(boundInstanceId) || !meta.blueprint_bound_slot_id || !meta.blueprint_bound_slot_kind)) {
      const nextMeta = { ...meta };
      delete nextMeta.blueprint_bound_instance_id;
      delete nextMeta.blueprint_bound_slot_id;
      delete nextMeta.blueprint_bound_slot_title;
      delete nextMeta.blueprint_bound_slot_kind;
      nodes.push({ ...node, meta: nextMeta });
      nodesChanged = true;
      continue;
    }

    nodes.push(node);
  }

  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = file.edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const edgesChanged = edges.length !== file.edges.length;

  if (!nodesChanged && !edgesChanged) {
    return file;
  }

  return { ...file, nodes, edges };
}

function normalizeBlueprintArtifactsAgainstContainers(file: CanvasFile): CanvasFile {
  const instanceInfo = new Map<string, {
    defId?: string;
    color?: string;
    inputSlots: Map<string, BlueprintSlotDef>;
    outputSlots: Map<string, BlueprintSlotDef>;
  }>();

  for (const node of file.nodes.filter(isBlueprintInstanceContainerNode)) {
    const instanceId = node.meta?.blueprint_instance_id;
    if (!instanceId) { continue; }
    instanceInfo.set(instanceId, {
      defId: node.meta?.blueprint_def_id,
      color: node.meta?.blueprint_color,
      inputSlots: new Map((node.meta?.blueprint_input_slot_defs ?? []).map(slot => [slot.id, slot])),
      outputSlots: new Map((node.meta?.blueprint_output_slot_defs ?? []).map(slot => [slot.id, slot])),
    });
  }

  let changed = false;
  const nextNodes: CanvasNode[] = [];
  for (const node of file.nodes) {
    if (isBlueprintInstanceContainerNode(node)) {
      nextNodes.push(node);
      continue;
    }

    const meta = node.meta ?? {};
    const internalInstanceId = meta.blueprint_instance_id;
    const boundInstanceId = meta.blueprint_bound_instance_id;
    const containerInfo = internalInstanceId
      ? instanceInfo.get(internalInstanceId)
      : (boundInstanceId ? instanceInfo.get(boundInstanceId) : undefined);
    if (!containerInfo) {
      nextNodes.push(node);
      continue;
    }

    const nextMeta = { ...meta };
    let nodeChanged = false;

    if (internalInstanceId) {
      if (containerInfo.defId && nextMeta.blueprint_def_id !== containerInfo.defId) {
        nextMeta.blueprint_def_id = containerInfo.defId;
        nodeChanged = true;
      }
      if (containerInfo.color && nextMeta.blueprint_color !== containerInfo.color) {
        nextMeta.blueprint_color = containerInfo.color;
        nodeChanged = true;
      }
      if (nextMeta.blueprint_bound_instance_id === internalInstanceId) {
        delete nextMeta.blueprint_bound_instance_id;
        delete nextMeta.blueprint_bound_slot_id;
        delete nextMeta.blueprint_bound_slot_title;
        delete nextMeta.blueprint_bound_slot_kind;
        nodeChanged = true;
      }
      if (nextMeta.blueprint_placeholder_kind) {
        const slotMap = nextMeta.blueprint_placeholder_kind === 'input'
          ? containerInfo.inputSlots
          : containerInfo.outputSlots;
        const hasAuthoritativeSlotDefs = slotMap.size > 0;
        const slotRef = hasAuthoritativeSlotDefs
          ? resolveCompatibleBlueprintSlotReference(
            slotMap,
            nextMeta.blueprint_placeholder_kind === 'input' ? 'input' : 'output',
            nextMeta.blueprint_placeholder_slot_id,
            nextMeta.blueprint_placeholder_title,
          )
          : undefined;
        const slotId = slotRef?.slotId ?? nextMeta.blueprint_placeholder_slot_id;
        const slotDef = hasAuthoritativeSlotDefs ? slotRef?.slotDef : undefined;
        if (!slotId) {
          changed = true;
          continue;
        }
        if (hasAuthoritativeSlotDefs && !slotDef) {
          changed = true;
          continue;
        }
        if (!slotDef) {
          nextNodes.push(nodeChanged ? { ...node, meta: nextMeta } : node);
          if (nodeChanged) {
            changed = true;
          }
          continue;
        }
        if (nextMeta.blueprint_placeholder_slot_id !== slotId) {
          nextMeta.blueprint_placeholder_slot_id = slotId;
          nodeChanged = true;
        }
        if (nextMeta.blueprint_placeholder_title !== slotDef.title) {
          nextMeta.blueprint_placeholder_title = slotDef.title;
          nodeChanged = true;
        }
        if (JSON.stringify(nextMeta.blueprint_placeholder_accepts ?? []) !== JSON.stringify(slotDef.accepts)) {
          nextMeta.blueprint_placeholder_accepts = [...slotDef.accepts];
          nodeChanged = true;
        }
        if ((nextMeta.blueprint_placeholder_required ?? false) !== !!slotDef.required) {
          nextMeta.blueprint_placeholder_required = !!slotDef.required;
          nodeChanged = true;
        }
        if ((nextMeta.blueprint_placeholder_allow_multiple ?? false) !== !!slotDef.allow_multiple) {
          nextMeta.blueprint_placeholder_allow_multiple = !!slotDef.allow_multiple;
          nodeChanged = true;
        }
        if (nextMeta.blueprint_placeholder_replacement_mode !== slotDef.replacement_mode) {
          nextMeta.blueprint_placeholder_replacement_mode = slotDef.replacement_mode;
          nodeChanged = true;
        }
        if ((nextMeta.blueprint_placeholder_hint ?? '') !== (slotDef.binding_hint ?? '')) {
          nextMeta.blueprint_placeholder_hint = slotDef.binding_hint;
          nodeChanged = true;
        }
      }
    }

    if (boundInstanceId && nextMeta.blueprint_bound_slot_kind) {
      const slotMap = nextMeta.blueprint_bound_slot_kind === 'input'
        ? containerInfo.inputSlots
        : containerInfo.outputSlots;
      const hasAuthoritativeSlotDefs = slotMap.size > 0;
      const slotRef = hasAuthoritativeSlotDefs
        ? resolveCompatibleBlueprintSlotReference(
          slotMap,
          nextMeta.blueprint_bound_slot_kind,
          nextMeta.blueprint_bound_slot_id,
          nextMeta.blueprint_bound_slot_title,
        )
        : undefined;
      const slotId = slotRef?.slotId ?? nextMeta.blueprint_bound_slot_id;
      const slotDef = hasAuthoritativeSlotDefs ? slotRef?.slotDef : undefined;
      if (!slotId) {
        delete nextMeta.blueprint_bound_instance_id;
        delete nextMeta.blueprint_bound_slot_id;
        delete nextMeta.blueprint_bound_slot_title;
        delete nextMeta.blueprint_bound_slot_kind;
        nodeChanged = true;
      } else if (!hasAuthoritativeSlotDefs) {
        // Definitions/index may hydrate after init. Do not destructively clear
        // current blueprint-bound outputs/inputs just because slot defs have not
        // arrived yet; keep the binding metadata and let later migrations decide.
      } else if (!slotDef) {
        delete nextMeta.blueprint_bound_instance_id;
        delete nextMeta.blueprint_bound_slot_id;
        delete nextMeta.blueprint_bound_slot_title;
        delete nextMeta.blueprint_bound_slot_kind;
        nodeChanged = true;
      } else if (nextMeta.blueprint_bound_slot_id !== slotId) {
        nextMeta.blueprint_bound_slot_id = slotId;
        nextMeta.blueprint_bound_slot_title = slotDef.title;
        nodeChanged = true;
      } else if (nextMeta.blueprint_bound_slot_title !== slotDef.title) {
        nextMeta.blueprint_bound_slot_title = slotDef.title;
        nodeChanged = true;
      }
    }

    if (nodeChanged) {
      changed = true;
      nextNodes.push({ ...node, meta: nextMeta });
    } else {
      nextNodes.push(node);
    }
  }

  if (!changed) {
    return file;
  }

  const nodeIds = new Set(nextNodes.map(node => node.id));
  return {
    ...file,
    nodes: nextNodes,
    edges: file.edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

function normalizeBlueprintContainerBounds(file: CanvasFile): CanvasFile {
  const containerByInstanceId = new Map<string, CanvasNode>();
  for (const node of file.nodes) {
    if (!isBlueprintInstanceContainerNode(node)) { continue; }
    const instanceId = node.meta?.blueprint_instance_id;
    if (!instanceId) { continue; }
    containerByInstanceId.set(instanceId, node);
  }
  if (containerByInstanceId.size === 0) {
    return file;
  }

  let changed = false;
  const nextNodes = file.nodes.map(node => {
    if (!isBlueprintInstanceContainerNode(node)) { return node; }
    const instanceId = node.meta?.blueprint_instance_id;
    if (!instanceId) { return node; }

    const memberNodes = file.nodes.filter(candidate =>
      candidate.id !== node.id &&
      candidate.meta?.blueprint_instance_id === instanceId
    );
    if (memberNodes.length === 0) { return node; }

    const bounds = computeBlueprintContainerBounds(memberNodes);
    const samePosition =
      Math.abs(node.position.x - bounds.x) <= 0.01 &&
      Math.abs(node.position.y - bounds.y) <= 0.01;
    const sameSize =
      Math.abs(node.size.width - bounds.width) <= 0.01 &&
      Math.abs(node.size.height - bounds.height) <= 0.01;
    if (samePosition && sameSize) {
      return node;
    }

    changed = true;
    return {
      ...node,
      position: { x: bounds.x, y: bounds.y },
      size: { width: bounds.width, height: bounds.height },
    };
  });

  return changed ? { ...file, nodes: nextNodes } : file;
}

function normalizeLegacyBlueprintRuntimeOutputBindings(file: CanvasFile): CanvasFile {
  const containerByInstanceId = new Map<string, CanvasNode>();
  for (const node of file.nodes) {
    if (!isBlueprintInstanceContainerNode(node)) { continue; }
    const instanceId = node.meta?.blueprint_instance_id;
    if (!instanceId) { continue; }
    containerByInstanceId.set(instanceId, node);
  }
  if (containerByInstanceId.size === 0) {
    return file;
  }

  const nodeById = new Map(file.nodes.map(node => [node.id, node]));
  const outputHintsByFunctionNodeId = new Map<string, Array<{
    instanceId: string;
    slotId: string;
    slotTitle?: string;
    blueprintDefId?: string;
    blueprintColor?: string;
  }>>();

  const addOutputHint = (
    functionNodeId: string,
    hint: {
      instanceId: string;
      slotId: string;
      slotTitle?: string;
      blueprintDefId?: string;
      blueprintColor?: string;
    },
  ) => {
    if (!hint.instanceId || !hint.slotId) { return; }
    const existing = outputHintsByFunctionNodeId.get(functionNodeId) ?? [];
    if (existing.some(item => item.instanceId === hint.instanceId && item.slotId === hint.slotId)) {
      return;
    }
    existing.push(hint);
    outputHintsByFunctionNodeId.set(functionNodeId, existing);
  };

  for (const node of file.nodes) {
    if (node.node_type !== 'function') { continue; }
    const instanceId = node.meta?.blueprint_instance_id;
    const blueprintSourceId = node.meta?.blueprint_source_id;
    if (!instanceId || !blueprintSourceId) { continue; }
    const containerNode = containerByInstanceId.get(instanceId);
    if (!containerNode) { continue; }
    for (const slot of containerNode.meta?.blueprint_output_slot_defs ?? []) {
      if (slot.source_function_node_id !== blueprintSourceId) { continue; }
      addOutputHint(node.id, {
        instanceId,
        slotId: slot.id,
        slotTitle: slot.title,
        blueprintDefId: containerNode.meta?.blueprint_def_id ?? node.meta?.blueprint_def_id,
        blueprintColor: containerNode.meta?.blueprint_color ?? node.meta?.blueprint_color,
      });
    }
  }

  for (const edge of file.edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.node_type !== 'function') { continue; }
    const instanceId = sourceNode.meta?.blueprint_instance_id;
    if (!instanceId) { continue; }

    const slotId = targetNode.meta?.blueprint_placeholder_kind === 'output'
      ? targetNode.meta?.blueprint_placeholder_slot_id
      : targetNode.meta?.blueprint_bound_slot_kind === 'output'
        ? targetNode.meta?.blueprint_bound_slot_id
        : undefined;
    const slotTitle = targetNode.meta?.blueprint_placeholder_title
      ?? targetNode.meta?.blueprint_bound_slot_title
      ?? targetNode.title;
    if (!slotId) { continue; }

    addOutputHint(sourceNode.id, {
      instanceId,
      slotId,
      slotTitle,
      blueprintDefId: sourceNode.meta?.blueprint_def_id,
      blueprintColor: sourceNode.meta?.blueprint_color,
    });
  }

  let changed = false;
  const nextNodes = file.nodes.map(node => {
    const currentMeta = node.meta ?? {};
    const incomingEdge = file.edges.find(edge =>
      edge.edge_type === 'ai_generated' &&
      edge.target === node.id
    );
    if (!incomingEdge) { return node; }

    const sourceNode = nodeById.get(incomingEdge.source);
    if (!sourceNode || sourceNode.node_type !== 'function') { return node; }
    const sourceInstanceId = sourceNode.meta?.blueprint_instance_id;
    if (!sourceInstanceId) { return node; }
    const isInternalPipelineRuntimeOutput = file.edges.some(edge => {
      if (edge.edge_type !== 'pipeline_flow' || edge.source !== sourceNode.id) { return false; }
      const targetNode = nodeById.get(edge.target);
      return targetNode?.meta?.blueprint_instance_id === sourceInstanceId;
    });
    if (currentMeta.blueprint_instance_id === sourceInstanceId && !isInternalPipelineRuntimeOutput) {
      return node;
    }

    const outputHints = outputHintsByFunctionNodeId.get(sourceNode.id) ?? [];

    if (outputHints.length === 0 && isInternalPipelineRuntimeOutput) {
      const nextMeta: CanvasNode['meta'] = {
        ...currentMeta,
        blueprint_instance_id: sourceInstanceId,
        ...(sourceNode.meta?.blueprint_def_id ? { blueprint_def_id: sourceNode.meta.blueprint_def_id } : {}),
        ...(sourceNode.meta?.blueprint_color ? { blueprint_color: sourceNode.meta.blueprint_color } : {}),
        blueprint_runtime_hidden: true,
      };

      if (JSON.stringify(nextMeta) === JSON.stringify(currentMeta)) {
        return node;
      }

      changed = true;
      return { ...node, meta: nextMeta };
    }

    if (outputHints.length !== 1) {
      return node;
    }

    const hint = outputHints[0];
    if (
      currentMeta.blueprint_bound_slot_kind === 'output' &&
      currentMeta.blueprint_bound_instance_id &&
      currentMeta.blueprint_bound_slot_id &&
      (
        currentMeta.blueprint_bound_instance_id !== hint.instanceId ||
        currentMeta.blueprint_bound_slot_id !== hint.slotId
      )
    ) {
      return node;
    }

    const nextMeta: CanvasNode['meta'] = {
      ...currentMeta,
      ...(hint.blueprintDefId ? { blueprint_def_id: hint.blueprintDefId } : {}),
      ...(hint.blueprintColor ? { blueprint_color: hint.blueprintColor } : {}),
      blueprint_bound_instance_id: hint.instanceId,
      blueprint_bound_slot_id: hint.slotId,
      blueprint_bound_slot_title: hint.slotTitle,
      blueprint_bound_slot_kind: 'output',
    };

    if (JSON.stringify(nextMeta) === JSON.stringify(currentMeta)) {
      return node;
    }

    changed = true;
    return { ...node, meta: nextMeta };
  });

  return changed ? { ...file, nodes: nextNodes } : file;
}

function inferBlueprintInstanceOriginFromContainerMeta(
  containerNode: CanvasNode,
  nodes: CanvasNode[],
): { x: number; y: number } {
  const instanceId = containerNode.meta?.blueprint_instance_id;
  if (!instanceId) {
    return { x: containerNode.position.x + 28, y: containerNode.position.y + 64 };
  }

  const slots = [
    ...(containerNode.meta?.blueprint_input_slot_defs ?? []),
    ...(containerNode.meta?.blueprint_output_slot_defs ?? []),
  ];
  const candidates = nodes.filter(node =>
    node.id !== containerNode.id &&
    node.meta?.blueprint_instance_id === instanceId
  );

  for (const slot of slots) {
    const match = candidates.find(node =>
      node.meta?.blueprint_placeholder_slot_id === slot.id
    );
    if (match) {
      return {
        x: match.position.x - slot.rect.x,
        y: match.position.y - slot.rect.y,
      };
    }
  }

  return { x: containerNode.position.x + 28, y: containerNode.position.y + 64 };
}

function synthesizeImplicitBlueprintOutputSlotsFromCanvas(
  containerNode: CanvasNode,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): BlueprintSlotDef[] {
  const instanceId = containerNode.meta?.blueprint_instance_id;
  if (!instanceId) { return []; }

  const existingOutputSlots = containerNode.meta?.blueprint_output_slot_defs ?? [];
  const explicitSourceFunctionIds = new Set(
    existingOutputSlots
      .map(slot => slot.source_function_node_id)
      .filter((value): value is string => !!value),
  );
  const origin = inferBlueprintInstanceOriginFromContainerMeta(containerNode, nodes);
  const internalNodeIds = new Set(
    nodes
      .filter(node => node.meta?.blueprint_instance_id === instanceId)
      .map(node => node.id),
  );

  const functionNodes = nodes.filter(node =>
    node.node_type === 'function' &&
    node.meta?.blueprint_instance_id === instanceId,
  );

  const syntheticSlots: BlueprintSlotDef[] = [];
  for (const functionNode of functionNodes) {
    const sourceFunctionId = functionNode.meta?.blueprint_source_id ?? functionNode.id;
    if (!sourceFunctionId || explicitSourceFunctionIds.has(sourceFunctionId)) { continue; }

    const hasInternalPipelineConsumers = edges.some(edge => {
      if (edge.edge_type !== 'pipeline_flow' || edge.source !== functionNode.id) { return false; }
      return internalNodeIds.has(edge.target);
    });
    if (hasInternalPipelineConsumers) { continue; }

    const hasInternalMaterializedOutput = edges.some(edge => {
      if ((edge.edge_type !== 'ai_generated' && edge.edge_type !== 'data_flow') || edge.source !== functionNode.id) {
        return false;
      }
      if (!internalNodeIds.has(edge.target)) { return false; }
      const targetNode = nodes.find(node => node.id === edge.target);
      if (!targetNode) { return false; }
      return targetNode.meta?.blueprint_placeholder_kind !== 'output';
    });
    if (hasInternalMaterializedOutput) { continue; }

    syntheticSlots.push({
      id: buildImplicitBlueprintOutputSlotId(sourceFunctionId),
      kind: 'output',
      title: buildImplicitBlueprintOutputTitle(functionNode.title),
      required: false,
      allow_multiple: false,
      accepts: ['ai_output'],
      source_function_node_id: sourceFunctionId,
      placeholder_style: 'output_placeholder',
      replacement_mode: 'attach_by_edge',
      binding_hint: '蓝图运行完成后，最终输出会优先回填到该占位位置。',
      rect: {
        x: Math.round(functionNode.position.x - origin.x + functionNode.size.width + 60),
        y: Math.round(functionNode.position.y - origin.y + Math.max((functionNode.size.height - 136) / 2, 0)),
        width: 240,
        height: 136,
      },
    });
  }

  return syntheticSlots;
}

function normalizeBlueprintContainerOutputSlotsFromCanvas(file: CanvasFile): CanvasFile {
  const containers = file.nodes.filter(node => isBlueprintInstanceContainerNode(node));
  if (containers.length === 0) { return file; }

  let changed = false;
  const nextNodes = file.nodes.map(node => {
    if (!isBlueprintInstanceContainerNode(node)) { return node; }

    const currentOutputSlots = node.meta?.blueprint_output_slot_defs ?? [];
    const synthesizedOutputSlots = synthesizeImplicitBlueprintOutputSlotsFromCanvas(node, file.nodes, file.edges);
    if (synthesizedOutputSlots.length === 0) { return node; }

    const mergedOutputSlots = [
      ...currentOutputSlots,
      ...synthesizedOutputSlots.filter(slot => !currentOutputSlots.some(existing => existing.id === slot.id)),
    ];
    if (mergedOutputSlots.length === currentOutputSlots.length) { return node; }

    changed = true;
    return {
      ...node,
      meta: {
        ...(node.meta ?? {}),
        blueprint_output_slots: mergedOutputSlots.length,
        blueprint_output_slot_defs: mergedOutputSlots,
      },
    };
  });

  return changed ? { ...file, nodes: nextNodes } : file;
}

function normalizeLegacyBlueprintInputBindings(file: CanvasFile): CanvasFile {
  const containers = file.nodes.filter(node => isBlueprintInstanceContainerNode(node));
  if (containers.length === 0) { return file; }

  let nodes = file.nodes;
  let edges = file.edges;
  let changed = false;
  const changedInstanceIds = new Set<string>();

  for (const containerNode of containers) {
    const instanceId = containerNode.meta?.blueprint_instance_id;
    const inputSlots = containerNode.meta?.blueprint_input_slot_defs ?? [];
    if (!instanceId || inputSlots.length === 0) { continue; }

    const origin = inferBlueprintInstanceOriginFromContainerMeta(containerNode, nodes);

    for (const slot of inputSlots) {
      const boundNodes = nodes.filter(node =>
        node.meta?.blueprint_bound_instance_id === instanceId &&
        node.meta?.blueprint_bound_slot_kind === 'input' &&
        node.meta?.blueprint_bound_slot_id === slot.id
      );
      const existingPlaceholder = nodes.find(node =>
        node.meta?.blueprint_instance_id === instanceId &&
        node.meta?.blueprint_placeholder_kind === 'input' &&
        node.meta?.blueprint_placeholder_slot_id === slot.id
      );

      if (!existingPlaceholder && boundNodes.length === 0) { continue; }

      const placeholderPosition = getDefinitionRectPosition(origin, slot.rect);
      let placeholderNode = existingPlaceholder;
      const expectedPlaceholder = createBlueprintPlaceholderNodeFromContainer(slot, containerNode, placeholderPosition);

      if (placeholderNode) {
        const nextPlaceholder: CanvasNode = {
          ...expectedPlaceholder,
          id: placeholderNode.id,
          position: placeholderNode.position,
          size: placeholderNode.size,
        };
        if (JSON.stringify(placeholderNode) !== JSON.stringify(nextPlaceholder)) {
          nodes = nodes.map(node => node.id === placeholderNode!.id ? nextPlaceholder : node);
          placeholderNode = nextPlaceholder;
          changed = true;
          changedInstanceIds.add(instanceId);
        }
      } else {
        placeholderNode = expectedPlaceholder;
        nodes = [...nodes, placeholderNode];
        changed = true;
        changedInstanceIds.add(instanceId);
      }

      const activeBoundNodes = slot.allow_multiple ? boundNodes : boundNodes.slice(-1);
      const demotedBoundNodeIds = new Set(boundNodes.filter(node => !activeBoundNodes.some(active => active.id === node.id)).map(node => node.id));

      if (demotedBoundNodeIds.size > 0) {
        nodes = nodes.map(node => {
          if (!demotedBoundNodeIds.has(node.id)) { return node; }
          const nextMeta = { ...(node.meta ?? {}) };
          delete nextMeta.blueprint_bound_instance_id;
          delete nextMeta.blueprint_bound_slot_id;
          delete nextMeta.blueprint_bound_slot_title;
          delete nextMeta.blueprint_bound_slot_kind;
          return { ...node, meta: nextMeta };
        });
        changed = true;
        changedInstanceIds.add(instanceId);
      }

      for (const [index, boundNode] of activeBoundNodes.entries()) {
        const placeholderTarget = placeholderNode;
        const shouldNudge =
          Math.abs(boundNode.position.x - placeholderTarget.position.x) <= 4 &&
          Math.abs(boundNode.position.y - placeholderTarget.position.y) <= 4;
        const nextPosition = shouldNudge
          ? {
            x: placeholderTarget.position.x - Math.max(boundNode.size.width + 72, 260),
            y: placeholderTarget.position.y + (index * 36),
          }
          : boundNode.position;
        const nextMeta = { ...(boundNode.meta ?? {}) };
        delete nextMeta.blueprint_bound_instance_id;
        delete nextMeta.blueprint_bound_slot_id;
        delete nextMeta.blueprint_bound_slot_title;
        delete nextMeta.blueprint_bound_slot_kind;
        const nextBoundNode: CanvasNode = {
          ...boundNode,
          position: nextPosition,
          meta: nextMeta,
        };
        if (JSON.stringify(boundNode) !== JSON.stringify(nextBoundNode)) {
          nodes = nodes.map(node => node.id === boundNode.id ? nextBoundNode : node);
          changed = true;
          changedInstanceIds.add(instanceId);
        }

        const targetInternalNodeIds = new Set(
          nodes
            .filter(node => node.meta?.blueprint_instance_id === instanceId)
            .map(node => node.id),
        );
        const nextEdges: CanvasEdge[] = [];
        let edgesChanged = false;
        for (const edge of edges) {
          if (
            isBlueprintSlotDataFlowEdge(edge) &&
            edge.source === boundNode.id &&
            targetInternalNodeIds.has(edge.target)
          ) {
            const reboundEdge: CanvasEdge = {
              ...edge,
              id: uuid(),
              source: placeholderTarget.id,
            };
            if (!nextEdges.some(existing => sameCanvasEdgeSemantics(existing, reboundEdge))) {
              nextEdges.push(reboundEdge);
            }
            edgesChanged = true;
            continue;
          }
          if (
            isBlueprintSlotDataFlowEdge(edge) &&
            demotedBoundNodeIds.has(edge.source) &&
            targetInternalNodeIds.has(edge.target)
          ) {
            edgesChanged = true;
            continue;
          }
          if (!nextEdges.some(existing => sameCanvasEdgeSemantics(existing, edge))) {
            nextEdges.push(edge);
          }
        }
        const bindingEdge: CanvasEdge = {
          id: uuid(),
          source: boundNode.id,
          target: placeholderTarget.id,
          edge_type: 'data_flow',
          role: slot.id,
        };
        if (!nextEdges.some(existing => sameCanvasEdgeSemantics(existing, bindingEdge))) {
          nextEdges.push(bindingEdge);
          edgesChanged = true;
        }
        if (edgesChanged) {
          edges = nextEdges;
          changed = true;
          changedInstanceIds.add(instanceId);
        }
      }
    }
  }

  if (!changed) { return file; }

  let nextFile: CanvasFile = { ...file, nodes, edges };
  if (changedInstanceIds.size > 0) {
    const { flowNodes, flowEdges } = canvasToFlow(nextFile.nodes, nextFile.edges);
    const adjusted = recalcBlueprintContainersForInstanceIds(flowNodes, changedInstanceIds);
    nextFile = { ...nextFile, nodes: flowToCanvas(adjusted, flowEdges).nodes };
  }
  return nextFile;
}

function normalizeLegacyBlueprintOutputBindings(file: CanvasFile): CanvasFile {
  const containers = file.nodes.filter(node => isBlueprintInstanceContainerNode(node));
  if (containers.length === 0) { return file; }

  let nodes = file.nodes;
  let edges = file.edges;
  let changed = false;
  const changedInstanceIds = new Set<string>();

  for (const containerNode of containers) {
    const instanceId = containerNode.meta?.blueprint_instance_id;
    const outputSlots = containerNode.meta?.blueprint_output_slot_defs ?? [];
    if (!instanceId || outputSlots.length === 0) { continue; }

    const origin = inferBlueprintInstanceOriginFromContainerMeta(containerNode, nodes);

    for (const slot of outputSlots) {
      const boundNodes = nodes
        .filter(node =>
          node.meta?.blueprint_bound_instance_id === instanceId &&
          node.meta?.blueprint_bound_slot_kind === 'output' &&
          node.meta?.blueprint_bound_slot_id === slot.id
        )
        .sort((a, b) => {
          const timeDiff = extractBlueprintOutputTimestampKey(a.file_path).localeCompare(extractBlueprintOutputTimestampKey(b.file_path));
          if (timeDiff !== 0) { return timeDiff; }
          return a.id.localeCompare(b.id);
        });
      const existingPlaceholder = nodes.find(node =>
        node.meta?.blueprint_instance_id === instanceId &&
        node.meta?.blueprint_placeholder_kind === 'output' &&
        node.meta?.blueprint_placeholder_slot_id === slot.id
      );

      if (!existingPlaceholder && boundNodes.length === 0) { continue; }

      const placeholderPosition = getDefinitionRectPosition(origin, slot.rect);
      let placeholderNode = existingPlaceholder;
      const expectedPlaceholder = createBlueprintPlaceholderNodeFromContainer(slot, containerNode, placeholderPosition);

      if (placeholderNode) {
        const nextPlaceholder: CanvasNode = {
          ...expectedPlaceholder,
          id: placeholderNode.id,
          position: placeholderNode.position,
          size: placeholderNode.size,
        };
        if (JSON.stringify(placeholderNode) !== JSON.stringify(nextPlaceholder)) {
          nodes = nodes.map(node => node.id === placeholderNode!.id ? nextPlaceholder : node);
          placeholderNode = nextPlaceholder;
          changed = true;
          changedInstanceIds.add(instanceId);
        }
      } else {
        placeholderNode = expectedPlaceholder;
        nodes = [...nodes, placeholderNode];
        changed = true;
        changedInstanceIds.add(instanceId);
      }

      const activeBoundNodes = boundNodes;
      const demotedBoundNodeIds = new Set<string>();

      const targetInternalNodeIds = new Set(
        nodes
          .filter(node => node.meta?.blueprint_instance_id === instanceId)
          .map(node => node.id),
      );
      const reboundLegacyTargetNodeIds = new Set(boundNodes.map(node => node.id));
      let nextEdges: CanvasEdge[] = [];
      let edgesChanged = false;

      for (const edge of edges) {
        if (
          isBlueprintSlotDataFlowEdge(edge) &&
          demotedBoundNodeIds.has(edge.source) &&
          edge.target === placeholderNode.id
        ) {
          edgesChanged = true;
          continue;
        }
        if (
          isBlueprintSlotDataFlowEdge(edge) &&
          reboundLegacyTargetNodeIds.has(edge.target) &&
          targetInternalNodeIds.has(edge.source) &&
          edge.source !== placeholderNode.id
        ) {
          const reboundEdge: CanvasEdge = {
            ...edge,
            id: uuid(),
            target: placeholderNode.id,
          };
          if (!nextEdges.some(existing => sameCanvasEdgeSemantics(existing, reboundEdge))) {
            nextEdges.push(reboundEdge);
          }
          edgesChanged = true;
          continue;
        }
        if (!nextEdges.some(existing => sameCanvasEdgeSemantics(existing, edge))) {
          nextEdges.push(edge);
        }
      }

      for (const activeBoundNode of activeBoundNodes) {
        const sourceFunctionNode = slot.source_function_node_id
          ? nodes.find(node =>
            node.meta?.blueprint_instance_id === instanceId &&
            node.meta?.blueprint_source_kind === 'function_node' &&
            node.meta?.blueprint_source_id === slot.source_function_node_id
          )
          : undefined;
        if (sourceFunctionNode) {
          const generatedEdge: CanvasEdge = {
            id: uuid(),
            source: sourceFunctionNode.id,
            target: placeholderNode.id,
            edge_type: 'ai_generated',
          };
          if (!nextEdges.some(existing => sameCanvasEdgeSemantics(existing, generatedEdge))) {
            nextEdges.push(generatedEdge);
            edgesChanged = true;
          }
        }
        const bindingEdge: CanvasEdge = {
          id: uuid(),
          source: placeholderNode.id,
          target: activeBoundNode.id,
          edge_type: 'data_flow',
          role: slot.id,
        };
        if (!nextEdges.some(existing => sameCanvasEdgeSemantics(existing, bindingEdge))) {
          nextEdges.push(bindingEdge);
          edgesChanged = true;
        }
      }

      if (edgesChanged) {
        edges = nextEdges;
        changed = true;
        changedInstanceIds.add(instanceId);
      }
    }
  }

  if (!changed) { return file; }

  let nextFile: CanvasFile = { ...file, nodes, edges };
  if (changedInstanceIds.size > 0) {
    const { flowNodes, flowEdges } = canvasToFlow(nextFile.nodes, nextFile.edges);
    const adjusted = recalcBlueprintContainersForInstanceIds(flowNodes, changedInstanceIds);
    nextFile = { ...nextFile, nodes: flowToCanvas(adjusted, flowEdges).nodes };
  }
  return nextFile;
}

function extractBlueprintOutputTimestampKey(filePath?: string): string {
  if (!filePath) { return ''; }
  const basename = filePath.split('/').pop() ?? filePath;
  const match = basename.match(/_(\d{4}_\d{6})(?:_\d+)?\.[^.]+$/);
  return match?.[1] ?? '';
}

function isCanvasNodeOverlappingRect(
  node: CanvasNode,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    node.position.x < rect.x + rect.width &&
    node.position.x + node.size.width > rect.x &&
    node.position.y < rect.y + rect.height &&
    node.position.y + node.size.height > rect.y
  );
}

function shouldAutoRepositionBlueprintBoundOutput(
  node: CanvasNode,
  containerNode: CanvasNode,
): boolean {
  if (node.meta?.blueprint_output_position_manual) {
    return false;
  }

  return isCanvasNodeOverlappingRect(node, {
    x: containerNode.position.x,
    y: containerNode.position.y,
    width: containerNode.size.width,
    height: containerNode.size.height,
  });
}

function normalizeBlueprintOutputSupportEdges(file: CanvasFile): CanvasFile {
  const containerByInstanceId = new Map<string, CanvasNode>();
  for (const node of file.nodes) {
    if (!isBlueprintInstanceContainerNode(node)) { continue; }
    const instanceId = node.meta?.blueprint_instance_id;
    if (!instanceId) { continue; }
    containerByInstanceId.set(instanceId, node);
  }
  if (containerByInstanceId.size === 0) { return file; }

  let changed = false;
  let nextNodes = file.nodes;
  const nextEdges: CanvasEdge[] = [];

  for (const edge of file.edges) {
    if (!nextEdges.some(existing => sameCanvasEdgeSemantics(existing, edge))) {
      nextEdges.push(edge);
    } else {
      changed = true;
    }
  }

  const ensureEdge = (edge: CanvasEdge) => {
    if (nextEdges.some(existing => sameCanvasEdgeSemantics(existing, edge))) { return; }
    nextEdges.push(edge);
    changed = true;
  };

  for (const node of file.nodes) {
    if (
      node.meta?.blueprint_bound_slot_kind !== 'output' ||
      !node.meta?.blueprint_bound_instance_id ||
      !node.meta?.blueprint_bound_slot_id
    ) {
      continue;
    }

    const instanceId = node.meta.blueprint_bound_instance_id;
    const slotId = node.meta.blueprint_bound_slot_id;
    const containerNode = containerByInstanceId.get(instanceId);
    if (!containerNode) { continue; }

    const slotDef = (containerNode.meta?.blueprint_output_slot_defs ?? []).find(slot => slot.id === slotId);
    const placeholderNode = file.nodes.find(candidate =>
      candidate.meta?.blueprint_instance_id === instanceId &&
      candidate.meta?.blueprint_placeholder_kind === 'output' &&
      candidate.meta?.blueprint_placeholder_slot_id === slotId
    );

    if (placeholderNode) {
      const siblingBoundNodes = file.nodes
        .filter(candidate =>
          candidate.meta?.blueprint_bound_instance_id === instanceId &&
          candidate.meta?.blueprint_bound_slot_kind === 'output' &&
          candidate.meta?.blueprint_bound_slot_id === slotId
        )
        .sort((a, b) => {
          const timeDiff = extractBlueprintOutputTimestampKey(a.file_path).localeCompare(extractBlueprintOutputTimestampKey(b.file_path));
          if (timeDiff !== 0) { return timeDiff; }
          return a.id.localeCompare(b.id);
        });
      const boundIndex = Math.max(0, siblingBoundNodes.findIndex(candidate => candidate.id === node.id));
      const desiredPosition = {
        x: placeholderNode.position.x + placeholderNode.size.width + 72,
        y: placeholderNode.position.y + Math.max((placeholderNode.size.height - node.size.height) / 2, 0) + (boundIndex * 36),
      };
      const shouldAutoReposition = shouldAutoRepositionBlueprintBoundOutput(node, containerNode);
      if (
        shouldAutoReposition &&
        (
          Math.abs(node.position.x - desiredPosition.x) > 0.01 ||
          Math.abs(node.position.y - desiredPosition.y) > 0.01
        )
      ) {
        nextNodes = nextNodes.map(candidate =>
          candidate.id === node.id
            ? { ...candidate, position: desiredPosition }
            : candidate
        );
        changed = true;
      }

      ensureEdge({
        id: uuid(),
        source: placeholderNode.id,
        target: node.id,
        edge_type: 'data_flow',
        role: slotId,
      });
    }

    if (!slotDef?.source_function_node_id) { continue; }
    const sourceFunctionNode = file.nodes.find(candidate =>
      candidate.meta?.blueprint_instance_id === instanceId &&
      candidate.meta?.blueprint_source_kind === 'function_node' &&
      candidate.meta?.blueprint_source_id === slotDef.source_function_node_id
    );
    if (!sourceFunctionNode) { continue; }

    if (placeholderNode) {
      ensureEdge({
        id: uuid(),
        source: sourceFunctionNode.id,
        target: placeholderNode.id,
        edge_type: 'ai_generated',
      });
    }
  }

  if (!changed) { return file; }
  const nodeById = new Map(nextNodes.map(node => [node.id, node]));
  return { ...file, nodes: nextNodes, edges: nextEdges.filter(edge => nodeById.has(edge.source) && nodeById.has(edge.target)) };
}

function normalizeBlueprintCurrentOutputBindings(file: CanvasFile): CanvasFile {
  return file;
}

function normalizeCanvasFileForRuntime(
  file: CanvasFile,
  toolDefs: JsonToolDef[],
): CanvasFile {
  return normalizeFunctionNodes(
    normalizeBlueprintNodes(
      normalizeBlueprintContainerBounds(
        normalizeBlueprintOutputSupportEdges(
          normalizeBlueprintCurrentOutputBindings(
            normalizeLegacyBlueprintOutputBindings(
              normalizeLegacyBlueprintInputBindings(
                normalizeLegacyBlueprintRuntimeOutputBindings(
                  normalizeBlueprintContainerOutputSlotsFromCanvas(
                    normalizeBlueprintArtifactsAgainstContainers(
                      normalizeDanglingBlueprintArtifacts(
                        normalizeNodeGroups(
                          normalizeLegacyBoardArtifacts(
                            normalizeCanvasShellArtifacts(file)
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    ),
    toolDefs,
  );
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
      } else if (isBlueprintInstanceContainerNode(n)) {
        base.zIndex = BLUEPRINT_CONTAINER_Z_INDEX;
        base.draggable = true;
        base.selectable = true;
        base.deletable = true;
        base.focusable = true;
        base.connectable = false;
        base.dragHandle = '.rs-blueprint-header';
        base.style = {
          ...(base.style ?? {}),
          overflow: 'visible',
        };
        base.hidden = true;
      } else if (n.meta?.blueprint_runtime_hidden === true) {
        base.hidden = true;
      }
      return base;
    });

  const flowEdges: FlowEdge[] = edges
    .filter(e => e && e.id && e.source && e.target)
    .map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: normalizeNodePortId(e.sourceHandle),
      targetHandle: normalizeNodePortId(e.targetHandle),
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
  if (t === 'blueprint') { return 'blueprintNode'; }
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
      sourceHandle: normalizeNodePortId(fe.sourceHandle),
      targetHandle: normalizeNodePortId(fe.targetHandle),
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
  modelRequestState: {},
  stagingNodes: [],
  pendingStagingMaterializations: {},
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
  blueprintDraft: null,
  blueprintIndex: [],
  pipelineState: null,
  saveState: 'saved',
  saveDueAt: null,
  lastSavedAt: Date.now(),
  saveError: null,
  initialCanvasLoadActive: false,
  initialCanvasLoadPending: 0,
  initialCanvasRenderReady: true,
  currentInitialCanvasLoadStats: null,
  lastInitialCanvasLoadStats: null,

  beginInitialCanvasLoad(summary) {
    clearInitialCanvasLoadTimers();
    initialCanvasLoadPendingKeys.clear();
    const { nodeCount, mediaRequestCount, fullContentRequestCount } = summary;

    const shouldShow = nodeCount >= INITIAL_CANVAS_LOAD_NODE_THRESHOLD;
    if (!shouldShow) {
      set({
        initialCanvasLoadActive: false,
        initialCanvasLoadPending: 0,
        initialCanvasRenderReady: true,
        currentInitialCanvasLoadStats: null,
      });
      return;
    }

    initialCanvasLoadStartedAt = Date.now();
    initialCanvasLoadSafetyTimer = setTimeout(() => {
      initialCanvasLoadSafetyTimer = undefined;
      finishInitialCanvasLoad(true, 'timeout');
    }, INITIAL_CANVAS_LOAD_MAX_MS);

    set({
      initialCanvasLoadActive: true,
      initialCanvasLoadPending: 0,
      initialCanvasRenderReady: false,
      currentInitialCanvasLoadStats: {
        sessionId: ++nextInitialCanvasLoadSessionId,
        nodeCount,
        mediaRequestCount,
        fullContentRequestCount,
        groupBoundsRecalcCount: 0,
        startedAt: initialCanvasLoadStartedAt,
        renderReadyAt: null,
        finishedAt: null,
        renderReadyMs: null,
        totalMs: null,
        finishedByTimeout: false,
      },
    });

    finishInitialCanvasLoad(false, 'ready');
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
    finishInitialCanvasLoad(false, 'ready');
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
    finishInitialCanvasLoad(false, 'ready');
  },

  markInitialCanvasRenderReady(ready) {
    if (ready) {
      updateCurrentInitialCanvasLoadStats(stats => {
        if (stats.renderReadyAt) { return stats; }
        const renderReadyAt = Date.now();
        return {
          ...stats,
          renderReadyAt,
          renderReadyMs: Math.max(0, renderReadyAt - stats.startedAt),
        };
      });
    }
    if (get().initialCanvasRenderReady === ready) {
      if (ready) { finishInitialCanvasLoad(false, 'ready'); }
      return;
    }
    set({ initialCanvasRenderReady: ready });
    if (ready) {
      finishInitialCanvasLoad(false, 'ready');
    }
  },

  initCanvas(data, workspaceRoot) {
    const normalized = normalizeCanvasFileForRuntime(data, get().toolDefs);
    const nodeGroups = normalized.nodeGroups ?? [];
    const hiddenNodeIds = new Set<string>();
    for (const group of nodeGroups) {
      if (!group.collapsed) { continue; }
      for (const nodeId of group.nodeIds) {
        hiddenNodeIds.add(nodeId);
      }
    }
    resetAutosaveWindow();
    inFlightSavePayloads.clear();
    const { flowNodes, flowEdges } = canvasToFlow(normalized.nodes ?? [], normalized.edges ?? []);
    const syncedFlowNodes = syncGroupHubNodes(flowNodes, nodeGroups);
    const initialMediaRequests: string[] = [];
    const initialFullContentKeys: string[] = [];

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
        initialMediaRequests.push(n.file_path);
      }
      if (shouldTrackInitialFullContentLoad(n, hiddenNodeIds)) {
        initialFullContentKeys.push(`file:${n.id}`);
      }
    }

    get().beginInitialCanvasLoad({
      nodeCount: normalized.nodes?.length ?? 0,
      mediaRequestCount: initialMediaRequests.length,
      fullContentRequestCount: initialFullContentKeys.length,
    });

    for (const filePath of initialMediaRequests) {
      get().trackInitialCanvasLoadRequest(`media:${filePath}`);
      postMessage({ type: 'requestImageUri', filePath });
    }
    for (const key of initialFullContentKeys) {
      get().trackInitialCanvasLoadRequest(key);
    }

    const normalizedCanvasFile: CanvasFile = { ...normalized, boards, nodeGroups, summaryGroups: undefined };
    const originalSerialized = serializeCanvasFile(data);
    const normalizedSerialized = serializeCanvasFile(normalizedCanvasFile);
    const needsMigrationSave = normalizedSerialized !== originalSerialized;
    lastPersistedSerialized = originalSerialized;

    set({
      canvasFile: normalizedCanvasFile,
      workspaceRoot,
      nodes: syncedFlowNodes,
      edges: flowEdges,
      syntheticEdges: [],
      imageUriMap: {},
      stagingNodes: normalized.stagingNodes ?? [],
      pendingStagingMaterializations: {},
      boards,
      nodeGroups,
      activeBoardId: null,
      boardDropdownOpen: false,
      selectedNodeIds: [],
      selectionMode: false,
      undoStack: [],
      redoStack: [],
      aiOutput: '',
      aiOutputRunId: '',
      aiOutputNodeTitle: '',
      lastError: '',
      pendingConnection: null,
      _cycleErrorNodeId: null,
      fullContentCache: {},
      outputHistory: null,
      previewNodeId: null,
      searchOpen: false,
      searchQuery: '',
      searchMatches: [],
      searchIndex: -1,
      blueprintDraft: null,
      blueprintIndex: [],
      pipelineState: null,
      saveState: 'saved',
      saveDueAt: null,
      lastSavedAt: Date.now(),
      saveError: null,
      initialCanvasRenderReady: normalized.nodes.length < INITIAL_CANVAS_LOAD_NODE_THRESHOLD,
    });

    if (needsMigrationSave) {
      debouncedSave(normalizedCanvasFile, 'immediate');
    }
  },

  onNodesChange(changes) {
    const stateAtStart = get();
    const normalizedChanges: NodeChange[] = [];
    for (const change of changes) {
      if (change.type === 'remove') {
        const targetNode = stateAtStart.nodes.find(node => node.id === change.id)?.data;
        if (isBlueprintInstanceContainerNode(targetNode)) {
          const instanceId = targetNode.meta?.blueprint_instance_id;
          if (instanceId) {
            normalizedChanges.push(change);
            for (const memberId of getBlueprintContainerMemberIds(instanceId, stateAtStart.nodes)) {
              normalizedChanges.push({ type: 'remove', id: memberId });
            }
            continue;
          }
        }
      }
      normalizedChanges.push(change);
    }

    // Undo: snapshot before node deletion
    const hasRemove = normalizedChanges.some(c => c.type === 'remove');
    if (hasRemove) {
      get().pushUndo();
      try { usePetStore.getState().notifyCanvasEvent('nodeDeleted'); } catch { /* pet may not be initialized */ }
    }

    const expandedChanges: NodeChange[] = [];
    for (const change of normalizedChanges) {
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

        const blueprintContainer = stateAtStart.nodes.find(node => node.id === change.id)?.data;
        if (isBlueprintInstanceContainerNode(blueprintContainer)) {
          const fromPosition = blueprintContainer.position;
          const toPosition = change.position ?? fromPosition;
          const dx = toPosition.x - fromPosition.x;
          const dy = toPosition.y - fromPosition.y;
          const instanceId = blueprintContainer.meta?.blueprint_instance_id;
          const memberIds = instanceId
            ? getBlueprintContainerMemberIds(instanceId, stateAtStart.nodes)
            : [];

          if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 || change.dragging !== undefined) {
            for (const memberId of memberIds) {
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
      const movedBlueprintBoundOutputIds = new Set(
        expandedChanges
          .filter((change): change is Extract<NodeChange, { type: 'position' }> => change.type === 'position')
          .map(change => change.id),
      );
      const markedManualPositionNodes = updated.map(node => {
        if (!movedBlueprintBoundOutputIds.has(node.id)) { return node; }
        if (node.data.meta?.blueprint_bound_slot_kind !== 'output') { return node; }
        if (node.data.meta?.blueprint_output_position_manual) { return node; }
        return {
          ...node,
          data: {
            ...node.data,
            meta: {
              ...(node.data.meta ?? {}),
              blueprint_output_position_manual: true,
            },
          },
        };
      });

      const removedIds = new Set(
        expandedChanges.filter(c => c.type === 'remove').map(c => c.id)
      );
      const movedIds = new Set(
        expandedChanges.filter(c => c.type === 'position').map(c => c.id)
      );
      const changedBlueprintInstanceIds = new Set<string>();
      for (const node of markedManualPositionNodes) {
        if (removedIds.has(node.id)) { continue; }
        if (movedIds.has(node.id) && node.data.meta?.blueprint_instance_id) {
          changedBlueprintInstanceIds.add(node.data.meta.blueprint_instance_id);
        }
        if (movedIds.has(node.id) && node.data.meta?.blueprint_bound_instance_id) {
          changedBlueprintInstanceIds.add(node.data.meta.blueprint_bound_instance_id);
        }
      }

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
        nodeGroups = recalcGroupsForNodeIds(nodeGroups, markedManualPositionNodes, movedIds);
      }

      const activeHubIds = new Set(nodeGroups.map(group => group.hubNodeId));
      const prunedNodes = markedManualPositionNodes.filter(node => !isGroupHubNodeType(node.data.node_type) || activeHubIds.has(node.id));
      let prunedEdges = state.edges.filter(edge => {
        if (isHubEdgeType(edge.data?.edge_type)) {
          return activeHubIds.has(edge.target);
        }
        const sourceExists = prunedNodes.some(node => node.id === edge.source);
        const targetExists = prunedNodes.some(node => node.id === edge.target);
        return sourceExists && targetExists;
      });
      let finalNodes = prunedNodes;
      let syncedNodes = syncGroupHubNodes(finalNodes, nodeGroups);
      if (changedBlueprintInstanceIds.size > 0) {
        syncedNodes = recalcBlueprintContainersForInstanceIds(syncedNodes, changedBlueprintInstanceIds);
      }

      // Clean up fullContentCache for deleted nodes
      let newCache = state.fullContentCache;
      if (removedIds.size > 0) {
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
      const remainingRemovedInstanceIds = new Set(
        normalizedChanges
          .filter((change): change is Extract<NodeChange, { type: 'remove' }> => change.type === 'remove')
          .map(change => state.nodes.find(node => node.id === change.id)?.data.meta?.blueprint_instance_id)
          .filter((value): value is string => !!value)
      );
      const reboundCanvasNodes = syncedCanvasNodes.map(node => {
        if (!node.meta?.blueprint_bound_instance_id || !remainingRemovedInstanceIds.has(node.meta.blueprint_bound_instance_id)) {
          return node;
        }
        const { blueprint_bound_instance_id, blueprint_bound_slot_id, blueprint_bound_slot_title, blueprint_bound_slot_kind, ...restMeta } = node.meta;
        return { ...node, meta: restMeta };
      });
      const reboundFlowNodes = syncedNodes.map(node => {
        if (!node.data.meta?.blueprint_bound_instance_id || !remainingRemovedInstanceIds.has(node.data.meta.blueprint_bound_instance_id)) {
          return node;
        }
        const { blueprint_bound_instance_id, blueprint_bound_slot_id, blueprint_bound_slot_title, blueprint_bound_slot_kind, ...restMeta } = node.data.meta;
        return {
          ...node,
          data: {
            ...node.data,
            meta: restMeta,
          },
        };
      });
      const newFile: CanvasFile = { ...state.canvasFile, nodes: reboundCanvasNodes, edges: syncedCanvasEdges, nodeGroups };

      if (!isDragging || dragEnded) {
        debouncedSave(newFile);
      }

      return {
        nodes: reboundFlowNodes,
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

    const isDataToBlueprint =
      sourceNode && targetNode &&
      targetNode.node_type === 'blueprint';

    const isDataToBlueprintInputPlaceholder =
      sourceNode && targetNode &&
      (isDataNode(sourceNode) || sourceNode.node_type === 'group_hub') &&
      isBlueprintInputPlaceholderNode(targetNode);

    if (isDataToBlueprint && targetNode) {
      get()._createEdge(connection, connection.targetHandle ?? undefined);
      return;
    }

    if (isDataToBlueprintInputPlaceholder && targetNode) {
      get()._createEdge(connection, targetNode.meta?.blueprint_placeholder_slot_id);
      return;
    }

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
        sourceHandle: normalizeNodePortId(connection.sourceHandle),
        targetHandle: normalizeNodePortId(connection.targetHandle),
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

  updateNodeStatus(nodeId, status, progressText, issueKind, issueMessage) {
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === nodeId
          ? (() => {
              const nextIssueKind = status === 'error' ? issueKind : undefined;
              const nextIssueMessage = status === 'error' ? issueMessage : undefined;
              if (
                n.data.meta?.fn_status === status &&
                n.data.meta?.fn_progress === progressText &&
                n.data.meta?.fn_issue_kind === nextIssueKind &&
                n.data.meta?.fn_issue_message === nextIssueMessage
              ) {
                return n;
              }
              return {
                ...n,
                data: {
                  ...n.data,
                  meta: {
                    ...n.data.meta,
                    fn_status: status,
                    fn_progress: progressText,
                    fn_issue_kind: nextIssueKind,
                    fn_issue_message: nextIssueMessage,
                  },
                },
              };
            })()
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

      const filled = applyBlueprintOutputFill(node, edge, state.nodes, state.edges);
      let updatedNodes = filled.nodes;
      const updatedEdges = filled.edges;
      if (filled.filledInstanceId) {
        updatedNodes = recalcBlueprintContainersForInstanceIds(updatedNodes, [filled.filledInstanceId]);
      }
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, updatedEdges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      const updatedNodeIds = new Set(updatedNodes.map(item => item.id));
      const nextFullContentCache = Object.fromEntries(
        Object.entries(state.fullContentCache).filter(([nodeId]) => updatedNodeIds.has(nodeId))
      );

      if ((node.node_type === 'image' && node.meta?.display_mode !== 'mermaid' || node.node_type === 'video' || node.node_type === 'audio' || node.node_type === 'paper') && node.file_path) {
        postMessage({ type: 'requestImageUri', filePath: node.file_path });
      }

      debouncedSave(newFile, 'immediate');
      return {
        nodes: updatedNodes,
        edges: updatedEdges,
        canvasFile: newFile,
        aiOutputRunId: runId,
        fullContentCache: nextFullContentCache,
      };
    });
  },

  setImageUri(filePath, uri) {
    get().setImageUris([{ filePath, uri }]);
  },

  setImageUris(entries) {
    if (!entries.length) { return; }
    get().resolveInitialCanvasLoadRequests(entries.map(entry => `media:${entry.filePath}`));
    set(state => {
      let changed = false;
      const imageUriMap = { ...state.imageUriMap };
      for (const { filePath, uri } of entries) {
        if (!filePath || !uri || imageUriMap[filePath] === uri) { continue; }
        imageUriMap[filePath] = uri;
        changed = true;
      }
      if (!changed) { return {}; }
      return { imageUriMap };
    });
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
    get().updateNodePreviews([{ nodeId, preview, metaPatch }]);
  },

  updateNodePreviews(entries) {
    if (!entries.length) { return; }
    set(state => {
      if (!state.canvasFile) { return {}; }
      const entryMap = new Map(entries.filter(entry => entry.nodeId).map(entry => [entry.nodeId, entry] as const));
      if (entryMap.size === 0) { return {}; }

      let changed = false;
      const newCache = { ...state.fullContentCache };
      const updatedNodes = state.nodes.map(n => {
        const entry = entryMap.get(n.id);
        if (!entry) { return n; }
        const nextMeta = {
          ...n.data.meta,
          content_preview: entry.preview,
          file_missing: false,
          ...(entry.metaPatch ?? {}),
        };
        const samePreview = n.data.meta?.content_preview === entry.preview;
        const sameMissing = n.data.meta?.file_missing === nextMeta.file_missing;
        const samePatch = Object.entries(entry.metaPatch ?? {}).every(([key, value]) => n.data.meta?.[key as keyof typeof nextMeta] === value);
        if (samePreview && sameMissing && samePatch && !(n.id in newCache)) {
          return n;
        }
        delete newCache[n.id];
        changed = true;
        return { ...n, data: { ...n.data, meta: nextMeta } };
      });
      if (!changed) { return {}; }
      const canvasFile: CanvasFile = {
        ...state.canvasFile,
        nodes: state.canvasFile.nodes.map(cn => {
          const entry = entryMap.get(cn.id);
          if (!entry) { return cn; }
          return {
            ...cn,
            meta: {
              ...cn.meta,
              content_preview: entry.preview,
              file_missing: false,
              ...(entry.metaPatch ?? {}),
            },
          };
        }),
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
      let changed = false;

      for (const { nodeId, content } of entries) {
        if (!content) { continue; }
        if (fullContentCache[nodeId] === content) { continue; }
        fullContentCache[nodeId] = content;
        changed = true;
      }

      if (!changed) { return {}; }
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
      if (state.pendingStagingMaterializations[nodeId]) { return {}; }
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
      if (state.pendingStagingMaterializations[nodeId]) { return {}; }

      const needsMaterialization =
        !node.file_path &&
        node.meta?.staging_origin === 'draft' &&
        (
          node.meta?.staging_materialize_kind === 'note' ||
          node.meta?.staging_materialize_kind === 'experiment_log' ||
          node.meta?.staging_materialize_kind === 'task'
        );
      if (needsMaterialization) {
        postMessage({
          type: 'materializeStagingNode',
          sourceNodeId: node.id,
          nodeType: node.meta?.staging_materialize_kind,
          title: node.title,
          position,
          content: node.meta?.staging_initial_content ?? node.meta?.content_preview ?? '',
        });
        return {
          pendingStagingMaterializations: {
            ...state.pendingStagingMaterializations,
            [nodeId]: { position },
          },
        };
      }

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
      return {
        nodes: updatedNodes,
        canvasFile: newFile,
        stagingNodes: remainingStaging,
      };
    });
  },

  resolveStagingMaterialization(sourceNodeId, node, position) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      if (!state.pendingStagingMaterializations[sourceNodeId]) { return {}; }
      const pendingMap = { ...state.pendingStagingMaterializations };
      delete pendingMap[sourceNodeId];

      const remainingStaging = state.stagingNodes.filter(item => item.id !== sourceNodeId);
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

      if (((placed.node_type === 'image' && placed.meta?.display_mode !== 'mermaid') || placed.node_type === 'video' || placed.node_type === 'audio' || placed.node_type === 'paper') && placed.file_path) {
        postMessage({ type: 'requestImageUri', filePath: placed.file_path });
      }

      debouncedSave(newFile, 'immediate');
      return {
        nodes: updatedNodes,
        canvasFile: newFile,
        stagingNodes: remainingStaging,
        pendingStagingMaterializations: pendingMap,
      };
    });
  },

  failStagingMaterialization(sourceNodeId) {
    set(state => {
      if (!state.pendingStagingMaterializations[sourceNodeId]) { return {}; }
      const pendingMap = { ...state.pendingStagingMaterializations };
      delete pendingMap[sourceNodeId];
      return { pendingStagingMaterializations: pendingMap };
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
      size: { width: 280, height: 220 },
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

  createBlueprintInstance(entry, position) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const resolvedPosition = position ?? calcNewNodePosition(state.canvasFile.nodes);
      const size = computeBlueprintInstanceSize(entry);
      const node: CanvasNode = {
        id: uuid(),
        node_type: 'blueprint',
        title: entry.title,
        position: resolvedPosition,
        size,
        meta: buildBlueprintMetaFromEntry(entry),
      };
      const flowNode: FlowNode = {
        id: node.id,
        type: 'blueprintNode',
        position: node.position,
        data: node,
        width: size.width,
        height: size.height,
      };
      const updatedNodes = [...state.nodes, flowNode];
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile, 'immediate');
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  instantiateBlueprintDefinition(entry, definition, position) {
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const resolvedPosition = position ?? calcNewNodePosition(state.canvasFile.nodes);
      const { nodes: blueprintNodes, edges: blueprintEdges } = buildBlueprintInstanceArtifacts(
        entry,
        definition,
        state.toolDefs,
        resolvedPosition,
      );
      const updatedNodes = [...state.nodes, ...blueprintNodes];
      const updatedEdges = [...state.edges, ...blueprintEdges];
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, updatedEdges);
      const newFile: CanvasFile = {
        ...state.canvasFile,
        nodes: cnNodes,
        edges: cnEdges,
      };
      debouncedSave(newFile, 'immediate');
      return {
        nodes: updatedNodes,
        edges: updatedEdges,
        canvasFile: newFile,
      };
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

  updateNodeMeta(nodeId, patch, syncMode = 'deferred') {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== nodeId) { return n; }
        return { ...n, data: { ...n.data, meta: { ...n.data.meta, ...patch } } };
      });
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile, syncMode);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  syncBlueprintDefinitionAvailability(succeededPaths, failedPaths) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const succeededSet = new Set((succeededPaths ?? []).filter(Boolean));
      const failedSet = new Set((failedPaths ?? []).filter(Boolean));
      if (succeededSet.size === 0 && failedSet.size === 0) { return {}; }

      let changed = false;
      const updatedNodes = state.nodes.map(node => {
        if (node.data.node_type !== 'blueprint') { return node; }
        const filePath = node.data.meta?.blueprint_file_path;
        if (!filePath) { return node; }

        const shouldMarkMissing = failedSet.has(filePath);
        const shouldClearMissing = succeededSet.has(filePath);
        if (!shouldMarkMissing && !shouldClearMissing) { return node; }

        const nextMeta = { ...(node.data.meta ?? {}) };
        if (shouldMarkMissing) {
          const nextMessage = `源蓝图定义未读取成功：${filePath.split(/[\\/]/).pop() ?? filePath}。当前画布保留实例快照，但无法继续按源定义自动校正。`;
          if (
            nextMeta.blueprint_definition_missing === true &&
            nextMeta.blueprint_definition_missing_message === nextMessage
          ) {
            return node;
          }
          nextMeta.blueprint_definition_missing = true;
          nextMeta.blueprint_definition_missing_message = nextMessage;
          changed = true;
          return { ...node, data: { ...node.data, meta: nextMeta } };
        }

        if (!nextMeta.blueprint_definition_missing && !nextMeta.blueprint_definition_missing_message) {
          return node;
        }
        delete nextMeta.blueprint_definition_missing;
        delete nextMeta.blueprint_definition_missing_message;
        changed = true;
        return { ...node, data: { ...node.data, meta: nextMeta } };
      });

      if (!changed) { return {}; }
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
  },

  updateViewport(viewport) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const current = state.canvasFile.viewport;
      if (
        Math.abs(current.x - viewport.x) < 0.5 &&
        Math.abs(current.y - viewport.y) < 0.5 &&
        Math.abs(current.zoom - viewport.zoom) < 0.001
      ) {
        return {};
      }
      const newFile: CanvasFile = { ...state.canvasFile, viewport };
      debouncedSave(newFile);
      return { canvasFile: newFile };
    });
  },

  previewNodeSize(nodeId, width, height) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const nextWidth = Math.round(width);
      const nextHeight = Math.round(height);
      const changedBlueprintInstanceIds = new Set<string>();
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== nodeId) { return n; }
        if (n.data.meta?.blueprint_instance_id) {
          changedBlueprintInstanceIds.add(n.data.meta.blueprint_instance_id);
        }
        if (n.data.meta?.blueprint_bound_instance_id) {
          changedBlueprintInstanceIds.add(n.data.meta.blueprint_bound_instance_id);
        }
        return {
          ...n,
          width: nextWidth,
          height: nextHeight,
          data: { ...n.data, size: { width: nextWidth, height: nextHeight } },
        };
      });
      const nodeGroups = recalcGroupsForNodeIds(state.nodeGroups, updatedNodes, [nodeId]);
      let syncedNodes = syncGroupHubNodes(updatedNodes, nodeGroups);
      if (changedBlueprintInstanceIds.size > 0) {
        syncedNodes = recalcBlueprintContainersForInstanceIds(syncedNodes, changedBlueprintInstanceIds);
      }
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(syncedNodes, state.edges);
      const canvasFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges, nodeGroups };
      return { nodes: syncedNodes, canvasFile, nodeGroups };
    });
  },

  updateNodeSize(nodeId, width, height, metaPatch) {
    set(state => {
      if (!state.canvasFile) { return {}; }
      const changedBlueprintInstanceIds = new Set<string>();
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== nodeId) { return n; }
        if (n.data.meta?.blueprint_instance_id) {
          changedBlueprintInstanceIds.add(n.data.meta.blueprint_instance_id);
        }
        if (n.data.meta?.blueprint_bound_instance_id) {
          changedBlueprintInstanceIds.add(n.data.meta.blueprint_bound_instance_id);
        }
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
      let syncedNodes = syncGroupHubNodes(updatedNodes, nodeGroups);
      if (changedBlueprintInstanceIds.size > 0) {
        syncedNodes = recalcBlueprintContainersForInstanceIds(syncedNodes, changedBlueprintInstanceIds);
      }
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
  requestModelCache(provider, opts) {
    const force = !!opts?.force;
    const state = get();
    if (!provider) { return; }
    if (!force) {
      if (state.modelRequestState[provider] === 'loading') { return; }
      if ((state.modelCache[provider]?.length ?? 0) > 0) { return; }
    }
    set(current => ({
      modelRequestState: {
        ...current.modelRequestState,
        [provider]: 'loading',
      },
    }));
    postMessage({ type: 'requestModels', provider });
  },
  setModelCache(provider, models) {
    set(state => ({
      modelCache: { ...state.modelCache, [provider]: models },
      modelRequestState: {
        ...state.modelRequestState,
        [provider]: 'loaded',
      },
    }));
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
  setToolDefs(defs) {
    set(state => {
      if (!state.canvasFile) {
        return { toolDefs: defs };
      }

      const normalizedFile = normalizeFunctionNodes(state.canvasFile, defs);
      if (normalizedFile === state.canvasFile) {
        return { toolDefs: defs };
      }

      const { flowNodes, flowEdges } = canvasToFlow(normalizedFile.nodes ?? [], normalizedFile.edges ?? []);
      const syncedFlowNodes = syncGroupHubNodes(flowNodes, state.nodeGroups);
      debouncedSave(normalizedFile, 'immediate');

      return {
        toolDefs: defs,
        canvasFile: normalizedFile,
        nodes: syncedFlowNodes,
        edges: flowEdges,
      };
    });
  },
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
  selectExclusiveNode(nodeId) {
    set(state => ({
      nodes: state.nodes.map(node => node.selected === (node.id === nodeId)
        ? node
        : { ...node, selected: node.id === nodeId }),
      edges: state.edges.map(edge => edge.selected ? { ...edge, selected: false } : edge),
      selectedNodeIds: [nodeId],
      activeBoardId: null,
    }));
  },
  selectExclusiveEdge(edgeId) {
    set(state => ({
      nodes: state.nodes.map(node => node.selected ? { ...node, selected: false } : node),
      edges: state.edges.map(edge => edge.selected === (edge.id === edgeId)
        ? edge
        : { ...edge, selected: edge.id === edgeId }),
      selectedNodeIds: [],
      activeBoardId: null,
    }));
  },
  clearSelection() {
    set(state => ({
      nodes: state.nodes.map(node => node.selected ? { ...node, selected: false } : node),
      edges: state.edges.map(edge => edge.selected ? { ...edge, selected: false } : edge),
      selectedNodeIds: [],
      activeBoardId: null,
    }));
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
      if (state.searchQuery === query) { return {}; }
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

  moveBlueprintInstance(instanceId, dx, dy) {
    if (!instanceId || (Math.abs(dx) <= 0.01 && Math.abs(dy) <= 0.01)) { return; }
    get().pushUndo();
    set(state => {
      if (!state.canvasFile) { return {}; }
      const memberIds = _blueprintDragMembers.size > 0
        ? _blueprintDragMembers
        : new Set(
            state.nodes
              .filter(node => node.data.meta?.blueprint_instance_id === instanceId)
              .map(node => node.id)
          );
      if (memberIds.size === 0) { return {}; }

      let updatedNodes = state.nodes.map(node =>
        memberIds.has(node.id)
          ? {
              ...node,
              position: { x: node.position.x + dx, y: node.position.y + dy },
              data: {
                ...node.data,
                position: { x: node.data.position.x + dx, y: node.data.position.y + dy },
              },
            }
          : node
      );
      updatedNodes = recalcBlueprintContainersForInstanceIds(updatedNodes, [instanceId]);
      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile);
      return { nodes: updatedNodes, canvasFile: newFile };
    });
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
      let updatedNodes = memberIds.size > 0
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

      const movedNodeIds = memberIds.size > 0 ? Array.from(memberIds) : [];
      const changedBlueprintInstanceIds = new Set<string>();
      for (const nodeId of movedNodeIds) {
        const node = updatedNodes.find(candidate => candidate.id === nodeId)?.data;
        const instanceId = node?.meta?.blueprint_instance_id;
        if (instanceId) {
          changedBlueprintInstanceIds.add(instanceId);
        }
      }
      let nodeGroups = recalcGroupsForNodeIds(state.nodeGroups, updatedNodes, movedNodeIds);
      updatedNodes = syncGroupHubNodes(updatedNodes, nodeGroups);
      updatedNodes = recalcBlueprintContainersForInstanceIds(updatedNodes, changedBlueprintInstanceIds);

      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(updatedNodes, state.edges);
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges, boards: newBoards, nodeGroups };
      debouncedSave(newFile);

      return { boards: newBoards, nodes: updatedNodes, canvasFile: newFile, nodeGroups };
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
  setBlueprintDraft(draft) { set({ blueprintDraft: draft }); },
  clearBlueprintDraft() { set({ blueprintDraft: null }); },
  setBlueprintIndex(entries) {
    set(state => {
      if (!state.canvasFile) {
        return { blueprintIndex: entries };
      }

      const { nodes: hydratedNodes, changed } = hydrateBlueprintNodesFromIndex(state.nodes, entries);
      if (!changed) {
        return { blueprintIndex: entries };
      }

      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(hydratedNodes, state.edges);
      const normalizedFile = normalizeCanvasFileForRuntime(
        { ...state.canvasFile, nodes: cnNodes, edges: cnEdges },
        state.toolDefs,
      );
      const { flowNodes, flowEdges } = canvasToFlow(normalizedFile.nodes ?? [], normalizedFile.edges ?? []);
      const syncedFlowNodes = syncGroupHubNodes(flowNodes, normalizedFile.nodeGroups ?? []);
      debouncedSave(normalizedFile, 'immediate');

      return {
        blueprintIndex: entries,
        nodes: syncedFlowNodes,
        edges: flowEdges,
        boards: normalizedFile.boards ?? state.boards,
        nodeGroups: normalizedFile.nodeGroups ?? state.nodeGroups,
        canvasFile: normalizedFile,
      };
    });
  },

  migrateBlueprintDefinitions(definitions) {
    set(state => {
      if (!state.canvasFile || definitions.length === 0) {
        return {};
      }

      const migrated = migrateBlueprintInstancesAgainstDefinitions(
        state.nodes,
        state.edges,
        definitions,
        state.blueprintIndex,
        state.toolDefs,
      );
      if (!migrated.changed) {
        return {};
      }

      const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(migrated.nodes, migrated.edges);
      const normalizedFile = normalizeCanvasFileForRuntime({
        ...state.canvasFile,
        nodes: cnNodes,
        edges: cnEdges,
      }, state.toolDefs);
      const { flowNodes, flowEdges } = canvasToFlow(normalizedFile.nodes ?? [], normalizedFile.edges ?? []);
      const syncedFlowNodes = syncGroupHubNodes(flowNodes, normalizedFile.nodeGroups ?? []);
      debouncedSave(normalizedFile, 'immediate');
      return {
        nodes: syncedFlowNodes,
        edges: flowEdges,
        boards: normalizedFile.boards ?? state.boards,
        nodeGroups: normalizedFile.nodeGroups ?? state.nodeGroups,
        canvasFile: normalizedFile,
      };
    });
  },

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

  setPipelineNodeIssue(nodeId, issue) {
    set(s => {
      if (!s.pipelineState) { return {}; }
      const nextIssues = { ...s.pipelineState.nodeIssues };
      if (issue) {
        nextIssues[nodeId] = issue;
      } else {
        delete nextIssues[nodeId];
      }
      return {
        pipelineState: {
          ...s.pipelineState,
          nodeIssues: nextIssues,
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

  setPipelineCancelRequested(requested) {
    set(s => {
      if (!s.pipelineState) { return {}; }
      return {
        pipelineState: {
          ...s.pipelineState,
          cancelRequested: requested,
          isPaused: requested ? false : s.pipelineState.isPaused,
        },
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
    reconcileSaveStateAfterSaveAck(savedAt);
  },

  markSaveError(message, requestId) {
    const currentSerialized = serializeCanvasFile(get().canvasFile);
    if (requestId !== undefined) {
      const failedSerialized = inFlightSavePayloads.get(requestId);
      if (!failedSerialized) { return; }
      inFlightSavePayloads.delete(requestId);

      if (currentSerialized && currentSerialized === lastPersistedSerialized) {
        reconcileSaveStateAfterSaveAck();
        return;
      }

      if (currentSerialized && currentSerialized !== failedSerialized) {
        reconcileSaveStateAfterSaveAck();
        return;
      }
    }

    if (inFlightSavePayloads.size > 0) {
      set({
        saveState: 'saving',
        saveDueAt: null,
        saveError: null,
      });
      return;
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
  if (!settings) { return { provider: 'copilot', model: 'gpt-4.1' }; }
  const p = settings.globalProvider ?? 'copilot';
  let model = '';
  if (p === 'copilot')        { model = settings.copilotModel || 'gpt-4.1'; }
  else if (p === 'anthropic') { model = settings.anthropicModel ?? ''; }
  else if (p === 'ollama')    { model = settings.ollamaModel ?? ''; }
  else if (p === 'omlx')      { model = settings.omlxModel ?? ''; }
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
