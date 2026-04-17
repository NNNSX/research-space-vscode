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
  currentNodeId: string | null;
  validationWarnings: Array<{ nodeId: string; message: string }>;
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
  stagingNodes: CanvasNode[];
  pendingStagingMaterializations: Record<string, { position: { x: number; y: number } }>;
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
  blueprintDraft: BlueprintDraft | null;
  blueprintIndex: BlueprintRegistryEntry[];
  blueprintReplacementTargetNodeId: string | null;
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
  openPreview(nodeId: string): void;
  closePreview(): void;
  setBlueprintDraft(draft: BlueprintDraft | null): void;
  clearBlueprintDraft(): void;
  setBlueprintIndex(entries: BlueprintRegistryEntry[]): void;
  pushUndo(): void;
  undo(): void;
  redo(): void;
  // ── Pipeline state methods ──
  setPipelineState(state: PipelineState | null): void;
  updatePipelineNodeStatus(nodeId: string, status: PipelineNodeStatus): void;
  setPipelineNodeIssue(nodeId: string, issue: { kind: RunIssueKind; message: string } | null): void;
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

function computeBlueprintInstanceSize(entry: BlueprintRegistryEntry): { width: number; height: number } {
  const width = Math.max(DEFAULT_SIZES.blueprint.width, 700);
  const inputRows = Math.max(1, entry.input_slots);
  const outputRows = Math.max(1, entry.output_slots);
  const leftColumnHeight = 28 + inputRows * 62;
  const middleColumnHeight = 28 + Math.ceil(6 / 2) * 58;
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
  const middleColumnHeight = 28 + Math.ceil(6 / 2) * 58;
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

function createBlueprintContainerCanvasNode(
  entry: BlueprintRegistryEntry,
  definition: BlueprintDefinition,
  instanceId: string,
  bounds: Rect,
): CanvasNode {
  return {
    id: uuid(),
    node_type: 'blueprint',
    title: entry.title,
    position: { x: bounds.x, y: bounds.y },
    size: { width: bounds.width, height: bounds.height },
    meta: {
      ...buildBlueprintMetaFromEntry(entry),
      blueprint_instance_id: instanceId,
      blueprint_input_slot_defs: definition.input_slots,
      blueprint_output_slot_defs: definition.output_slots,
    },
  };
}

function syncBlueprintNodeFromEntry(node: FlowNode, entry: BlueprintRegistryEntry): FlowNode {
  const size = computeBlueprintInstanceSize(entry);
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
    const normalizedSize = computeBlueprintSizeFromNode(node);
    const sameWidth = node.size.width === normalizedSize.width;
    const sameHeight = node.size.height === normalizedSize.height;
    if (sameWidth && sameHeight) { return node; }
    changed = true;
    return { ...node, size: normalizedSize };
  });

  return changed ? { ...file, nodes: nextNodes } : file;
}

function preferredPlaceholderNodeType(slot: BlueprintSlotDef): CanvasNode['node_type'] {
  if (slot.kind === 'output') { return 'ai_output'; }
  const preferred = slot.accepts[0];
  if (preferred === 'paper' || preferred === 'image' || preferred === 'audio' || preferred === 'video') {
    return 'note';
  }
  return preferred ?? 'note';
}

function createBlueprintPlaceholderNode(
  slot: BlueprintSlotDef,
  instanceId: string,
  definition: BlueprintDefinition,
  position: { x: number; y: number },
): CanvasNode {
  const nodeType = preferredPlaceholderNodeType(slot);
  const prefix = slot.kind === 'input' ? '[输入占位]' : '[输出占位]';
  return {
    id: uuid(),
    node_type: nodeType,
    title: `${prefix} ${slot.title}`,
    position,
    size: {
      width: Math.max(220, slot.rect.width || DEFAULT_SIZES[nodeType].width),
      height: Math.max(120, slot.rect.height || DEFAULT_SIZES[nodeType].height),
    },
    meta: {
      blueprint_instance_id: instanceId,
      blueprint_def_id: definition.id,
      blueprint_color: definition.color,
      blueprint_placeholder_kind: slot.kind === 'input' ? 'input' : 'output',
      blueprint_placeholder_slot_id: slot.id,
      blueprint_placeholder_title: slot.title,
      blueprint_placeholder_accepts: [...slot.accepts],
      blueprint_placeholder_required: slot.required,
      blueprint_placeholder_allow_multiple: slot.allow_multiple,
      blueprint_placeholder_replacement_mode: slot.replacement_mode,
      blueprint_placeholder_hint: slot.binding_hint,
      content_preview: slot.binding_hint ?? (slot.kind === 'input'
        ? '将外部输入节点拖到此处，或直接把外部节点连到此占位节点。'
        : '运行完成后，最终输出会优先回填到此占位位置。'),
      card_content_mode: 'preview',
    },
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
    },
  };
}

function buildBlueprintInstanceArtifacts(
  entry: BlueprintRegistryEntry,
  definition: BlueprintDefinition,
  toolDefs: JsonToolDef[],
  origin: { x: number; y: number },
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const instanceId = uuid();
  const nodeIdByBlueprintRef = new Map<string, string>();
  const instantiatedNodes: CanvasNode[] = [];

  for (const slot of definition.input_slots) {
    const node = createBlueprintPlaceholderNode(slot, instanceId, definition, {
      x: origin.x + slot.rect.x,
      y: origin.y + slot.rect.y,
    });
    nodeIdByBlueprintRef.set(`input_slot:${slot.id}`, node.id);
    instantiatedNodes.push(node);
  }

  for (const slot of definition.output_slots) {
    const node = createBlueprintPlaceholderNode(slot, instanceId, definition, {
      x: origin.x + slot.rect.x,
      y: origin.y + slot.rect.y,
    });
    nodeIdByBlueprintRef.set(`output_slot:${slot.id}`, node.id);
    instantiatedNodes.push(node);
  }

  for (const dataNode of definition.data_nodes) {
    const node = createBlueprintInternalDataNode(dataNode, instanceId, definition, {
      x: origin.x + dataNode.rect.x,
      y: origin.y + dataNode.rect.y,
    });
    nodeIdByBlueprintRef.set(`data_node:${dataNode.id}`, node.id);
    instantiatedNodes.push(node);
  }

  for (const fnNode of definition.function_nodes) {
    const node = createBlueprintFunctionCanvasNode(fnNode, instanceId, definition, toolDefs, {
      x: origin.x + fnNode.rect.x,
      y: origin.y + fnNode.rect.y,
    });
    nodeIdByBlueprintRef.set(`function_node:${fnNode.id}`, node.id);
    instantiatedNodes.push(node);
  }

  const containerBounds = computeBlueprintContainerBounds(instantiatedNodes);
  const containerNode = createBlueprintContainerCanvasNode(entry, definition, instanceId, containerBounds);
  instantiatedNodes.push(containerNode);

  const flowNodes: FlowNode[] = instantiatedNodes.map(node => ({
    id: node.id,
    type: nodeTypeToFlowType(node.node_type),
    position: node.position,
    data: node,
    width: node.size.width,
    height: node.size.height,
    zIndex: isBlueprintInstanceContainerNode(node) ? -1 : undefined,
  }));

  const flowEdges: FlowEdge[] = [];
  for (const edge of definition.edges) {
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
const BLUEPRINT_REPLACEMENT_SNAP_DISTANCE = 132;

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

    const memberNodes = nodes
      .filter(candidate =>
        candidate.id !== node.id &&
        (
          candidate.data.meta?.blueprint_instance_id === instanceId ||
          candidate.data.meta?.blueprint_bound_instance_id === instanceId
        )
      )
      .map(candidate => candidate.data);
    if (memberNodes.length === 0) { return node; }

    const bounds = computeBlueprintContainerBounds(memberNodes);
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
      zIndex: -1,
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

function getCanvasNodeRect(node: Pick<CanvasNode, 'position' | 'size'>): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.size.width,
    height: node.size.height,
  };
}

function getRectCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function calcRectOverlapArea(a: Rect, b: Rect): number {
  const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlapWidth * overlapHeight;
}

function canReplaceBlueprintPlaceholderWithNode(
  placeholderNode: CanvasNode,
  draggedNode: CanvasNode,
  flowEdges: FlowEdge[],
): boolean {
  if (!isBlueprintInputPlaceholderNode(placeholderNode)) { return false; }
  if (placeholderNode.meta?.blueprint_placeholder_replacement_mode !== 'replace_with_bound_node') { return false; }
  if (!isDataNode(draggedNode) || !!draggedNode.meta?.blueprint_placeholder_kind) { return false; }
  if (
    draggedNode.meta?.blueprint_instance_id &&
    draggedNode.meta.blueprint_instance_id === placeholderNode.meta?.blueprint_instance_id
  ) {
    return false;
  }

  const accepts = placeholderNode.meta?.blueprint_placeholder_accepts ?? [];
  if (accepts.length > 0 && !accepts.includes(draggedNode.node_type)) { return false; }
  if (placeholderNode.meta?.blueprint_placeholder_allow_multiple) { return false; }

  return !flowEdges.some(edge =>
    edge.target === placeholderNode.id &&
    edge.data?.edge_type === 'data_flow' &&
    edge.source !== draggedNode.id
  );
}

function findBlueprintPlaceholderReplacementTarget(
  draggedNode: CanvasNode,
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
): FlowNode | null {
  if (!isDataNode(draggedNode) || !!draggedNode.meta?.blueprint_placeholder_kind) { return null; }
  const draggedRect = getCanvasNodeRect(draggedNode);
  const draggedCenter = getRectCenter(draggedRect);

  let best: { node: FlowNode; score: number } | null = null;
  for (const candidate of flowNodes) {
    if (candidate.id === draggedNode.id) { continue; }
    const candidateNode = candidate.data;
    if (!canReplaceBlueprintPlaceholderWithNode(candidateNode, draggedNode, flowEdges)) { continue; }

    const candidateRect = getCanvasNodeRect(candidateNode);
    const overlapArea = calcRectOverlapArea(draggedRect, candidateRect);
    const candidateCenter = getRectCenter(candidateRect);
    const distance = Math.hypot(draggedCenter.x - candidateCenter.x, draggedCenter.y - candidateCenter.y);
    const snapDistance = Math.max(
      88,
      Math.min(
        BLUEPRINT_REPLACEMENT_SNAP_DISTANCE,
        Math.max(candidateRect.width, candidateRect.height) * 0.55,
      ),
    );

    if (overlapArea <= 0 && distance > snapDistance) { continue; }
    const overlapBonus = overlapArea > 0 ? overlapArea / Math.max(1, candidateRect.width * candidateRect.height) : 0;
    const score = overlapBonus > 0 ? -overlapBonus : distance / snapDistance;
    if (!best || score < best.score) {
      best = { node: candidate, score };
    }
  }

  return best?.node ?? null;
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

function applyBlueprintPlaceholderReplacement(
  draggedNodeId: string,
  placeholderNodeId: string,
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const placeholderFlowNode = flowNodes.find(node => node.id === placeholderNodeId);
  const draggedFlowNode = flowNodes.find(node => node.id === draggedNodeId);
  if (!placeholderFlowNode || !draggedFlowNode) {
    return { nodes: flowNodes, edges: flowEdges };
  }

  const replacementPosition = { ...placeholderFlowNode.position };
  const placeholderNode = placeholderFlowNode.data;
  const nextNodes = flowNodes
    .filter(node => node.id !== placeholderNodeId)
    .map(node => {
      if (node.id !== draggedNodeId) { return node; }
      return {
        ...node,
        position: replacementPosition,
        data: {
          ...node.data,
          position: replacementPosition,
          meta: {
            ...(node.data.meta ?? {}),
            blueprint_bound_instance_id: placeholderNode.meta?.blueprint_instance_id,
            blueprint_bound_slot_id: placeholderNode.meta?.blueprint_placeholder_slot_id,
            blueprint_bound_slot_title: placeholderNode.meta?.blueprint_placeholder_title,
            blueprint_bound_slot_kind: 'input',
          },
        },
      };
    });

  const nextEdges: FlowEdge[] = [];
  for (const edge of flowEdges) {
    const touchesPlaceholder = edge.source === placeholderNodeId || edge.target === placeholderNodeId;
    if (!touchesPlaceholder) {
      nextEdges.push(edge);
      continue;
    }

    if (edge.target === placeholderNodeId && edge.data?.edge_type === 'data_flow') {
      continue;
    }

    if (edge.source === placeholderNodeId) {
      const reboundEdge: FlowEdge = {
        ...edge,
        id: uuid(),
        source: draggedNodeId,
      };
      if (!nextEdges.some(existing => sameEdgeSemantics(existing, reboundEdge))) {
        nextEdges.push(reboundEdge);
      }
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
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
    nodes: [
      ...flowNodes,
      {
        id: generatedNode.id,
        type: nodeTypeToFlowType(generatedNode.node_type),
        position: generatedNode.position,
        data: generatedNode,
        width: generatedNode.size.width,
        height: generatedNode.size.height,
      },
    ],
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
  const filledNode: CanvasNode = {
    ...generatedNode,
    title: slotTitle ?? generatedNode.title,
    position: { ...fillTargetNode.position },
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

  const nextNodes = flowNodes
    .filter(node => node.id !== fillTargetNode.id)
    .concat({
      id: filledNode.id,
      type: nodeTypeToFlowType(filledNode.node_type),
      position: filledNode.position,
      data: filledNode,
      width: filledNode.size.width,
      height: filledNode.size.height,
    });

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
    if (!nextEdges.some(existing => sameEdgeSemantics(existing, reboundEdge))) {
      nextEdges.push(reboundEdge);
    }
  }

  const generatedFlowEdge: FlowEdge = {
    id: generatedEdge.id,
    source: generatedEdge.source,
    target: filledNode.id,
    type: 'custom',
    data: { edge_type: generatedEdge.edge_type },
    animated: generatedEdge.edge_type === 'ai_generated',
  };
  if (!nextEdges.some(existing => sameEdgeSemantics(existing, generatedFlowEdge))) {
    nextEdges.push(generatedFlowEdge);
  }

  return { nodes: nextNodes, edges: nextEdges, filledInstanceId: instanceId };
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
      } else if (isBlueprintInstanceContainerNode(n)) {
        base.zIndex = -1;
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
  blueprintReplacementTargetNodeId: null,
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
    const normalized = normalizeBlueprintNodes(normalizeNodeGroups(data));
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
      blueprintDraft: null,
      blueprintReplacementTargetNodeId: null,
      saveState: 'saved',
      saveDueAt: null,
      lastSavedAt: Date.now(),
      saveError: null,
      initialCanvasRenderReady: normalized.nodes.length < INITIAL_CANVAS_LOAD_NODE_THRESHOLD,
    });
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
          const memberIds = instanceId ? [
            ...getBlueprintContainerMemberIds(instanceId, stateAtStart.nodes),
            ...getBlueprintContainerBoundExternalIds(instanceId, stateAtStart.nodes),
          ] : [];

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
      const activelyDraggedNode = expandedChanges
        .filter((change): change is Extract<NodeChange, { type: 'position' }> => change.type === 'position' && !!change.dragging)
        .map(change => updated.find(node => node.id === change.id)?.data)
        .find((node): node is CanvasNode => !!node);
      const activelyDraggedIds = expandedChanges
        .filter((change): change is Extract<NodeChange, { type: 'position' }> => change.type === 'position' && !!change.dragging)
        .map(change => change.id);
      const replacementPreviewNodeId = activelyDraggedIds.length === 1
        && activelyDraggedNode
        ? findBlueprintPlaceholderReplacementTarget(activelyDraggedNode, updated, state.edges)?.id ?? null
        : null;

      const removedIds = new Set(
        expandedChanges.filter(c => c.type === 'remove').map(c => c.id)
      );
      const movedIds = new Set(
        expandedChanges.filter(c => c.type === 'position').map(c => c.id)
      );
      const changedBlueprintInstanceIds = new Set<string>();
      for (const node of updated) {
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
        nodeGroups = recalcGroupsForNodeIds(nodeGroups, updated, movedIds);
      }

      const activeHubIds = new Set(nodeGroups.map(group => group.hubNodeId));
      const prunedNodes = updated.filter(node => !isGroupHubNodeType(node.data.node_type) || activeHubIds.has(node.id));
      let prunedEdges = state.edges.filter(edge => {
        if (isHubEdgeType(edge.data?.edge_type)) {
          return activeHubIds.has(edge.target);
        }
        const sourceExists = prunedNodes.some(node => node.id === edge.source);
        const targetExists = prunedNodes.some(node => node.id === edge.target);
        return sourceExists && targetExists;
      });
      let finalNodes = prunedNodes;
      let replacementTargetNodeId = replacementPreviewNodeId;

      if (dragEnded && expandedChanges.length > 0) {
        const droppedIds = Array.from(new Set(
          expandedChanges
            .filter((change): change is Extract<NodeChange, { type: 'position' }> => change.type === 'position')
            .map(change => change.id)
        ));
        if (droppedIds.length === 1) {
          const draggedNode = finalNodes.find(node => node.id === droppedIds[0])?.data;
          const replacementTarget = draggedNode
            ? findBlueprintPlaceholderReplacementTarget(draggedNode, finalNodes, prunedEdges)
            : null;
          if (draggedNode && replacementTarget) {
            const replaced = applyBlueprintPlaceholderReplacement(
              draggedNode.id,
              replacementTarget.id,
              finalNodes,
              prunedEdges,
            );
            finalNodes = replaced.nodes;
            prunedEdges = replaced.edges;
            removedIds.add(replacementTarget.id);
          }
        }
        replacementTargetNodeId = null;
      }
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
        blueprintReplacementTargetNodeId: replacementTargetNodeId,
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
      const replacementTarget = findBlueprintPlaceholderReplacementTarget(placed, state.nodes, state.edges);
      if (replacementTarget) {
        const placedFlowNode: FlowNode = {
          id: placed.id,
          type: nodeTypeToFlowType(placed.node_type),
          position,
          data: placed,
          width: placed.size.width,
          height: placed.size.height,
        };
        const { nodes: replacedNodes, edges: replacedEdges } = applyBlueprintPlaceholderReplacement(
          placed.id,
          replacementTarget.id,
          [...state.nodes, placedFlowNode],
          state.edges,
        );
        const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(replacedNodes, replacedEdges);
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
          nodes: replacedNodes,
          edges: replacedEdges,
          canvasFile: newFile,
          stagingNodes: remainingStaging,
          blueprintReplacementTargetNodeId: null,
        };
      }

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
        blueprintReplacementTargetNodeId: null,
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
      const replacementTarget = findBlueprintPlaceholderReplacementTarget(placed, state.nodes, state.edges);
      if (replacementTarget) {
        const placedFlowNode: FlowNode = {
          id: placed.id,
          type: nodeTypeToFlowType(placed.node_type),
          position,
          data: placed,
          width: placed.size.width,
          height: placed.size.height,
        };
        const { nodes: replacedNodes, edges: replacedEdges } = applyBlueprintPlaceholderReplacement(
          placed.id,
          replacementTarget.id,
          [...state.nodes, placedFlowNode],
          state.edges,
        );
        const { nodes: cnNodes, edges: cnEdges } = flowToCanvas(replacedNodes, replacedEdges);
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
          nodes: replacedNodes,
          edges: replacedEdges,
          canvasFile: newFile,
          stagingNodes: remainingStaging,
          blueprintReplacementTargetNodeId: null,
          pendingStagingMaterializations: pendingMap,
        };
      }

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
        blueprintReplacementTargetNodeId: null,
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
      const newFile: CanvasFile = { ...state.canvasFile, nodes: cnNodes, edges: cnEdges };
      debouncedSave(newFile, 'immediate');

      return {
        blueprintIndex: entries,
        nodes: hydratedNodes,
        canvasFile: newFile,
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
