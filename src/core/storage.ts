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
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', avif: 'image', ico: 'image',
  // note
  md: 'note', markdown: 'note', mdown: 'note', mkd: 'note', txt: 'note', text: 'note', rst: 'note', adoc: 'note', doc: 'note', dot: 'note', docx: 'note', docm: 'note', dotx: 'note', dotm: 'note', rtf: 'note', ppt: 'note', pps: 'note', pot: 'note', pptx: 'note', pptm: 'note', ppsx: 'note', ppsm: 'note', potx: 'note', potm: 'note', odt: 'note', odp: 'note', fodt: 'note', fodp: 'note', epub: 'note',
  // code
  py: 'code', js: 'code', mjs: 'code', cjs: 'code', ts: 'code', mts: 'code', cts: 'code', tsx: 'code', jsx: 'code',
  rs: 'code', go: 'code', java: 'code', c: 'code', cc: 'code', cpp: 'code', cxx: 'code', cs: 'code',
  h: 'code', hh: 'code', hpp: 'code', hxx: 'code', m: 'code', mm: 'code',
  rb: 'code', swift: 'code', kt: 'code', r: 'code', php: 'code', phtml: 'code', lua: 'code', pl: 'code', pm: 'code',
  scala: 'code', groovy: 'code', gradle: 'code', dart: 'code', jl: 'code', zig: 'code', nim: 'code',
  sh: 'code', bash: 'code', zsh: 'code', fish: 'code', ps1: 'code', psm1: 'code', psd1: 'code', bat: 'code', cmd: 'code',
  yaml: 'code', yml: 'code', json: 'code', jsonl: 'code', ndjson: 'code', toml: 'code', tex: 'code', bib: 'code', bst: 'code', ipynb: 'code',
  xml: 'code', html: 'code', css: 'code', scss: 'code', less: 'code', vue: 'code', svelte: 'code', astro: 'code',
  sql: 'code', graphql: 'code', proto: 'code', ini: 'code', cfg: 'code', env: 'code', log: 'code', conf: 'code',
  // data
  csv: 'data', tsv: 'data', xls: 'data', xlt: 'data', xlsx: 'data', xlsm: 'data', xltx: 'data', xltm: 'data', ods: 'data', fods: 'data',
  // audio
  mp3: 'audio', wav: 'audio', opus: 'audio', aac: 'audio', flac: 'audio', m4a: 'audio', webm: 'audio', ogg: 'audio', oga: 'audio',
  // video
  mp4: 'video', mov: 'video', m4v: 'video',
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
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript', jsx: 'javascriptreact',
  rs: 'rust', go: 'go', java: 'java', c: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', cs: 'csharp',
  h: 'c', hh: 'cpp', hpp: 'cpp', hxx: 'cpp', m: 'objective-c', mm: 'objective-cpp',
  rb: 'ruby', swift: 'swift', kt: 'kotlin', r: 'r', php: 'php', phtml: 'php', lua: 'lua', pl: 'perl', pm: 'perl',
  scala: 'scala', groovy: 'groovy', gradle: 'groovy', dart: 'dart', jl: 'julia', zig: 'zig', nim: 'nim',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell', psm1: 'powershell', psd1: 'powershell', bat: 'bat', cmd: 'bat',
  yaml: 'yaml', yml: 'yaml', json: 'json', jsonl: 'json', ndjson: 'json', toml: 'toml', tex: 'latex', bib: 'bibtex', bst: 'bibtex', ipynb: 'json',
  xml: 'xml', html: 'html', css: 'css', scss: 'scss', less: 'less', vue: 'vue', svelte: 'svelte', astro: 'astro', xls: 'plaintext', xlt: 'plaintext', xlsx: 'plaintext', xlsm: 'plaintext', xltx: 'plaintext', xltm: 'plaintext', ods: 'plaintext', fods: 'plaintext', doc: 'plaintext', dot: 'plaintext', docx: 'plaintext', docm: 'plaintext', dotx: 'plaintext', dotm: 'plaintext', rtf: 'plaintext', ppt: 'plaintext', pps: 'plaintext', pot: 'plaintext', pptx: 'plaintext', pptm: 'plaintext', ppsx: 'plaintext', ppsm: 'plaintext', potx: 'plaintext', potm: 'plaintext', odt: 'plaintext', odp: 'plaintext', fodt: 'plaintext', fodp: 'plaintext', epub: 'plaintext',
  sql: 'sql', graphql: 'graphql', proto: 'protobuf', ini: 'ini', cfg: 'ini', env: 'properties', log: 'log', conf: 'properties',
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
