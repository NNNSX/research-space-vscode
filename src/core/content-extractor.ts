import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { AIContent } from '../ai/provider';
import { CanvasNode } from './canvas-model';
import { toAbsPath } from './storage';

const execFileAsync = promisify(execFile);
// `yauzl` is bundled into dist by esbuild; keep require-style import to avoid extra type deps.
const yauzl = require('yauzl');

// ── Content extraction ──────────────────────────────────────────────────────

export async function extractContent(
  node: CanvasNode,
  canvasUri: vscode.Uri,
  injectedContents?: Map<string, AIContent>,   // nodeId → pre-built content (blueprint serial chain)
  opts?: { maxTextChars?: number }
): Promise<AIContent> {
  // Return injected content directly — avoids disk I/O for blueprint serial chaining
  if (injectedContents?.has(node.id)) {
    return injectedContents.get(node.id)!;
  }

  const title = node.title || 'Untitled';
  const limitText = (text: string): string => {
    const max = opts?.maxTextChars;
    return max && max > 0 ? text.slice(0, max) : text;
  };

  // Image node in mermaid mode: return as text
  if (node.node_type === 'image' && node.meta?.display_mode === 'mermaid') {
    return { type: 'text', title, text: limitText(node.meta.mermaid_code ?? '') };
  }

  if (!node.file_path) {
    return { type: 'text', title, text: limitText(node.meta?.content_preview ?? title) };
  }

  const absPath = toAbsPath(node.file_path, canvasUri);
  const fileUri = vscode.Uri.file(absPath);

  // Check file exists
  try {
    await vscode.workspace.fs.stat(fileUri);
  } catch {
    return { type: 'text', title, text: limitText(node.meta?.content_preview ?? `[File not found: ${node.file_path}]`) };
  }

  const bytes = await vscode.workspace.fs.readFile(fileUri);
  const ext = path.extname(absPath).slice(1).toLowerCase();

  // PDF: extract text via pdf-parse
  if (ext === 'pdf') {
    try {
      const text = await extractPdfText(Buffer.from(bytes));
      return { type: 'text', title, text: limitText(text) };
    } catch (e) {
      // Fallback to preview
      return { type: 'text', title, text: limitText(node.meta?.content_preview ?? '[PDF parse failed]') };
    }
  }

  // Office Open XML: extract plain text / table text
  if (['doc','dot','docx','docm','dotx','dotm','ppt','pps','pot','pptx','pptm','ppsx','ppsm','potx','potm','xls','xlt','xlsx','xlsm','xltx','xltm','rtf','odt','ods','odp','fodt','fods','fodp','epub'].includes(ext)) {
    try {
      const text = await extractStructuredTextFile(absPath, ext);
      return {
        type: 'text',
        title,
        text: limitText(text || (node.meta?.content_preview ?? `[${ext.toUpperCase()} content unavailable]`)),
      };
    } catch {
      return { type: 'text', title, text: limitText(node.meta?.content_preview ?? `[${ext.toUpperCase()} parse failed]`) };
    }
  }

  // Image: return binary for multimodal
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'].includes(ext)) {
    const mediaTypeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon',
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
  if (['mp3', 'wav', 'opus', 'aac', 'flac', 'm4a', 'ogg', 'oga', 'webm'].includes(ext)) {
    return { type: 'text', title, text: `[Audio file: ${path.basename(absPath)}]` };
  }

  // Video files: return placeholder
  if (['mp4', 'mov', 'm4v'].includes(ext)) {
    return { type: 'text', title, text: `[Video file: ${path.basename(absPath)}]` };
  }

  // Text files: read as utf-8
  const text = Buffer.from(bytes).toString('utf-8');
  return { type: 'text', title, text: limitText(text) };
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

    if (['doc','dot','docx','docm','dotx','dotm','ppt','pps','pot','pptx','pptm','ppsx','ppsm','potx','potm','rtf','odt','odp','fodt','fodp','epub'].includes(ext)) {
      const officeText = await extractStructuredTextFile(uri.fsPath, ext);
      return {
        preview: officeText.slice(0, 300),
        ai_readable_chars: officeText.length,
      };
    }

    if (['xls','xlt','xlsx','xlsm','xltx','xltm','ods','fods'].includes(ext)) {
      const workbook = await extractTabularPreview(uri.fsPath, ext);
      return {
        preview: workbook.preview.slice(0, 300),
        ai_readable_chars: workbook.text.length,
        csv_rows: workbook.rows,
        csv_cols: workbook.cols,
      };
    }

    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'].includes(ext)) {
      return { preview: '' };  // Images have no text preview
    }

    if (['mp3', 'wav', 'opus', 'aac', 'flac', 'm4a', 'ogg', 'oga', 'webm', 'mp4', 'mov', 'm4v'].includes(ext)) {
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
  const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  const result = await pdfParse(buffer);
  return result.text;
}

/** Extended PDF extraction with chart/figure detection (v2.0) */
export async function analyzePdf(buffer: Buffer): Promise<PdfAnalysis> {
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
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ numpages: number }>;
    const result = await pdfParse(Buffer.from(bytes));
    return result.numpages;
  } catch {
    return undefined;
  }
}

function decodeXmlText(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

async function unzipList(zipPath: string): Promise<string[]> {
  return Array.from((await readZipEntries(zipPath)).keys());
}

async function unzipEntry(zipPath: string, entry: string): Promise<string> {
  const entries = await readZipEntries(zipPath);
  const content = entries.get(entry);
  if (!content) {
    throw new Error(`Zip entry not found: ${entry}`);
  }
  return content.toString('utf8');
}

function xmlToPlainText(xml: string, blockBreakPattern: RegExp): string {
  const normalized = decodeXmlText(xml)
    .replace(/<w:tab\s*\/?>(?:<\/w:tab>)?/g, '\t')
    .replace(/<a:tab\s*\/?>(?:<\/a:tab>)?/g, '\t')
    .replace(blockBreakPattern, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized;
}

async function extractDocxText(filePath: string): Promise<string> {
  const entries = await unzipList(filePath);
  const targets = entries
    .filter(entry => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(entry))
    .sort();
  const chunks: string[] = [];
  for (const entry of targets) {
    const xml = await unzipEntry(filePath, entry);
    const text = xmlToPlainText(xml, /<\/w:(p|tr|tbl)>/g);
    if (text) { chunks.push(text); }
  }
  return chunks.join('\n\n').trim();
}

async function extractPptxText(filePath: string): Promise<string> {
  const entries = (await unzipList(filePath))
    .filter(entry => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const slides: string[] = [];
  let slideIndex = 1;
  for (const entry of entries) {
    const xml = await unzipEntry(filePath, entry);
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
      .map(match => decodeXmlText(match[1]))
      .map(s => s.trim())
      .filter(Boolean);
    if (texts.length > 0) {
      slides.push(`Slide ${slideIndex}\n${texts.join(' ')}`);
    }
    slideIndex += 1;
  }
  return slides.join('\n\n').trim();
}

function colRefToIndex(ref: string): number {
  let result = 0;
  for (const ch of ref.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') { continue; }
    result = result * 26 + (ch.charCodeAt(0) - 64);
  }
  return Math.max(0, result - 1);
}

function parseSharedStrings(xml: string): string[] {
  return Array.from(xml.matchAll(/<si[\s\S]*?<\/si>/g)).map(match => {
    const parts = Array.from(match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(m => decodeXmlText(m[1]));
    return parts.join('').trim();
  });
}

function parseWorksheet(xml: string, sharedStrings: string[]): { rows: string[][]; cols: number } {
  const rows: string[][] = [];
  let maxCols = 0;
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowCells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
      const colIndex = refMatch ? colRefToIndex(refMatch[1]) : rowCells.length;
      while (rowCells.length < colIndex) { rowCells.push(''); }
      let value = '';
      if (/\bt="s"/.test(attrs)) {
        const idx = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '-1');
        value = idx >= 0 ? (sharedStrings[idx] ?? '') : '';
      } else if (/\bt="inlineStr"/.test(attrs)) {
        value = Array.from(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(m => decodeXmlText(m[1])).join('');
      } else {
        value = decodeXmlText(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }
      rowCells[colIndex] = value.trim();
    }
    if (rowCells.length > 0) {
      maxCols = Math.max(maxCols, rowCells.length);
      rows.push(rowCells);
    }
  }
  return { rows, cols: maxCols };
}

async function extractXlsxPreview(filePath: string): Promise<{ text: string; preview: string; rows: number; cols: number }> {
  const entries = await unzipList(filePath);
  const sharedStringsEntry = entries.find(entry => entry === 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsEntry ? parseSharedStrings(await unzipEntry(filePath, sharedStringsEntry)) : [];
  const sheetEntries = entries
    .filter(entry => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const lines: string[] = [];
  let maxCols = 0;
  let rowCount = 0;
  for (const entry of sheetEntries) {
    const parsed = parseWorksheet(await unzipEntry(filePath, entry), sharedStrings);
    maxCols = Math.max(maxCols, parsed.cols);
    rowCount += parsed.rows.length > 0 ? Math.max(0, parsed.rows.length - 1) : 0;
    for (const row of parsed.rows.slice(0, 20)) {
      lines.push(row.join('\t'));
    }
  }

  const text = lines.join('\n').trim();
  return {
    text,
    preview: text,
    rows: rowCount,
    cols: maxCols,
  };
}


function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractWithTextutil(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync('textutil', ['-convert', 'txt', '-stdout', filePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return normalizeExtractedText(stdout);
}

function canUseTextutil(): boolean {
  return process.platform === 'darwin';
}

function extractPrintableAsciiStrings(buffer: Buffer, minLen = 4): string[] {
  const out: string[] = [];
  let current = '';
  for (const byte of buffer) {
    if ((byte >= 32 && byte <= 126) || byte === 9) {
      current += String.fromCharCode(byte);
      continue;
    }
    if (current.length >= minLen) {
      out.push(current);
    }
    current = '';
  }
  if (current.length >= minLen) {
    out.push(current);
  }
  return out;
}

function extractPrintableUtf16LeStrings(buffer: Buffer, minLen = 4): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const low = buffer[i];
    const high = buffer[i + 1];
    const code = low | (high << 8);
    const isAsciiUtf16 = high === 0 && ((low >= 32 && low <= 126) || low === 9);
    if (isAsciiUtf16) {
      current += String.fromCharCode(code);
      continue;
    }
    if (current.length >= minLen) {
      out.push(current);
    }
    current = '';
  }
  if (current.length >= minLen) {
    out.push(current);
  }
  return out;
}

async function extractLegacyBinaryText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const lines = Array.from(new Set([
    ...extractPrintableAsciiStrings(buffer),
    ...extractPrintableUtf16LeStrings(buffer),
  ]))
    .map(line => line.trim())
    .filter(line => line.length >= 4)
    .filter(line => /[A-Za-z\u4e00-\u9fff]/.test(line));
  return normalizeExtractedText(lines.join('\n'));
}

function decodeRtfHex(input: string): string {
  return input.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) =>
    Buffer.from([parseInt(hex, 16)]).toString('latin1')
  );
}

function stripRtfToPlainText(rtf: string): string {
  return normalizeExtractedText(
    decodeRtfHex(rtf)
      .replace(/\\u(-?\d+)\??/g, (_, dec) => {
        const code = Number(dec);
        const normalized = code < 0 ? code + 65536 : code;
        return String.fromCharCode(normalized);
      })
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\line/g, '\n')
      .replace(/\\tab/g, '\t')
      .replace(/\{\\\*[\s\S]*?\}/g, ' ')
      .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
      .replace(/\\[^a-zA-Z]/g, ' ')
      .replace(/[{}]/g, ' ')
  );
}

async function extractRtfText(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, 'utf8');
  return stripRtfToPlainText(raw);
}

async function extractDocLikeText(filePath: string, ext: string): Promise<string> {
  if (canUseTextutil()) {
    try {
      return await extractWithTextutil(filePath);
    } catch {
      // fall through to platform-neutral fallback
    }
  }
  if (ext === 'rtf') {
    return extractRtfText(filePath);
  }
  return extractLegacyBinaryText(filePath);
}

function htmlToPlainText(html: string): string {
  return normalizeExtractedText(
    decodeXmlText(html)
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|h\d|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

async function extractOdtText(filePath: string): Promise<string> {
  const xml = await unzipEntry(filePath, 'content.xml');
  return xmlToPlainText(xml, /<\/(text:p|text:h|table:table-row|table:table)>/g);
}

async function extractOdpText(filePath: string): Promise<string> {
  const xml = await unzipEntry(filePath, 'content.xml');
  return xmlToPlainText(xml, /<\/(text:p|text:h|draw:page|table:table-row|table:table)>/g);
}

async function extractFlatOpenDocumentText(filePath: string, kind: 'fodt' | 'fodp'): Promise<string> {
  const xml = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  const raw = Buffer.from(xml).toString('utf8');
  return kind === 'fodt'
    ? xmlToPlainText(raw, /<\/(text:p|text:h|table:table-row|table:table)>/g)
    : xmlToPlainText(raw, /<\/(text:p|text:h|draw:page|table:table-row|table:table)>/g);
}

async function extractOdsPreview(filePath: string): Promise<{ text: string; preview: string; rows: number; cols: number }> {
  const xml = await unzipEntry(filePath, 'content.xml');
  return extractTabularPreviewFromXml(xml);
}

function extractTabularPreviewFromXml(xml: string): { text: string; preview: string; rows: number; cols: number } {
  const rows: string[][] = [];
  let maxCols = 0;
  for (const rowMatch of xml.matchAll(/<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g)) {
    const rowCells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<table:table-cell([^>]*)>([\s\S]*?)<\/table:table-cell>/g)) {
      const attrs = cellMatch[1];
      const repeat = Number(attrs.match(/table:number-columns-repeated="(\d+)"/)?.[1] ?? '1');
      const value = normalizeExtractedText(
        Array.from(cellMatch[2].matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g))
          .map(m => decodeXmlText(m[1]))
          .join(' ')
      );
      for (let i = 0; i < repeat; i += 1) {
        rowCells.push(value);
      }
    }
    if (rowCells.length > 0) {
      maxCols = Math.max(maxCols, rowCells.length);
      rows.push(rowCells);
    }
  }
  const lines = rows.slice(0, 20).map(row => row.join('\t'));
  const text = normalizeExtractedText(lines.join('\n'));
  return {
    text,
    preview: text,
    rows: rows.length > 0 ? Math.max(0, rows.length - 1) : 0,
    cols: maxCols,
  };
}

async function extractFodsPreview(filePath: string): Promise<{ text: string; preview: string; rows: number; cols: number }> {
  const xml = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  return extractTabularPreviewFromXml(Buffer.from(xml).toString('utf8'));
}

async function extractEpubText(filePath: string): Promise<string> {
  const entries = (await unzipList(filePath)).filter(entry => /\.(xhtml|html|htm|ncx)$/i.test(entry));
  const chunks: string[] = [];
  for (const entry of entries.sort()) {
    try {
      const raw = await unzipEntry(filePath, entry);
      const text = htmlToPlainText(raw);
      if (text) {
        chunks.push(text);
      }
    } catch {
      // ignore broken entry
    }
  }
  return normalizeExtractedText(chunks.join('\n\n'));
}

async function extractTabularPreview(filePath: string, ext: string): Promise<{ text: string; preview: string; rows: number; cols: number }> {
  switch (ext) {
    case 'xlsx':
    case 'xlsm':
    case 'xltx':
    case 'xltm':
      return extractXlsxPreview(filePath);
    case 'ods':
      return extractOdsPreview(filePath);
    case 'fods':
      return extractFodsPreview(filePath);
    case 'xls':
    case 'xlt': {
      const text = await extractLegacyBinaryText(filePath);
      return { text, preview: text, rows: 0, cols: 0 };
    }
    default:
      return { text: '', preview: '', rows: 0, cols: 0 };
  }
}

export async function extractStructuredTextFile(filePath: string, ext?: string): Promise<string> {
  const normalizedExt = (ext ?? path.extname(filePath).slice(1)).toLowerCase();
  switch (normalizedExt) {
    case 'docx':
    case 'docm':
    case 'dotx':
    case 'dotm':
      return extractDocxText(filePath);
    case 'pptx':
    case 'pptm':
    case 'ppsx':
    case 'ppsm':
    case 'potx':
    case 'potm':
      return extractPptxText(filePath);
    case 'xlsx':
    case 'xlsm':
    case 'xltx':
    case 'xltm':
      return (await extractXlsxPreview(filePath)).text;
    case 'doc':
    case 'dot':
    case 'rtf':
      return extractDocLikeText(filePath, normalizedExt);
    case 'ppt':
    case 'pps':
    case 'pot':
    case 'xls':
    case 'xlt':
      return extractLegacyBinaryText(filePath);
    case 'odt':
      return extractOdtText(filePath);
    case 'odp':
      return extractOdpText(filePath);
    case 'fodt':
      return extractFlatOpenDocumentText(filePath, 'fodt');
    case 'ods':
      return (await extractOdsPreview(filePath)).text;
    case 'fods':
      return (await extractFodsPreview(filePath)).text;
    case 'fodp':
      return extractFlatOpenDocumentText(filePath, 'fodp');
    case 'epub':
      return extractEpubText(filePath);
    default:
      return '';
  }
}

const zipEntriesCache = new Map<string, Promise<Map<string, Buffer>>>();

async function readZipEntries(zipPath: string): Promise<Map<string, Buffer>> {
  const existing = zipEntriesCache.get(zipPath);
  if (existing) {
    return existing;
  }
  const pending = new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err: Error | null, zipFile: any) => {
      if (err || !zipFile) {
        reject(err ?? new Error(`Failed to open zip: ${zipPath}`));
        return;
      }
      const entries = new Map<string, Buffer>();
      zipFile.readEntry();
      zipFile.on('entry', (entry: any) => {
        if (entry.fileName.endsWith('/')) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamErr: Error | null, stream: any) => {
          if (streamErr || !stream) {
            reject(streamErr ?? new Error(`Failed to read zip entry: ${entry.fileName}`));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          stream.on('error', reject);
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipFile.readEntry();
          });
        });
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.on('error', reject);
    });
  }).catch((error) => {
    zipEntriesCache.delete(zipPath);
    throw error;
  });
  zipEntriesCache.set(zipPath, pending);
  return pending;
}
