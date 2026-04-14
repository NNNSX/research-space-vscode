import * as vscode from 'vscode';
import * as path from 'path';
import { CanvasFile, CanvasNode, NodeType, isCanvasFile, DEFAULT_SIZES } from './canvas-model';
import type { DataNodeRegistry } from './data-node-registry';

// ── Read / write .rsws ──────────────────────────────────────────────────────

export async function readCanvas(uri: vscode.Uri): Promise<CanvasFile> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = Buffer.from(bytes).toString('utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse ${uri.fsPath}: invalid JSON`);
  }
  if (!isCanvasFile(parsed)) {
    throw new Error(`${uri.fsPath} is not a valid .rsws file (missing version/nodes/edges)`);
  }
  return parsed;
}

export async function writeCanvas(uri: vscode.Uri, data: CanvasFile): Promise<void> {
  data.metadata.updated_at = new Date().toISOString();
  const json = JSON.stringify(data, null, 2);
  const bytes = Buffer.from(json, 'utf-8');
  // Direct overwrite — do NOT use a tmp+rename pattern.
  // rename() fires a delete+create event pair which causes VSCode to close and
  // re-open the CustomEditor, making the canvas flicker/disappear.
  // writeFile() on an existing file fires only onDidChange, which suppressNextRevert
  // can intercept safely.
  await vscode.workspace.fs.writeFile(uri, bytes);
}

export function emptyCanvas(title: string): CanvasFile {
  return {
    version: '1.0',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

// ── Path utilities ──────────────────────────────────────────────────────────

/** Absolute path → path relative to the directory containing the .rsws file */
export function toRelPath(absPath: string, canvasUri: vscode.Uri): string {
  const canvasDir = path.dirname(canvasUri.fsPath);
  return path.relative(canvasDir, absPath).split(path.sep).join('/');
}

/** Relative path (stored in .rsws) → absolute path */
export function toAbsPath(relPath: string, canvasUri: vscode.Uri): string {
  const canvasDir = path.dirname(canvasUri.fsPath);
  return path.resolve(canvasDir, relPath.split('/').join(path.sep));
}

// ── File type → node type mapping ──────────────────────────────────────────
// The registry is injected at startup; functions fall back to the built-in
// tables if the registry hasn't been set yet (e.g. during extension activation).

let _dataNodeRegistry: DataNodeRegistry | null = null;

export function setDataNodeRegistry(r: DataNodeRegistry): void {
  _dataNodeRegistry = r;
}

const EXT_TO_NODE_TYPE: Record<string, NodeType> = {
  // paper
  pdf: 'paper',
  // image
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  // note
  md: 'note', txt: 'note',
  // code / data
  py: 'code', js: 'code', ts: 'code', tsx: 'code', jsx: 'code',
  rs: 'code', go: 'code', java: 'code', c: 'code', cpp: 'code',
  cs: 'code', rb: 'code', swift: 'code', kt: 'code', r: 'code',
  sh: 'code', bash: 'code', yaml: 'code', yml: 'code', json: 'code',
  toml: 'code', tex: 'code',
  xml: 'code', html: 'code', css: 'code', scss: 'code', less: 'code',
  sql: 'code', graphql: 'code', proto: 'code', ini: 'code', cfg: 'code',
  env: 'code', log: 'code', conf: 'code',
  // data
  csv: 'data', tsv: 'data',
};

export function fileExtToNodeType(ext: string): NodeType | null {
  if (_dataNodeRegistry) {
    return (_dataNodeRegistry.typeFromExtension(ext) as NodeType | null) ?? null;
  }
  return EXT_TO_NODE_TYPE[ext.toLowerCase()] ?? null;
}

export function nodeTypeFromFilePath(filePath: string): NodeType | null {
  const ext = path.extname(filePath).slice(1);
  return fileExtToNodeType(ext);
}

// ── Language detection for code nodes ──────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  py: 'python', js: 'javascript', ts: 'typescript', tsx: 'typescript',
  jsx: 'javascript', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
  cs: 'csharp', rb: 'ruby', swift: 'swift', kt: 'kotlin', r: 'r',
  sh: 'shell', bash: 'shell', yaml: 'yaml', yml: 'yaml', json: 'json',
  toml: 'toml', tex: 'latex',
};

export function detectLanguage(filePath: string): string {
  if (_dataNodeRegistry) {
    return _dataNodeRegistry.languageForFile(filePath) ?? 'plaintext';
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext';
}

// ── AI output node type → file extension ─────────────────────────────────────

export const AI_OUTPUT_NODE_EXTENSIONS: Record<string, string> = {
  'ai_output': '.md',
  'image':     '.png',
  'audio':     '.mp3',
  'video':     '.mp4',
};

// ── AI output directory ─────────────────────────────────────────────────────

export async function ensureAiOutputDir(canvasUri: vscode.Uri): Promise<vscode.Uri> {
  const canvasDir = path.dirname(canvasUri.fsPath);
  const aiDir = vscode.Uri.file(path.join(canvasDir, 'outputs'));
  try {
    await vscode.workspace.fs.createDirectory(aiDir);
  } catch {
    // Already exists — ignore
  }
  return aiDir;
}

// ── Timestamp ───────────────────────────────────────────────────────────────

export function formatTimestamp(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${mm}${dd}_${hh}${min}${ss}`;
}

// ── New node position (avoid stacking) ────────────────────────────────────

export function calcNewNodePosition(
  nodes: CanvasNode[],
  index = 0
): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 100 + index * 320, y: 100 };
  }
  const maxX = Math.max(...nodes.map(n => n.position.x + n.size.width));
  const minY = Math.min(...nodes.map(n => n.position.y));
  return { x: maxX + 80 + index * 320, y: minY };
}
