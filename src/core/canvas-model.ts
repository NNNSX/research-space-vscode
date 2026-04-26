import type { BlueprintDraft, BlueprintDefinition, BlueprintSlotDef } from '../blueprint/blueprint-types';
import type { BlueprintRegistryEntry } from '../blueprint/blueprint-registry';
import type { BlueprintReplacementMode } from '../blueprint/blueprint-types';

// ── AI Model info ────────────────────────────────────────────────────────────
export interface ModelInfo {
  id: string;          // Model identifier passed to the API
  name: string;        // Human-readable display name
  description?: string;
  tier?: string;       // Reserved for future use (e.g. provider-specific tier info)
}

// ── Custom provider configuration ────────────────────────────────────────────
export interface CustomProviderConfig {
  id: string;          // uuid — internal unique key
  name: string;        // Display name
  baseUrl: string;     // OpenAI-compatible base URL (e.g. https://aihubmix.com/v1)
  apiKey: string;
  defaultModel: string;
}

// ── Settings snapshot (Extension → Webview) ──────────────────────────────────
export interface SettingsSnapshot {
  globalProvider: string;
  copilotModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  omlxBaseUrl: string;
  omlxApiKey: string;
  omlxModel: string;
  maxOutputTokens?: number;
  maxContextTokens?: number;
  autoSave: boolean;
  customProviders: CustomProviderConfig[];
  favoriteModels?: Record<string, string[]>;
  aiHubMixApiKey?: string;          // AIHubMix API Key for multimodal tools (v0.5.0)
  aiHubMixImageGenModel?: string;   // Default model for image generation (v0.6.2)
  aiHubMixImageEditModel?: string;  // Default model for image editing (v0.6.2)
  aiHubMixImageFusionModel?: string; // Default model for image fusion (v2.1.0-alpha.29)
  aiHubMixImageGroupModel?: string;  // Default model for grouped image output (v2.1.0-alpha.29)
  aiHubMixTtsModel?: string;        // Default model for TTS (v0.6.2)
  aiHubMixSttModel?: string;        // Default model for STT (v0.6.2)
  aiHubMixVideoGenModel?: string;   // Default model for video generation (v0.6.2)
  mineruApiMode: 'precise' | 'agent' | 'local';
  mineruApiBaseUrl: string;
  mineruApiToken: string;
  mineruModelVersion: 'pipeline' | 'vlm' | 'MinerU-HTML';
  mineruPollIntervalMs: number;
  mineruPollTimeoutMs: number;
  mineruLocalApiUrl: string;
  petAiProvider?: string;            // Pet AI provider override: 'auto' | provider id (v0.10.7)
  petAiModel?: string;               // Pet AI model override (empty = provider default) (v0.10.7)
  testMode?: boolean;
}

export type ConversionDiagnosticStatus = 'ok' | 'warning' | 'error' | 'unknown';

export interface ConversionDiagnosticItem {
  id: string;
  title: string;
  status: ConversionDiagnosticStatus;
  summary: string;
  detail?: string;
}

export interface ConversionDiagnosticsReport {
  checkedAt: number;
  platform: NodeJS.Platform | string;
  items: ConversionDiagnosticItem[];
  summary: Record<ConversionDiagnosticStatus, number>;
}

// ── Node types ─────────────────────────────────────────────────────────────
export type DataNodeType = 'paper' | 'note' | 'code' | 'image' | 'ai_output' | 'audio' | 'video' | 'experiment_log' | 'task' | 'data';
export type NodeType = DataNodeType | 'function' | 'group_hub' | 'blueprint';
export type FnStatus = 'idle' | 'running' | 'done' | 'error';
export type RunIssueKind = 'missing_input' | 'missing_config' | 'run_failed' | 'skipped';
export type AiTool = 'summarize' | 'polish' | 'review' | 'translate' | 'draw' | 'rag' | 'chat';
export type EdgeType = 'data_flow' | 'pipeline_flow' | 'ai_generated' | 'reference' | 'hub_member';

// ── Parameter definitions ───────────────────────────────────────────────────
export interface ParamDef {
  name: string;
  type: 'select' | 'text' | 'number' | 'boolean';
  label: string;
  options?: string[];
  default?: unknown;
  required?: boolean;
}

// ── Node metadata ───────────────────────────────────────────────────────────
export interface NodeMeta {
  // Data nodes
  content_preview?: string;
  card_content_mode?: 'preview' | 'full';  // card text display mode for lazy full-content hydration
  file_missing?: boolean;
  page_count?: number;          // paper
  language?: string;            // code
  display_mode?: 'file' | 'mermaid';  // image
  mermaid_code?: string;        // image (mermaid mode)

  // AI output metadata
  ai_provider?: string;      // provider id used to generate this output
  ai_model?: string;         // model name/id used to generate this output
  input_schema?: ParamDef[];
  param_values?: Record<string, unknown>;
  ai_tool?: string;               // bound tool id (function nodes)
  input_order?: string[];        // user-defined ordering of upstream node IDs
  fn_status?: FnStatus;
  fn_progress?: string;
  fn_issue_kind?: RunIssueKind;
  fn_issue_message?: string;
  run_guard?: 'always' | 'on-change' | 'manual-confirm';  // F2: run condition
  input_hash?: string;           // F2: hash of last run's inputs (for on-change guard)

  // SR3: Experiment log node
  experiment_name?: string;
  experiment_date?: string;
  experiment_params?: string;   // free text, e.g. "lr=0.001, bs=32"
  experiment_result?: string;
  experiment_status?: 'running' | 'done' | 'failed';

  // PM1: Task node
  task_items?: Array<{ id: string; label: string; done: boolean }>;

  // v2.0: AI content understanding indicator
  ai_readable_chars?: number;       // Total AI-readable character count
  ai_readable_pages?: number;       // AI-readable page count (PDF)
  has_unreadable_content?: boolean;  // True if content has elements AI cannot read (charts, formulas in images)
  unreadable_hint?: string;          // Human-readable hint, e.g. "检测到 12 个图表引用，图片内容未识别"
  csv_rows?: number;                 // CSV/TSV row count (excluding header)
  csv_cols?: number;                 // CSV/TSV column count

  // Staging metadata
  staging_origin?: 'workspace_file' | 'draft';
  staging_materialize_kind?: 'note' | 'experiment_log' | 'task';
  staging_initial_content?: string;

  // Group hub metadata
  hub_group_id?: string;             // visual node-group container id

  // Explosion metadata
  explode_session_id?: string;
  explode_provider?: 'mineru';
  explode_source_file_path?: string;
  explode_source_node_id?: string;
  explode_source_hash?: string;
  explode_status?: 'running' | 'ready' | 'failed' | 'stale';
  explode_source_type?: 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'image' | 'unknown';
  exploded_from_node_id?: string;
  explode_unit_type?: 'page' | 'slide' | 'sheet' | 'section';
  explode_unit_index?: number;
  explode_kind?: 'text' | 'image' | 'table' | 'chart' | 'equation';
  explode_order?: number;
  explode_bbox?: [number, number, number, number];

  // Blueprint instance metadata
  blueprint_def_id?: string;
  blueprint_file_path?: string;
  blueprint_color?: string;
  blueprint_version?: string;
  blueprint_input_slots?: number;
  blueprint_output_slots?: number;
  blueprint_intermediate_slots?: number;
  blueprint_function_count?: number;
  blueprint_input_slot_defs?: BlueprintSlotDef[];
  blueprint_output_slot_defs?: BlueprintSlotDef[];
  blueprint_instance_id?: string;
  blueprint_bound_instance_id?: string;
  blueprint_bound_slot_id?: string;
  blueprint_bound_slot_title?: string;
  blueprint_bound_slot_kind?: 'input' | 'output';
  blueprint_source_kind?: 'data_node' | 'function_node';
  blueprint_source_id?: string;
  blueprint_placeholder_kind?: 'input' | 'output';
  blueprint_placeholder_slot_id?: string;
  blueprint_placeholder_title?: string;
  blueprint_placeholder_accepts?: Array<Exclude<NodeType, 'function' | 'group_hub'>>;
  blueprint_placeholder_required?: boolean;
  blueprint_placeholder_allow_multiple?: boolean;
  blueprint_placeholder_replacement_mode?: BlueprintReplacementMode;
  blueprint_placeholder_hint?: string;
  blueprint_output_position_manual?: boolean;
  blueprint_runtime_hidden?: boolean;
  blueprint_definition_missing?: boolean;
  blueprint_definition_missing_message?: string;
  blueprint_last_run_status?: BlueprintLastRunStatus;
  blueprint_last_run_summary?: string;
  blueprint_last_run_finished_at?: string;
  blueprint_last_run_succeeded_at?: string;
  blueprint_last_run_failed_at?: string;
  blueprint_last_run_total_nodes?: number;
  blueprint_last_run_completed_nodes?: number;
  blueprint_last_run_failed_nodes?: number;
  blueprint_last_run_skipped_nodes?: number;
  blueprint_last_run_warning_count?: number;
  blueprint_last_issue_node_id?: string;
  blueprint_last_issue_node_title?: string;
  blueprint_run_history?: BlueprintRunHistoryEntry[];
}

// ── Canvas node ─────────────────────────────────────────────────────────────
export interface CanvasNode {
  id: string;
  node_type: NodeType;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  file_path?: string;           // Relative to .rsws directory
  meta?: NodeMeta;
}

export type DataCanvasNode = CanvasNode & { node_type: DataNodeType };
export type FunctionCanvasNode = CanvasNode & { node_type: 'function' };
export type GroupHubCanvasNode = CanvasNode & { node_type: 'group_hub' };
export type BlueprintCanvasNode = CanvasNode & { node_type: 'blueprint' };
export type BlueprintPlaceholderCanvasNode = CanvasNode & {
  meta: NodeMeta & { blueprint_placeholder_kind: 'input' | 'output' };
};
export type BlueprintInputPlaceholderCanvasNode = CanvasNode & {
  meta: NodeMeta & { blueprint_placeholder_kind: 'input' };
};
export type BlueprintOutputPlaceholderCanvasNode = CanvasNode & {
  meta: NodeMeta & { blueprint_placeholder_kind: 'output' };
};
export type BlueprintInstanceContainerCanvasNode = BlueprintCanvasNode & {
  meta: NodeMeta & { blueprint_instance_id: string };
};

// ── Canvas edge ─────────────────────────────────────────────────────────────
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  edge_type: EdgeType;
  label?: string;
  role?: string;  // Semantic slot id (e.g. "primary", "reference"). Undefined = generic input.
}

// ── Slot definition for function tool inputs ─────────────────────────────────
export interface SlotDef {
  name: string;         // Unique slot id, e.g. "primary"
  label: string;        // Display label shown to user, e.g. "原文"
  description: string;  // Explanation shown in role picker dialog
  required?: boolean;   // Whether at least one edge must be bound to this slot
  multiple?: boolean;   // Whether multiple edges can bind to this slot (default false)
}

// ── Data node type definition (for DataNodeRegistry) ────────────────────────
export interface DataNodeDef {
  id: string;             // matches DataNodeType
  label: string;          // human-readable name
  icon: string;           // emoji icon
  color: string;          // CSS color variable for accent
  extensions: string[];   // file extensions (without dot) that map to this node type
  previewType: 'text' | 'markdown' | 'none';  // how content_preview is rendered in the card
  watchContent: boolean;  // whether to refresh content_preview on file change
  contentExtractor: 'pdf' | 'image' | 'text' | 'audio' | 'video'; // which extractor to use
  supportsMultimodal: boolean;                 // true = image node (passes base64 to AI)
  languageMap?: Record<string, string>;        // ext → language label (code nodes only)
}

// ── JSON-driven tool definition (shareable) ──────────────────────────────────
// Defined here (not in tool-registry.ts) so both Extension and Webview can use
// the type without pulling in VSCode Node.js APIs.
export interface JsonToolDef {
  id: string;
  name: string;
  description: string;
  icon: string;                           // codicon name
  supportsImages: boolean;
  outputNodeType: 'ai_output' | 'image' | 'audio' | 'video';
  params: ParamDef[];
  /** Optional value maps: { paramName: { value: displayText } } */
  paramMaps?: Record<string, Record<string, string>>;
  /** System prompt template. {{param}} = direct, {{param:map}} = lookup in paramMaps. */
  systemPromptTemplate: string;
  /** Named post-processor id. null = pass through as-is. */
  postProcessType: string | null;
  /** UI rendering mode. 'chat' enables the rich prompt editor with file @references. */
  uiMode?: 'default' | 'chat';
  /** API type for multimodal / system tools. 'chat' (default) uses the LLM streaming path. 'explosion' is the legacy id for the built-in file conversion path. */
  apiType?: 'chat' | 'image_generation' | 'image_edit' | 'tts' | 'stt' | 'video_generation' | 'explosion';
  /** Named input slots. When defined, connecting a data node triggers a role picker dialog. */
  slots?: SlotDef[];
  /** Tool category for panel grouping. */
  category?: 'text' | 'research' | 'multimodal' | 'project' | 'general';
}

// ── Output history entry ────────────────────────────────────────────────────
export interface OutputHistoryEntry {
  filePath: string;    // relative path (same format as node.file_path)
  filename: string;    // basename for display
  nodeType: 'ai_output' | 'image' | 'audio' | 'video';
  preview: string;     // first ~200 chars of the file
  isCurrent: boolean;  // true if this matches the current node's file_path
  isPrevious?: boolean; // true if this is the latest non-current version
  versionRole?: 'current' | 'previous' | 'history';
  sourceNodeId?: string;
  sourceNodeTitle?: string;
}

export interface OutputHistoryPayload {
  nodeId: string;
  entries: OutputHistoryEntry[];
  scope?: 'node' | 'blueprint_slot';
  title?: string;
  subtitle?: string;
}

export interface BlueprintRunHistoryEntry {
  id: string;
  finishedAt: string;
  status: BlueprintLastRunStatus;
  summary: string;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  skippedNodes: number;
  warningCount: number;
  issueNodeId?: string;
  issueNodeTitle?: string;
  mode?: 'full' | 'resume';
  reusedCachedNodeCount?: number;
}

export interface PipelineStartPayload {
  pipelineId: string;
  triggerNodeId: string;
  nodeIds: string[];
  totalNodes: number;
  initialNodeStatuses?: Record<string, 'waiting' | 'running' | 'done' | 'failed' | 'skipped'>;
  initialCompletedNodes?: number;
  runMode?: 'full' | 'resume';
  reusedCachedNodeCount?: number;
}

export interface PetChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type GroundThemeId = 'none' | 'forest' | 'castle' | 'autumn' | 'beach' | 'winter';
export type PetTypeId = 'dog' | 'fox' | 'rubber-duck' | 'turtle' | 'crab' | 'clippy' | 'cockatiel';
export type BlueprintLastRunStatus = 'succeeded' | 'failed' | 'cancelled';
export type PipelineCompletionStatus = 'succeeded' | 'failed' | 'cancelled';

export interface PetState {
  petType: PetTypeId;
  petName: string;
  mood: number;
  energy: number;
  exp: number;
  level: number;
  totalWorkMinutes: number;
  currentSessionStart: string;
  lastInteraction: string;
  unlockedPets: PetTypeId[];
  streakDays: number;
  widgetAnchor?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  widgetOffsetX?: number;
  widgetOffsetY?: number;
  widgetLeft?: number;
  widgetTop?: number;
  miniGameStatsDate?: string;
  snakeLastScore?: number;
  snakeBestScoreToday?: number;
  snakeBestScore?: number;
  snakeLastPlayedAt?: string;
  twenty48LastScore?: number;
  twenty48BestScoreToday?: number;
  twenty48BestScore?: number;
  twenty48LastPlayedAt?: string;
  sudokuLastScore?: number;
  sudokuBestScoreToday?: number;
  sudokuBestScore?: number;
  sudokuLastPlayedAt?: string;
  flappyLastScore?: number;
  flappyBestScoreToday?: number;
  flappyBestScore?: number;
  flappyLastPlayedAt?: string;
}

export type PetSettingsKey = 'pet.enabled' | 'pet.groundTheme' | 'pet.restReminder';

// ── Canvas file (.rsws) ─────────────────────────────────────────────────────

/** @deprecated Use Board instead — kept for migration only */
export interface SummaryGroup {
  id: string;
  name: string;
  color?: string;
  nodeIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
}

export interface Board {
  id: string;
  name: string;
  color: string;          // semi-transparent fill, e.g. 'rgba(79,195,247,0.12)'
  borderColor: string;    // solid border color, e.g. '#4fc3f7'
  bounds: { x: number; y: number; width: number; height: number };
}

export interface NodeGroup {
  id: string;
  name: string;
  /**
   * Persistent hub node id for this group. External connections always bind
   * to the hub node; member connections remain hidden as `hub_member` edges
   * and are expanded only when collecting execution inputs.
   */
  hubNodeId: string;
  sourceNodeId?: string;
  nodeIds: string[];
  color?: string;
  borderColor?: string;
  bounds: { x: number; y: number; width: number; height: number };
  collapsed: boolean;
}

export interface CanvasFile {
  version: '1.0';
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  metadata: {
    title: string;
    created_at: string;
    updated_at: string;
  };
  stagingNodes?: CanvasNode[];  // Nodes waiting to be placed on canvas (persisted)
  summaryGroups?: SummaryGroup[];  // @deprecated — migrated to boards on load
  boards?: Board[];
  nodeGroups?: NodeGroup[];
}

// ── Type guards ─────────────────────────────────────────────────────────────
export function isCanvasFile(obj: unknown): obj is CanvasFile {
  if (typeof obj !== 'object' || obj === null) { return false; }
  const f = obj as Record<string, unknown>;
  return (
    f['version'] === '1.0' &&
    Array.isArray(f['nodes']) &&
    Array.isArray(f['edges']) &&
    typeof f['viewport'] === 'object' &&
    typeof f['metadata'] === 'object'
  );
}

export function isDataNode(node: CanvasNode | undefined | null): node is DataCanvasNode {
  return !!node && ['paper', 'note', 'code', 'image', 'ai_output', 'audio', 'video', 'experiment_log', 'task', 'data'].includes(node.node_type);
}

export function isFunctionNode(node: CanvasNode | undefined | null): node is FunctionCanvasNode {
  return !!node && node.node_type === 'function';
}

export function isBlueprintPlaceholderNode(node: CanvasNode | undefined | null): node is BlueprintPlaceholderCanvasNode {
  return !!node && !!node.meta?.blueprint_placeholder_kind;
}

export function isBlueprintInputPlaceholderNode(node: CanvasNode | undefined | null): node is BlueprintInputPlaceholderCanvasNode {
  return !!node && node.meta?.blueprint_placeholder_kind === 'input';
}

export function isBlueprintOutputPlaceholderNode(node: CanvasNode | undefined | null): node is BlueprintOutputPlaceholderCanvasNode {
  return !!node && node.meta?.blueprint_placeholder_kind === 'output';
}

export function isBlueprintInstanceContainerNode(node: CanvasNode | undefined | null): node is BlueprintInstanceContainerCanvasNode {
  return !!node && node.node_type === 'blueprint' && !!node.meta?.blueprint_instance_id;
}

/**
 * Group hubs are first-class canvas nodes. Their rendered body may be visually
 * transparent so grouped children stay interactive, but their graph semantics
 * must stay aligned with ordinary nodes for drag/select/connect/delete.
 */
export function isGroupHubNode(node: CanvasNode | undefined | null): node is GroupHubCanvasNode {
  return !!node && node.node_type === 'group_hub';
}

export function isGroupHubNodeType(type: NodeType | undefined | null): boolean {
  return type === 'group_hub';
}

export function isHubEdgeType(edgeType: EdgeType | undefined | null): boolean {
  return edgeType === 'hub_member';
}

// ── Webview ↔ Extension message protocol ───────────────────────────────────
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'requestSettingsSnapshot' }
  | { type: 'requestConversionDiagnostics' }
  | { type: 'canvasStateSync'; data: CanvasFile }
  | { type: 'canvasChanged'; data: CanvasFile; requestId?: number }
  | { type: 'saveCanvas'; data: CanvasFile; requestId?: number }
  | { type: 'openFile'; filePath: string }
  | { type: 'runFunction'; nodeId: string; canvas?: CanvasFile }
  | { type: 'runBatchFunction'; nodeId: string; canvas?: CanvasFile }
  | { type: 'cancelAI'; runId: string }
  | { type: 'requestImageUri'; filePath: string }
  | { type: 'requestModels'; provider: string }
  | { type: 'addFiles' }
  | { type: 'dropFiles'; uris: string[] }
  | { type: 'newNote'; title: string }
  | { type: 'newExperimentLog'; title: string }
  | { type: 'newTask'; title: string }
  | {
      type: 'materializeStagingNode';
      sourceNodeId: string;
      nodeType: 'note' | 'experiment_log' | 'task';
      title: string;
      position: { x: number; y: number };
      content: string;
    }
  | { type: 'syncDataNodeFile'; nodeId: string; content: string }
  | { type: 'deleteNote'; filePath: string }
  | { type: 'renameNode'; nodeId: string; newTitle: string }
  | { type: 'updateSettings'; key: string; value: unknown }
  | { type: 'importTool' }
  | { type: 'exportTool'; toolId: string }
  | { type: 'deleteTool'; toolId: string }
  | { type: 'createFunctionNode'; toolId: string; title?: string; paramValues?: Record<string, unknown> }
  | {
      type: 'requestOutputHistory';
      nodeId: string;
      filePath: string;
      blueprintInstanceId?: string;
      blueprintSlotId?: string;
      blueprintSlotTitle?: string;
    }
  | { type: 'restoreOutputVersion'; filePath: string }
  | { type: 'requestFileContent'; filePath: string; requestId: string }
  | { type: 'previewFile'; filePath: string }
  | { type: 'explodePdfNode'; nodeId: string }
  | { type: 'runPipeline'; triggerNodeId: string; canvas?: CanvasFile }
  | { type: 'runBlueprint'; nodeId: string; canvas?: CanvasFile; resumeFromFailure?: boolean }
  | { type: 'createBlueprintDraft'; selectedNodeIds: string[]; canvas?: CanvasFile }
  | { type: 'createBlueprintDraftFromInstance'; nodeId: string; canvas?: CanvasFile }
  | { type: 'editBlueprintDraft'; filePath: string }
  | { type: 'saveBlueprintDraft'; draft: BlueprintDefinition & { source_file_path?: string } }
  | { type: 'requestBlueprintIndex'; sessionId?: number }
  | { type: 'requestBlueprintDefinitions'; filePaths: string[]; sessionId?: number }
  | { type: 'instantiateBlueprint'; filePath: string; position?: { x: number; y: number } }
  | { type: 'pipelinePause'; pipelineId: string }
  | { type: 'pipelineResume'; pipelineId: string }
  | { type: 'pipelineCancel'; pipelineId: string }
  | { type: 'petSettingChanged'; key: PetSettingsKey; value: boolean | number | GroundThemeId }
  | { type: 'savePetState'; state: PetState }
  | { type: 'petSaveMemory'; content: string }
  | {
      type: 'petAiChat';
      requestId: string;
      petName: string;
      personality: string;
      messages: PetChatMessage[];
      mode: 'chat' | 'suggestion';
    };

export type ExtensionMessage =
  | { type: 'init'; data: CanvasFile; workspaceRoot: string; sessionId?: number }
  | { type: 'canvasSaveStatus'; status: 'saved' | 'error'; savedAt?: number; message?: string; mode?: 'auto' | 'manual'; requestId?: number }
  | {
      type: 'petInit';
      petState: PetState | null;
      petEnabled: boolean;
      restReminderMin: number;
      groundTheme?: GroundThemeId;
    }
  | { type: 'petAssetsBase'; uri: string }
  | { type: 'petAiChatResponse'; requestId: string; text: string; success: boolean }
  | { type: 'toolDefs'; tools: JsonToolDef[] }
  | { type: 'toolDefError'; message: string }
  | { type: 'nodeDefs'; defs: DataNodeDef[] }
  | { type: 'nodeAdded'; node: CanvasNode }
  | { type: 'stageNodes'; nodes: CanvasNode[] }
  | { type: 'nodeFileStatus'; nodeId: string; missing: boolean }
  | { type: 'nodeFileMoved'; nodeId: string; newFilePath: string; newTitle: string }
  | { type: 'nodeContentUpdate'; nodeId: string; preview: string; metaPatch?: Partial<NodeMeta> }
  | { type: 'toastError'; message: string }
  | { type: 'fnStatusUpdate'; nodeId: string; status: FnStatus; progressText?: string; issueKind?: RunIssueKind; issueMessage?: string }
  | { type: 'aiChunk'; runId: string; chunk: string }
  | { type: 'aiDone'; runId: string; node: CanvasNode; edge: CanvasEdge }
  | { type: 'aiError'; runId: string; nodeId?: string; message: string; issueKind?: RunIssueKind }
  | { type: 'imageUri'; filePath: string; uri: string }
  | { type: 'pdfExploded'; sourceNodeId: string; producerNodeId?: string; groupName: string; nodes: CanvasNode[]; warnings?: string[] }
  | { type: 'modelList'; provider: string; models: ModelInfo[] }
  | { type: 'settingsSnapshot'; settings: SettingsSnapshot }
  | { type: 'conversionDiagnostics'; report: ConversionDiagnosticsReport }
  | { type: 'conversionDiagnosticsError'; message: string }
  | ({ type: 'pipelineStarted' } & PipelineStartPayload)
  | ({ type: 'outputHistory' } & OutputHistoryPayload)
  | { type: 'fileContent'; requestId: string; content: string; language?: string }
  | { type: 'stagingNodeMaterialized'; sourceNodeId: string; node: CanvasNode; position: { x: number; y: number } }
  | { type: 'stagingNodeMaterializeFailed'; sourceNodeId: string; message: string }
  | { type: 'blueprintDraftCreated'; draft: BlueprintDraft }
  | { type: 'blueprintDraftSaved'; entry: BlueprintRegistryEntry }
  | { type: 'blueprintIndex'; entries: BlueprintRegistryEntry[]; sessionId?: number }
  | {
      type: 'blueprintDefinitions';
      definitions: Array<{ filePath: string; definition: BlueprintDefinition }>;
      failedPaths?: string[];
      sessionId?: number;
    }
  | { type: 'blueprintInstantiated'; entry: BlueprintRegistryEntry; definition: BlueprintDefinition; position?: { x: number; y: number } }
  | { type: 'blueprintRunRejected'; containerNodeId: string; message: string; runMode?: 'full' | 'resume'; reusedCachedNodeCount?: number }
  | { type: 'error'; message: string }
  | { type: 'pipelineStarted'; pipelineId: string; triggerNodeId: string; nodeIds: string[]; totalNodes: number }
  | { type: 'pipelineNodeStart'; pipelineId: string; nodeId: string }
  | { type: 'pipelineNodeComplete'; pipelineId: string; nodeId: string; outputNodeId: string }
  | { type: 'pipelineNodeError'; pipelineId: string; nodeId: string; error: string; issueKind?: Exclude<RunIssueKind, 'skipped'> }
  | { type: 'pipelineNodeSkipped'; pipelineId: string; nodeId: string; reason?: string; issueKind?: Extract<RunIssueKind, 'skipped'> }
  | { type: 'pipelineComplete'; pipelineId: string; totalNodes: number; completedNodes: number; status: PipelineCompletionStatus }
  | { type: 'pipelineValidationWarning'; pipelineId: string; nodeId: string; message: string };
// ── Default node sizes ──────────────────────────────────────────────────────
export const DEFAULT_SIZES: Record<NodeType, { width: number; height: number }> = {
  paper:           { width: 280, height: 160 },
  note:            { width: 280, height: 160 },
  code:            { width: 280, height: 140 },
  image:           { width: 240, height: 200 },
  ai_output:       { width: 280, height: 160 },
  audio:           { width: 240, height: 120 },
  video:           { width: 280, height: 180 },
  experiment_log:  { width: 320, height: 300 },
  group_hub:       { width: 220, height: 140 },
  blueprint:       { width: 320, height: 180 },
  task:            { width: 300, height: 240 },
  data:            { width: 320, height: 200 },
  function:        { width: 280, height: 220 },
};
