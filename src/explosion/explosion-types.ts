export type ExplosionSourceFileType = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'image' | 'unknown';
export type ExplosionStatus = 'success' | 'partial' | 'failed';
export type ExplosionUnitKind = 'text' | 'image';
export type MinerUErrorCode =
  | 'input_limit_exceeded'
  | 'config_missing_token'
  | 'unsupported_file'
  | 'mode_unsupported'
  | 'api_auth_failed'
  | 'api_quota_exceeded'
  | 'api_rate_limited'
  | 'api_error'
  | 'upload_failed'
  | 'download_failed'
  | 'task_failed'
  | 'task_timeout'
  | 'output_missing';

export interface ExplosionUnit {
  id: string;
  kind: ExplosionUnitKind;
  order: number;
  title: string;
  page?: number;
  text?: string;
  imagePath?: string;
  mimeType?: string;
  caption?: string;
  sourceType?: string;
}

export interface ExplosionNodeDraft {
  id: string;
  nodeType: 'note' | 'image';
  title: string;
  order: number;
  page?: number;
  text?: string;
  filePath?: string;
  mimeType?: string;
}

export interface ExplosionResult {
  provider: 'mineru';
  sourceType: ExplosionSourceFileType;
  status: ExplosionStatus;
  outputDir?: string;
  manifestPath?: string;
  markdownPath?: string;
  units: ExplosionUnit[];
  nodeDrafts: ExplosionNodeDraft[];
  warnings: string[];
  raw?: unknown;
}

export interface MinerUConfig {
  provider: 'mineru';
  apiMode: 'precise' | 'agent' | 'local';
  apiBaseUrl: string;
  apiToken: string;
  modelVersion: 'pipeline' | 'vlm' | 'MinerU-HTML';
  pollIntervalMs: number;
  pollTimeoutMs: number;
  localMode: 'auto' | 'upload' | 'path';
  localApiUrl: string;
  maxUnits: number;
  attachOriginalFileNode: boolean;
  consumeAsGroup: boolean;
  outputDir: string;
}

export interface MinerUParseResponse {
  requestMode: 'precise-task-url' | 'precise-batch-upload' | 'agent-file-upload' | 'upload' | 'path';
  endpoint: string;
  outputDir?: string;
  manifestPath?: string;
  markdownPath?: string;
  raw: unknown;
}
