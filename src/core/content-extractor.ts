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

/** Extended preview result with AI readability metadata (v2.0) */
export interface PreviewResult {
  preview: string;
  ai_readable_chars?: number;
  ai_readable_pages?: number;
  has_unreadable_content?: boolean;
  unreadable_hint?: string;
  csv_rows?: number;
  csv_cols?: number;
}

export async function extractPreview(
  uri: vscode.Uri,
  nodeType: string
): Promise<string> {
  const result = await extractPreviewWithMeta(uri, nodeType);
  return result.preview;
}

export async function extractPreviewWithMeta(
  uri: vscode.Uri,
  nodeType: string
): Promise<PreviewResult> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const ext = path.extname(uri.fsPath).slice(1).toLowerCase();

    if (ext === 'pdf') {
      const analysis = await analyzePdf(Buffer.from(bytes));
      return {
        preview: analysis.text.slice(0, 300),
        ai_readable_chars: analysis.charCount,
        ai_readable_pages: analysis.pageCount,
        has_unreadable_content: analysis.hasUnreadableContent,
        unreadable_hint: analysis.unreadableHint,
      };
    }

    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      return { preview: '' };  // Images have no text preview
    }

    if (['mp3', 'wav', 'opus', 'aac', 'flac', 'm4a', 'mp4', 'webm', 'mov'].includes(ext)) {
      return { preview: '' };  // Audio/video have no text preview
    }

    // CSV/TSV: count rows and columns
    if (ext === 'csv' || ext === 'tsv') {
      const text = Buffer.from(bytes).toString('utf-8');
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      const separator = ext === 'tsv' ? '\t' : ',';
      const cols = lines.length > 0 ? lines[0].split(separator).length : 0;
      const rows = Math.max(0, lines.length - 1); // exclude header
      return {
        preview: text.slice(0, 300),
        ai_readable_chars: text.length,
        csv_rows: rows,
        csv_cols: cols,
      };
    }

    // Text/Code files
    const text = Buffer.from(bytes).toString('utf-8');
    return {
      preview: text.slice(0, 300),
      ai_readable_chars: text.length,
    };
  } catch {
    return { preview: '' };
  }
}

// ── PDF chart/figure detection (v2.0) ───────────────────────────────────────

export interface PdfAnalysis {
  text: string;
  pageCount: number;
  charCount: number;
  hasUnreadableContent: boolean;
  unreadableHint?: string;
}

const FIGURE_PATTERNS = [
  /\bFig(?:ure)?\.?\s*\d/gi,
  /\b图\s*\d/g,
  /\bChart\s+\d/gi,
  /\bDiagram\s+\d/gi,
];

const TABLE_PATTERNS = [
  /\bTable\s+\d/gi,
  /\b表\s*\d/g,
];

const FORMULA_PATTERNS = [
  /\bEquation\s+\d/gi,
  /\b公式\s*\d/g,
  /\bFormula\s+\d/gi,
];

function detectUnreadableContent(text: string): { has: boolean; hint?: string } {
  const figureMatches = new Set<string>();
  const tableMatches = new Set<string>();
  const formulaMatches = new Set<string>();

  for (const pattern of FIGURE_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) { for (const m of matches) { figureMatches.add(m.trim()); } }
  }
  for (const pattern of TABLE_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) { for (const m of matches) { tableMatches.add(m.trim()); } }
  }
  for (const pattern of FORMULA_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) { for (const m of matches) { formulaMatches.add(m.trim()); } }
  }

  const parts: string[] = [];
  if (figureMatches.size > 0) { parts.push(`${figureMatches.size} 个图表`); }
  if (tableMatches.size > 0) { parts.push(`${tableMatches.size} 个表格图片`); }
  if (formulaMatches.size > 0) { parts.push(`${formulaMatches.size} 个公式图片`); }

  if (parts.length === 0) { return { has: false }; }
  return { has: true, hint: `检测到 ${parts.join('、')} 引用，图片内容未识别` };
}

// ── PDF text extraction ─────────────────────────────────────────────────────

export async function extractPdfText(buffer: Buffer): Promise<string> {
  // Dynamic import to avoid startup cost
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  const result = await pdfParse(buffer);
  return result.text;
}

/** Extended PDF extraction with chart/figure detection (v2.0) */
export async function analyzePdf(buffer: Buffer): Promise<PdfAnalysis> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  const result = await pdfParse(buffer);
  const detection = detectUnreadableContent(result.text);
  return {
    text: result.text,
    pageCount: result.numpages,
    charCount: result.text.length,
    hasUnreadableContent: detection.has,
    unreadableHint: detection.hint,
  };
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
