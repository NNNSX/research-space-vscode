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
  autoSave: boolean;
  customProviders: CustomProviderConfig[];
  aiHubMixApiKey?: string;          // AIHubMix API Key for multimodal tools (v0.5.0)
  aiHubMixImageGenModel?: string;   // Default model for image generation (v0.6.2)
  aiHubMixImageEditModel?: string;  // Default model for image editing (v0.6.2)
  aiHubMixTtsModel?: string;        // Default model for TTS (v0.6.2)
  aiHubMixSttModel?: string;        // Default model for STT (v0.6.2)
  aiHubMixVideoGenModel?: string;   // Default model for video generation (v0.6.2)
  petAiProvider?: string;            // Pet AI provider override: 'auto' | provider id (v0.10.7)
  petAiModel?: string;               // Pet AI model override (empty = provider default) (v0.10.7)
}

// ── Node types ─────────────────────────────────────────────────────────────
export type DataNodeType = 'paper' | 'note' | 'code' | 'image' | 'ai_output' | 'audio' | 'video' | 'experiment_log' | 'task' | 'data';
export type NodeType = DataNodeType | 'function';
export type FnStatus = 'idle' | 'running' | 'done' | 'error';
export type AiTool = 'summarize' | 'polish' | 'review' | 'translate' | 'draw' | 'rag' | 'chat';
export type EdgeType = 'data_flow' | 'ai_generated' | 'reference';

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
  /** API type for multimodal tools. 'chat' (default) uses the LLM streaming path. */
  apiType?: 'chat' | 'image_generation' | 'image_edit' | 'tts' | 'stt' | 'video_generation';
  /** Named input slots. When defined, connecting a data node triggers a role picker dialog. */
  slots?: SlotDef[];
  /** Tool category for panel grouping. */
  category?: 'text' | 'research' | 'multimodal' | 'project' | 'general';
}

// ── Output history entry ────────────────────────────────────────────────────
export interface OutputHistoryEntry {
  filePath: string;    // relative path (same format as node.file_path)
  filename: string;    // basename for display
  preview: string;     // first ~200 chars of the file
  isCurrent: boolean;  // true if this matches the current node's file_path
}

// ── Canvas file (.rsws) ─────────────────────────────────────────────────────

export interface SummaryGroup {
  id: string;
  name: string;                 // unique among all summaries
  color?: string;               // border/header color (CSS value, defaults to first preset)
  nodeIds: string[];            // IDs of contained nodes
  bounds: { x: number; y: number; width: number; height: number };
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
  summaryGroups?: SummaryGroup[];
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

export function isDataNode(node: CanvasNode): boolean {
  return ['paper', 'note', 'code', 'image', 'ai_output', 'audio', 'video', 'experiment_log', 'task', 'data'].includes(node.node_type);
}

// ── Webview ↔ Extension message protocol ───────────────────────────────────
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'canvasChanged'; data: CanvasFile }
  | { type: 'openFile'; filePath: string }
  | { type: 'runFunction'; nodeId: string }
  | { type: 'runBatchFunction'; nodeId: string }
  | { type: 'cancelAI'; runId: string }
  | { type: 'requestImageUri'; filePath: string }
  | { type: 'requestModels'; provider: string }
  | { type: 'addFiles' }
  | { type: 'dropFiles'; uris: string[] }
  | { type: 'newNote'; title: string }
  | { type: 'newExperimentLog'; title: string }
  | { type: 'newTask'; title: string }
  | { type: 'syncDataNodeFile'; nodeId: string; content: string }
  | { type: 'deleteNote'; filePath: string }
  | { type: 'renameNode'; nodeId: string; newTitle: string }
  | { type: 'updateSettings'; key: string; value: unknown }
  | { type: 'importTool' }
  | { type: 'exportTool'; toolId: string }
  | { type: 'deleteTool'; toolId: string }
  | { type: 'createFunctionNode'; toolId: string; title?: string; paramValues?: Record<string, unknown> }
  | { type: 'requestOutputHistory'; nodeId: string; filePath: string }
  | { type: 'restoreOutputVersion'; filePath: string }
  | { type: 'requestFileContent'; filePath: string; requestId: string }
  | { type: 'previewFile'; filePath: string };

export type ExtensionMessage =
  | { type: 'init'; data: CanvasFile; workspaceRoot: string }
  | { type: 'toolDefs'; tools: JsonToolDef[] }
  | { type: 'toolDefError'; message: string }
  | { type: 'nodeDefs'; defs: DataNodeDef[] }
  | { type: 'nodeAdded'; node: CanvasNode }
  | { type: 'stageNodes'; nodes: CanvasNode[] }
  | { type: 'nodeFileStatus'; nodeId: string; missing: boolean }
  | { type: 'nodeFileMoved'; nodeId: string; newFilePath: string; newTitle: string }
  | { type: 'nodeContentUpdate'; nodeId: string; preview: string }
  | { type: 'fnStatusUpdate'; nodeId: string; status: FnStatus; progressText?: string }
  | { type: 'aiChunk'; runId: string; chunk: string }
  | { type: 'aiDone'; runId: string; node: CanvasNode; edge: CanvasEdge }
  | { type: 'aiError'; runId: string; message: string }
  | { type: 'imageUri'; filePath: string; uri: string }
  | { type: 'modelList'; provider: string; models: ModelInfo[] }
  | { type: 'settingsSnapshot'; settings: SettingsSnapshot }
  | { type: 'outputHistory'; nodeId: string; entries: OutputHistoryEntry[] }
  | { type: 'fileContent'; requestId: string; content: string; language?: string }
  | { type: 'error'; message: string };
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
  task:            { width: 300, height: 240 },
  data:            { width: 320, height: 200 },
  function:        { width: 280, height: 160 },
};
