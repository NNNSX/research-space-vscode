import * as path from 'path';
import { promises as fs } from 'fs';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import type { CanvasNode } from '../core/canvas-model';
import { DEFAULT_SIZES } from '../core/canvas-model';
import { extractSpreadsheetSheets, type SpreadsheetSheetContent } from '../core/content-extractor';
import { toRelPath } from '../core/storage';
import { getMinerUConfig } from './mineru-adapter';

export type SpreadsheetConversionFormat = 'md' | 'tex';

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
  return sanitized || 'untitled';
}

function buildOutputDir(sourceAbsPath: string, canvasUri: vscode.Uri): string {
  const sourceBase = sanitizePathSegment(path.basename(sourceAbsPath, path.extname(sourceAbsPath)));
  const session = `${new Date().toISOString().replace(/[:.]/g, '-')}-${uuid().slice(0, 8)}`;
  return path.resolve(path.dirname(canvasUri.fsPath), getMinerUConfig().outputDir, sourceBase, `spreadsheet-${session}`);
}

function splitSheetRows(sheet: SpreadsheetSheetContent): string[][] {
  return sheet.text
    .split(/\r?\n/)
    .map(line => line.split('\t').map(cell => cell.trim()))
    .filter(row => row.some(Boolean));
}

function normalizeRows(rows: string[][]): string[][] {
  const maxCols = Math.max(1, ...rows.map(row => row.length));
  return rows.map(row => {
    const next = [...row];
    while (next.length < maxCols) {
      next.push('');
    }
    return next;
  });
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br/>');
}

function sheetToMarkdownTable(sheet: SpreadsheetSheetContent): string {
  const rows = normalizeRows(splitSheetRows(sheet));
  if (rows.length === 0) {
    return '（空工作表）';
  }
  const header = rows[0];
  const bodyRows = rows.slice(1);
  return [
    `| ${header.map(escapeMarkdownCell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...bodyRows.map(row => `| ${row.map(escapeMarkdownCell).join(' | ')} |`),
  ].join('\n');
}

function buildMarkdownContent(sourceNode: CanvasNode, sheets: SpreadsheetSheetContent[]): string {
  const lines = [
    `# ${sourceNode.title || '表格转换结果'}`,
    '',
    `来源文件：${sourceNode.file_path ?? '未知'}`,
    `工作表数量：${sheets.length}`,
    '',
  ];

  for (const sheet of sheets) {
    lines.push(`## ${sheet.title}`, '', sheetToMarkdownTable(sheet), '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function escapeLatexCell(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function sheetToLatexTabular(sheet: SpreadsheetSheetContent): string {
  const rows = normalizeRows(splitSheetRows(sheet));
  if (rows.length === 0) {
    return `% ${sheet.title} 为空`;
  }
  const colSpec = Array.from({ length: rows[0].length }, () => 'l').join('');
  return [
    `% ${sheet.title}`,
    `\\begin{tabular}{${colSpec}}`,
    rows.map(row => `${row.map(escapeLatexCell).join(' & ')} \\\\`).join('\n'),
    '\\end{tabular}',
  ].join('\n');
}

function buildTexContent(sourceNode: CanvasNode, sheets: SpreadsheetSheetContent[]): string {
  const lines = [
    `% 来源文件：${sourceNode.file_path ?? '未知'}`,
    `% 说明：以下内容为 LaTeX tabular 片段，可复制到完整 .tex 文档中使用。`,
    '',
  ];
  for (const sheet of sheets) {
    lines.push(sheetToLatexTabular(sheet), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export async function convertSpreadsheetNodeToFile(
  sourceNode: CanvasNode,
  canvasUri: vscode.Uri,
  format: SpreadsheetConversionFormat,
): Promise<{
  sourceNodeId: string;
  groupName: string;
  nodes: CanvasNode[];
  warnings: string[];
}> {
  if (!sourceNode.file_path) {
    throw new Error('当前表格节点缺少文件路径，无法转换。');
  }

  const absPath = path.isAbsolute(sourceNode.file_path)
    ? sourceNode.file_path
    : path.resolve(path.dirname(canvasUri.fsPath), sourceNode.file_path);
  const sheets = await extractSpreadsheetSheets(absPath);
  if (sheets.length === 0) {
    throw new Error('表格文件没有解析出可转换内容。');
  }

  const outputDir = buildOutputDir(absPath, canvasUri);
  await fs.mkdir(outputDir, { recursive: true });
  const sourceBase = sanitizePathSegment(path.basename(absPath, path.extname(absPath)));
  const filename = `${sourceBase}.${format === 'tex' ? 'tex' : 'md'}`;
  const outputPath = path.join(outputDir, filename);
  const content = format === 'tex'
    ? buildTexContent(sourceNode, sheets)
    : buildMarkdownContent(sourceNode, sheets);
  await fs.writeFile(outputPath, content, 'utf8');

  const sessionId = uuid();
  const outputNode: CanvasNode = {
    id: uuid(),
    node_type: format === 'tex' ? 'code' : 'note',
    title: `${sourceNode.title || sourceBase} · ${format === 'tex' ? 'TeX' : 'Markdown'}`,
    position: { x: 0, y: 0 },
    size: format === 'tex' ? { ...DEFAULT_SIZES.code } : { ...DEFAULT_SIZES.note },
    file_path: toRelPath(outputPath, canvasUri),
    meta: {
      content_preview: content,
      card_content_mode: 'preview',
      language: format === 'tex' ? 'latex' : undefined,
      explode_session_id: sessionId,
      explode_provider: 'mineru',
      explode_source_file_path: sourceNode.file_path,
      explode_source_node_id: sourceNode.id,
      explode_status: 'ready',
      explode_source_type: 'xlsx',
      exploded_from_node_id: sourceNode.id,
      explode_unit_type: 'sheet',
      explode_kind: 'table',
      explode_order: 0,
    },
  };

  return {
    sourceNodeId: sourceNode.id,
    groupName: `${sourceNode.title || sourceBase} · ${format === 'tex' ? 'TeX' : 'Markdown'} 转换组`,
    nodes: [outputNode],
    warnings: [],
  };
}
