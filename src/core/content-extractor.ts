import * as vscode from 'vscode';
import * as path from 'path';
import { AIContent } from '../ai/provider';
import { CanvasNode } from './canvas-model';
import { toAbsPath } from './storage';

// ── Content extraction ──────────────────────────────────────────────────────

export async function extractContent(
  node: CanvasNode,
  canvasUri: vscode.Uri,
  injectedContents?: Map<string, AIContent>   // nodeId → pre-built content (blueprint serial chain)
): Promise<AIContent> {
  // Return injected content directly — avoids disk I/O for blueprint serial chaining
  if (injectedContents?.has(node.id)) {
    return injectedContents.get(node.id)!;
  }

  const title = node.title || 'Untitled';

  // Image node in mermaid mode: return as text
  if (node.node_type === 'image' && node.meta?.display_mode === 'mermaid') {
    return { type: 'text', title, text: node.meta.mermaid_code ?? '' };
  }

  if (!node.file_path) {
    return { type: 'text', title, text: node.meta?.content_preview ?? title };
  }

  const absPath = toAbsPath(node.file_path, canvasUri);
  const fileUri = vscode.Uri.file(absPath);

  // Check file exists
  try {
    await vscode.workspace.fs.stat(fileUri);
  } catch {
    return { type: 'text', title, text: node.meta?.content_preview ?? `[File not found: ${node.file_path}]` };
  }

  const bytes = await vscode.workspace.fs.readFile(fileUri);
  const ext = path.extname(absPath).slice(1).toLowerCase();

  // PDF: extract text via pdf-parse
  if (ext === 'pdf') {
    try {
      const text = await extractPdfText(Buffer.from(bytes));
      return { type: 'text', title, text: text.slice(0, 200_000) };
    } catch (e) {
      // Fallback to preview
      return { type: 'text', title, text: node.meta?.content_preview ?? '[PDF parse failed]' };
    }
  }

  // Image: return binary for multimodal
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    const mediaTypeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp',
    };
    // Limit image size to 5 MB to avoid token overflow and API timeouts
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    if (bytes.length > MAX_IMAGE_BYTES) {
      return {
        type: 'text', title,
        text: `[Image too large: ${(bytes.length / 1024 / 1024).toFixed(1)} MB — please resize to under 5 MB]`,
      };
    }
    const base64 = Buffer.from(bytes).toString('base64');
    return {
      type: 'image',
      title,
      localPath: absPath,
      base64,
      mediaType: mediaTypeMap[ext] ?? 'image/png',
    };
  }

  // Audio files: return placeholder (content goes to STT tool directly)
  if (['mp3', 'wav', 'opus', 'aac', 'flac', 'm4a'].includes(ext)) {
    return { type: 'text', title, text: `[Audio file: ${path.basename(absPath)}]` };
  }

  // Video files: return placeholder
  if (['mp4', 'webm', 'mov'].includes(ext)) {
    return { type: 'text', title, text: `[Video file: ${path.basename(absPath)}]` };
  }

  // Text files: read as utf-8
  const text = Buffer.from(bytes).toString('utf-8');
  return { type: 'text', title, text };
}

// ── Preview extraction (up to 5000 chars for rich node preview) ──────────────

export async function extractPreview(
  uri: vscode.Uri,
  nodeType: string
): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const ext = path.extname(uri.fsPath).slice(1).toLowerCase();

    if (ext === 'pdf') {
      const text = await extractPdfText(Buffer.from(bytes));
      return text.slice(0, 300);
    }

    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      return '';  // Images have no text preview
    }

    if (['mp3', 'wav', 'opus', 'aac', 'flac', 'm4a', 'mp4', 'webm', 'mov'].includes(ext)) {
      return '';  // Audio/video have no text preview
    }

    return Buffer.from(bytes).toString('utf-8').slice(0, 300);
  } catch {
    return '';
  }
}

// ── PDF text extraction ─────────────────────────────────────────────────────

export async function extractPdfText(buffer: Buffer): Promise<string> {
  // Dynamic import to avoid startup cost
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  const result = await pdfParse(buffer);
  return result.text;
}

export async function getPdfPageCount(uri: vscode.Uri): Promise<number | undefined> {
  const ext = path.extname(uri.fsPath).slice(1).toLowerCase();
  if (ext !== 'pdf') { return undefined; }
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ numpages: number }>;
    const result = await pdfParse(Buffer.from(bytes));
    return result.numpages;
  } catch {
    return undefined;
  }
}
