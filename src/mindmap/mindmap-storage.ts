import * as vscode from 'vscode';
import * as path from 'path';
import { createDefaultMindMap, normalizeMindMapFile, type MindMapFile } from './mindmap-model';
import { toRelPath } from '../core/storage';

export const MINDMAP_DIR_NAME = '.rs-mindmaps';
export const MINDMAP_FILE_SUFFIX = '.rs-mindmap.json';

function safeBaseName(title: string): string {
  return (title.trim() || '思维导图')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function timestamp(): string {
  const now = new Date();
  const yy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}_${hh}${min}${ss}`;
}

export async function ensureMindMapsDir(canvasUri: vscode.Uri): Promise<vscode.Uri> {
  const canvasDir = path.dirname(canvasUri.fsPath);
  const dir = vscode.Uri.file(path.join(canvasDir, MINDMAP_DIR_NAME));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

export async function uniqueMindMapUri(canvasUri: vscode.Uri, title: string): Promise<{ uri: vscode.Uri; displayTitle: string }> {
  const dir = await ensureMindMapsDir(canvasUri);
  const base = `${safeBaseName(title)}_${timestamp()}`;
  let suffix = 0;
  while (true) {
    const name = `${base}${suffix > 0 ? `_${suffix + 1}` : ''}${MINDMAP_FILE_SUFFIX}`;
    const candidate = vscode.Uri.file(path.join(dir.fsPath, name));
    try {
      await vscode.workspace.fs.stat(candidate);
      suffix += 1;
    } catch {
      return {
        uri: candidate,
        displayTitle: title.trim() || '思维导图',
      };
    }
  }
}

export async function readMindMapFile(fileUri: vscode.Uri): Promise<MindMapFile> {
  const bytes = await vscode.workspace.fs.readFile(fileUri);
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8')) as unknown;
  return normalizeMindMapFile(parsed);
}

export async function writeMindMapFile(fileUri: vscode.Uri, file: MindMapFile): Promise<MindMapFile> {
  const normalized = normalizeMindMapFile({
    ...file,
    metadata: {
      ...file.metadata,
      updated_at: new Date().toISOString(),
    },
  });
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(normalized, null, 2), 'utf-8'));
  return normalized;
}

export async function createMindMapFile(
  canvasUri: vscode.Uri,
  title: string,
  source?: unknown,
): Promise<{ file: MindMapFile; uri: vscode.Uri; relPath: string; displayTitle: string }> {
  const { uri, displayTitle } = await uniqueMindMapUri(canvasUri, title);
  const file = normalizeMindMapFile(source ?? createDefaultMindMap(displayTitle));
  const written = await writeMindMapFile(uri, {
    ...file,
    title: displayTitle,
    root: {
      ...file.root,
      text: file.root.text || displayTitle,
    },
  });
  return {
    file: written,
    uri,
    relPath: toRelPath(uri.fsPath, canvasUri),
    displayTitle,
  };
}
