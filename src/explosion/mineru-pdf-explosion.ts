import * as path from 'path';
import { promises as fs } from 'fs';
import { v4 as uuid } from 'uuid';
import type { CanvasNode } from '../core/canvas-model';
import { DEFAULT_SIZES } from '../core/canvas-model';
import { getExplosionSourceTypeFromPath, MINERU_SUPPORTED_FILE_HINT } from '../core/explosion-file-types';
import { toRelPath } from '../core/storage';
import { extractSpreadsheetSheets, getPdfPageCount } from '../core/content-extractor';
import { normalizeMinerUManifest } from './mineru-normalizer';
import { getMinerUConfig, MinerUError, parseDocumentViaMinerU, readMinerUResultManifest } from './mineru-adapter';
import type { ExplosionResult, ExplosionSourceFileType } from './explosion-types';
import type { ExplosionNodeDraft, ExplosionUnit } from './explosion-types';
import { renderPptxSlidesToImages } from './pptx-slide-renderer';
import * as vscode from 'vscode';

const MINERU_MAX_PDF_BYTES = 200 * 1024 * 1024;
const MINERU_MAX_PDF_PAGES = 200;

type ExplosionProgressReporter = (message: string) => void;

async function resolveExplosionResult(
  filePath: string,
  workspaceRoot: string,
  sourceType: ExplosionSourceFileType,
): Promise<ExplosionResult> {
  if (sourceType === 'xlsx') {
    return resolveSpreadsheetExplosionResult(filePath, workspaceRoot);
  }

  const response = await parseDocumentViaMinerU(filePath, workspaceRoot);

  if (response.manifestPath) {
    const { manifestPath, outputDir, manifest } = await readMinerUResultManifest(response.manifestPath);
    return normalizeMinerUManifest(manifest, {
      manifestPath,
      outputDir,
      sourceType,
    });
  }

  if (response.outputDir) {
    const { manifestPath, outputDir, manifest } = await readMinerUResultManifest(response.outputDir);
    return normalizeMinerUManifest(manifest, {
      manifestPath,
      outputDir,
      sourceType,
    });
  }

  return normalizeMinerUManifest(response.raw, { sourceType });
}

function buildLocalSpreadsheetOutputDir(filePath: string, workspaceRoot: string): string {
  const sourceBase = sanitizePathSegment(path.basename(filePath, path.extname(filePath)));
  const session = `${new Date().toISOString().replace(/[:.]/g, '-')}-${uuid().slice(0, 8)}`;
  return path.resolve(workspaceRoot, getMinerUConfig().outputDir, sourceBase, session);
}

async function resolveSpreadsheetExplosionResult(filePath: string, workspaceRoot: string): Promise<ExplosionResult> {
  const sheets = await extractSpreadsheetSheets(filePath);
  const units: ExplosionUnit[] = sheets.map((sheet, index) => ({
    id: `sheet-${sheet.index}-text`,
    kind: 'text',
    order: index,
    title: sheet.title,
    page: sheet.index,
    text: sheet.text,
    sourceType: 'sheet_text',
  }));
  const nodeDrafts: ExplosionNodeDraft[] = units.map(toNodeDraft);
  return {
    provider: 'mineru',
    sourceType: 'xlsx',
    status: units.length > 0 ? 'success' : 'failed',
    outputDir: buildLocalSpreadsheetOutputDir(filePath, workspaceRoot),
    units,
    nodeDrafts,
    warnings: units.length === 0 ? ['表格文件没有解析出可用文本。'] : [],
    raw: { sheets },
  };
}

function buildExplosionNodeTitle(sourceNode: CanvasNode): string {
  return `${sourceNode.title || '文件'} · 拆解组`;
}

function toNodeDraft(unit: ExplosionUnit): ExplosionNodeDraft {
  if (unit.kind === 'image') {
    return {
      id: unit.id,
      nodeType: 'image',
      title: unit.title,
      order: unit.order,
      page: unit.page,
      filePath: unit.imagePath,
      mimeType: unit.mimeType,
    };
  }
  return {
    id: unit.id,
    nodeType: 'note',
    title: unit.title,
    order: unit.order,
    page: unit.page,
    text: unit.text,
  };
}

function formatUnitIndexLabel(sourceType: ExplosionSourceFileType, index: number | undefined): string {
  if (!index) {
    return sourceType === 'pptx' ? '未分幻灯片' : '未分页';
  }
  if (sourceType === 'pptx') {
    return `第 ${index} 张幻灯片`;
  }
  if (sourceType === 'docx') {
    return `第 ${index} 节`;
  }
  if (sourceType === 'xlsx') {
    return `第 ${index} 个工作表`;
  }
  return `第 ${index} 页`;
}

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
  return sanitized || 'untitled';
}

function buildImageContextPreview(
  sourceType: ExplosionSourceFileType,
  unit: ExplosionResult['units'][number] | undefined,
  draft: { title: string; filePath?: string },
): string {
  const parts = [draft.title];
  if (unit?.page) {
    parts.push(`位置：${formatUnitIndexLabel(sourceType, unit.page)}`);
  }
  if (draft.filePath) {
    parts.push(`资源文件名：${path.basename(draft.filePath)}`);
  }
  const caption = unit?.caption?.trim();
  if (caption) {
    parts.push(`图注：${caption}`);
  }
  return parts.join('\n');
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br/>');
}

function summarizeTextForRelationIndex(text: string | undefined, maxChars = 80): string {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '—';
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trimEnd()}…`;
}

async function ensureTextOutputDir(
  result: ExplosionResult,
  sourcePdfAbsPath: string,
  canvasUri: vscode.Uri,
): Promise<string> {
  const sourceBase = sanitizePathSegment(path.basename(sourcePdfAbsPath, path.extname(sourcePdfAbsPath)));
  const fallbackRoot = path.resolve(path.dirname(canvasUri.fsPath), getMinerUConfig().outputDir, sourceBase);
  const textDir = path.join(result.outputDir ?? fallbackRoot, 'rs-text-nodes');
  await fs.mkdir(textDir, { recursive: true });
  return textDir;
}

async function materializeTextDrafts(
  result: ExplosionResult,
  sourcePdfAbsPath: string,
  canvasUri: vscode.Uri,
): Promise<Map<number, string>> {
  const textDir = await ensureTextOutputDir(result, sourcePdfAbsPath, canvasUri);
  const filePathByIndex = new Map<number, string>();

  for (const [index, draft] of result.nodeDrafts.entries()) {
    if (draft.nodeType !== 'note') { continue; }
    const filename = `${String(index + 1).padStart(4, '0')}-${sanitizePathSegment(draft.title)}.md`;
    const absFilePath = path.join(textDir, filename);
    await fs.writeFile(absFilePath, draft.text ?? '', 'utf8');
    filePathByIndex.set(index, absFilePath);
  }

  return filePathByIndex;
}

async function applyPptxSlidePreviewFallback(
  result: ExplosionResult,
  renderedSlideImages: string[],
): Promise<ExplosionResult> {
  if (result.sourceType !== 'pptx' || renderedSlideImages.length === 0) {
    return result;
  }

  const groupedByPage = new Map<number, ExplosionUnit[]>();
  for (const unit of result.units) {
    const page = unit.page;
    if (!page) {
      continue;
    }
    if (!groupedByPage.has(page)) {
      groupedByPage.set(page, []);
    }
    groupedByPage.get(page)!.push(unit);
  }

  const pageOrder = Array.from(new Set([
    ...Array.from({ length: renderedSlideImages.length }, (_, index) => index + 1),
    ...Array.from(groupedByPage.keys()),
  ])).sort((a, b) => a - b);

  const nextUnits: ExplosionUnit[] = [];
  for (const page of pageOrder) {
    const pageUnits = groupedByPage.get(page) ?? [];
    const renderedSlideImage = renderedSlideImages[page - 1];
    if (renderedSlideImage) {
      nextUnits.push({
        id: `pptx-slide-preview-${page}`,
        kind: 'image',
        order: nextUnits.length,
        title: `第 ${page} 张幻灯片图片 1`,
        page,
        imagePath: renderedSlideImage,
        caption: '整页幻灯片预览',
        sourceType: 'slide_preview',
      });
      for (const unit of pageUnits) {
        if (unit.kind === 'image') {
          continue;
        }
        nextUnits.push({
          ...unit,
          order: nextUnits.length,
        });
      }
      continue;
    }

    for (const unit of pageUnits) {
      nextUnits.push({
        ...unit,
        order: nextUnits.length,
      });
    }
  }

  const unitsWithoutPage = result.units.filter(unit => !unit.page);
  for (const unit of unitsWithoutPage) {
    nextUnits.push({
      ...unit,
      order: nextUnits.length,
    });
  }

  return {
    ...result,
    units: nextUnits,
    nodeDrafts: nextUnits.map(toNodeDraft),
  };
}

function buildPptxPreviewDir(sourcePptxAbsPath: string, canvasUri: vscode.Uri): string {
  const sourceBase = sanitizePathSegment(path.basename(sourcePptxAbsPath, path.extname(sourcePptxAbsPath)));
  const previewRoot = path.resolve(path.dirname(canvasUri.fsPath), getMinerUConfig().outputDir, sourceBase, '_preview-preflight');
  return path.join(previewRoot, 'rs-slide-previews');
}

function buildDocumentRelationNote(
  result: ExplosionResult,
  sourceNode: CanvasNode,
  sourceType: ExplosionSourceFileType,
  materializedTextPaths: Map<number, string>,
): string | null {
  const textEntries = result.nodeDrafts.flatMap((draft, index) => {
    if (draft.nodeType !== 'note') {
      return [];
    }
    const filePath = materializedTextPaths.get(index);
    if (!filePath) {
      return [];
    }
    return [{ draft, unit: result.units[index], filePath }];
  });
  const imageUnits = result.units.filter(unit => unit.kind === 'image' && unit.imagePath);
  if (textEntries.length === 0 && imageUnits.length === 0) {
    return null;
  }

  const lines = [
    '# 文档关系索引',
    '',
    `来源文件：${sourceNode.title || 'PDF'}`,
    `文本节点数量：${textEntries.length}`,
    `图片数量：${imageUnits.length}`,
    '',
    '## 文本文件索引',
    '',
  ];

  if (textEntries.length > 0) {
    lines.push(
      '| 顺序 | 资源文件名 | 节点标题 | 页码 | 内容摘要 |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const [entryIndex, entry] of textEntries.entries()) {
      const filename = path.basename(entry.filePath);
      const pageLabel = formatUnitIndexLabel(sourceType, entry.unit?.page);
      const summary = summarizeTextForRelationIndex(entry.draft.text);
      lines.push(
        `| ${entryIndex + 1} | ${escapeMarkdownTableCell(filename)} | ${escapeMarkdownTableCell(entry.draft.title)} | ${escapeMarkdownTableCell(pageLabel)} | ${escapeMarkdownTableCell(summary)} |`,
      );
    }
  } else {
    lines.push('当前拆解结果中没有文本节点。');
  }

  lines.push('', '## 图片文件索引', '');

  if (imageUnits.length > 0) {
    lines.push(
      '| 顺序 | 资源文件名 | 节点标题 | 页码 | 图注 |',
      '| --- | --- | --- | --- | --- |',
    );
  }

  for (const [imageIndex, unit] of imageUnits.entries()) {
    const filename = path.basename(unit.imagePath ?? '');
    const pageLabel = formatUnitIndexLabel(sourceType, unit.page);
    const caption = (unit.caption ?? '').trim() || '—';
    lines.push(
      `| ${imageIndex + 1} | ${escapeMarkdownTableCell(filename)} | ${escapeMarkdownTableCell(unit.title)} | ${escapeMarkdownTableCell(pageLabel)} | ${escapeMarkdownTableCell(caption)} |`,
    );
  }

  if (imageUnits.length === 0) {
    lines.push('当前拆解结果中没有图片节点。');
  }

  lines.push(
    '',
    '> 说明：当该拆解组被连接到 AI 节点时，模型会同时拿到这份关系索引、文本 Markdown 文件、图片节点标题，以及图片本体。',
  );

  return lines.join('\n');
}

async function materializeDocumentRelationNote(
  result: ExplosionResult,
  sourceNode: CanvasNode,
  sourcePdfAbsPath: string,
  canvasUri: vscode.Uri,
  sourceType: ExplosionSourceFileType,
  materializedTextPaths: Map<number, string>,
): Promise<{ title: string; filePath: string; content: string } | null> {
  const content = buildDocumentRelationNote(result, sourceNode, sourceType, materializedTextPaths);
  if (!content) {
    return null;
  }

  const textDir = await ensureTextOutputDir(result, sourcePdfAbsPath, canvasUri);
  const absFilePath = path.join(textDir, '0000-document-relations.md');
  await fs.writeFile(absFilePath, content, 'utf8');
  return {
    title: '文档关系索引',
    filePath: absFilePath,
    content,
  };
}

async function runPdfExplosionPreflight(absPath: string): Promise<void> {
  const stat = await fs.stat(absPath);
  if (stat.size > MINERU_MAX_PDF_BYTES) {
    const sizeMb = (stat.size / 1024 / 1024).toFixed(1);
    throw new MinerUError(
      'input_limit_exceeded',
      `当前 PDF 大小约 ${sizeMb} MB，已超过 MinerU 在线 API 的 200 MB 限制。`,
    );
  }

  const pageCount = await getPdfPageCount(vscode.Uri.file(absPath));
  if (typeof pageCount === 'number' && pageCount > MINERU_MAX_PDF_PAGES) {
    throw new MinerUError(
      'input_limit_exceeded',
      `当前 PDF 共 ${pageCount} 页，已超过 MinerU 在线 API 的 200 页限制。`,
    );
  }
}

function getExplosionUnitType(sourceType: ExplosionSourceFileType): 'page' | 'slide' | 'sheet' | 'section' {
  if (sourceType === 'pdf') {
    return 'page';
  }
  if (sourceType === 'pptx') {
    return 'slide';
  }
  if (sourceType === 'xlsx') {
    return 'sheet';
  }
  return 'section';
}

export async function explodeDocumentNodeViaMinerU(
  sourceNode: CanvasNode,
  canvasUri: vscode.Uri,
  opts?: { onProgress?: ExplosionProgressReporter },
): Promise<{
  sourceNodeId: string;
  groupName: string;
  nodes: CanvasNode[];
  warnings: string[];
}> {
  if (!sourceNode.file_path) {
    throw new Error('当前文件节点缺少文件路径，无法转换。');
  }

  const absPath = path.isAbsolute(sourceNode.file_path)
    ? sourceNode.file_path
    : path.resolve(path.dirname(canvasUri.fsPath), sourceNode.file_path);
  const sourceType = getExplosionSourceTypeFromPath(absPath);
  if (!sourceType) {
    throw new Error(`当前文件格式暂不支持转换，仅支持 ${MINERU_SUPPORTED_FILE_HINT}。`);
  }

  if (sourceType === 'pdf') {
    await runPdfExplosionPreflight(absPath);
  }
  let renderedSlideImages: string[] = [];
  if (sourceType === 'pptx') {
    opts?.onProgress?.('准备整页预览… 如系统弹出授权，请先处理');
    renderedSlideImages = await renderPptxSlidesToImages(absPath, buildPptxPreviewDir(absPath, canvasUri), {
      onStage: message => opts?.onProgress?.(message),
    });
  }
  opts?.onProgress?.(sourceType === 'xlsx' ? '正在本地拆解表格…' : '正在调用 MinerU 拆解文档…');
  let result = await resolveExplosionResult(absPath, path.dirname(canvasUri.fsPath), sourceType);
  result = await applyPptxSlidePreviewFallback(result, renderedSlideImages);
  if (result.units.length === 0) {
    if (sourceType === 'xlsx') {
      throw new Error('表格文件没有解析出可用文本。');
    }
    throw new Error('MinerU 未返回可用的文本或图片结果。');
  }
  opts?.onProgress?.('正在整理拆解结果…');
  const explodeSessionId = uuid();

  const materializedTextPaths = await materializeTextDrafts(result, absPath, canvasUri);
  const relationNote = await materializeDocumentRelationNote(result, sourceNode, absPath, canvasUri, sourceType, materializedTextPaths);
  const explodeUnitType = getExplosionUnitType(sourceType);

  const nodes: CanvasNode[] = result.nodeDrafts.map((draft, index) => {
    const unit = result.units[index];
    const sharedMeta = {
      explode_session_id: explodeSessionId,
      explode_provider: 'mineru' as const,
      explode_source_file_path: sourceNode.file_path,
      explode_source_node_id: sourceNode.id,
      explode_status: 'ready' as const,
      explode_source_type: sourceType,
      exploded_from_node_id: sourceNode.id,
      explode_unit_type: explodeUnitType,
      explode_unit_index: unit?.page ?? draft.page ?? index + 1,
      explode_order: unit?.order ?? index,
    };
    if (draft.nodeType === 'image') {
      if (!draft.filePath) {
        throw new Error(`MinerU 图片单元缺少文件路径（${draft.id}）`);
      }
      return {
        id: uuid(),
        node_type: 'image',
        title: draft.title,
        position: { x: 0, y: 0 },
        size: { ...DEFAULT_SIZES.image },
        file_path: toRelPath(draft.filePath, canvasUri),
        meta: {
          display_mode: 'file',
          content_preview: buildImageContextPreview(sourceType, result.units[index], draft),
          ...sharedMeta,
          explode_kind: 'image' as const,
        },
      };
    }

    const noteFilePath = materializedTextPaths.get(index);
    if (!noteFilePath) {
      throw new Error(`MinerU 文本单元落盘失败（${draft.id}）`);
    }

    return {
      id: uuid(),
      node_type: 'note',
      title: draft.title,
      position: { x: 0, y: 0 },
      size: { ...DEFAULT_SIZES.note },
      file_path: toRelPath(noteFilePath, canvasUri),
      meta: {
        content_preview: draft.text ?? '',
        card_content_mode: 'preview',
        ...sharedMeta,
        explode_kind: 'text' as const,
      },
    };
  });

  if (relationNote) {
    nodes.unshift({
      id: uuid(),
      node_type: 'note',
      title: relationNote.title,
      position: { x: 0, y: 0 },
      size: { ...DEFAULT_SIZES.note },
      file_path: toRelPath(relationNote.filePath, canvasUri),
      meta: {
        content_preview: relationNote.content,
        card_content_mode: 'preview',
        explode_session_id: explodeSessionId,
        explode_provider: 'mineru',
        explode_source_file_path: sourceNode.file_path,
        explode_source_node_id: sourceNode.id,
        explode_status: 'ready',
        explode_source_type: sourceType,
        exploded_from_node_id: sourceNode.id,
        explode_unit_type: 'section',
        explode_kind: 'text',
        explode_order: -1,
      },
    });
  }

  return {
    sourceNodeId: sourceNode.id,
    groupName: buildExplosionNodeTitle(sourceNode),
    nodes,
    warnings: result.warnings,
  };
}

export async function explodePdfNodeViaMinerU(sourceNode: CanvasNode, canvasUri: vscode.Uri): Promise<{
  sourceNodeId: string;
  groupName: string;
  nodes: CanvasNode[];
  warnings: string[];
}> {
  return explodeDocumentNodeViaMinerU(sourceNode, canvasUri);
}
