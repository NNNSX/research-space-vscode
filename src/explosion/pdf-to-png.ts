import * as path from 'path';
import { promises as fs } from 'fs';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import type { CanvasNode } from '../core/canvas-model';
import { DEFAULT_SIZES } from '../core/canvas-model';
import { toRelPath } from '../core/storage';
import { getPdfPageCount } from '../core/content-extractor';
import { getMinerUConfig } from './mineru-adapter';
import { renderPdfPagesToPngImages } from './pptx-slide-renderer';

type ProgressReporter = (message: string) => void;

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
  return sanitized || 'untitled';
}

function buildOutputDir(sourcePdfAbsPath: string, canvasUri: vscode.Uri): string {
  const sourceBase = sanitizePathSegment(path.basename(sourcePdfAbsPath, path.extname(sourcePdfAbsPath)));
  return path.resolve(path.dirname(canvasUri.fsPath), getMinerUConfig().outputDir, sourceBase, 'pdf-pages');
}

async function materializeRelationIndex(
  sourceNode: CanvasNode,
  imagePaths: string[],
  outputDir: string,
): Promise<{ title: string; filePath: string; content: string }> {
  const lines = [
    '# PDF 页面图片关系索引',
    '',
    `来源文件：${sourceNode.title || 'PDF'}`,
    `图片数量：${imagePaths.length}`,
    '',
    '| 顺序 | 资源文件名 | 节点标题 | 页码 |',
    '| --- | --- | --- | --- |',
  ];

  for (const [index, imagePath] of imagePaths.entries()) {
    const page = index + 1;
    lines.push(`| ${page} | ${path.basename(imagePath)} | 第 ${page} 页图片 | 第 ${page} 页 |`);
  }

  lines.push(
    '',
    '> 说明：当该节点组被连接到 AI 节点时，模型会同时拿到这份关系索引、图片节点标题，以及图片本体。',
  );

  const content = lines.join('\n');
  const filePath = path.join(outputDir, '0000-pdf-page-image-relations.md');
  await fs.writeFile(filePath, content, 'utf8');
  return {
    title: 'PDF 页面图片关系索引',
    filePath,
    content,
  };
}

export async function convertPdfNodeToPngGroup(
  sourceNode: CanvasNode,
  canvasUri: vscode.Uri,
  opts?: { onProgress?: ProgressReporter },
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
  if (path.extname(absPath).toLowerCase() !== '.pdf') {
    throw new Error('PDF 转 PNG 工具只支持 PDF 文件节点。');
  }

  const outputDir = buildOutputDir(absPath, canvasUri);
  opts?.onProgress?.('正在读取 PDF 页数…');
  const pageCount = await getPdfPageCount(vscode.Uri.file(absPath));
  opts?.onProgress?.(typeof pageCount === 'number' ? `正在转换 PDF… 共 ${pageCount} 页` : '正在转换 PDF…');
  const imagePaths = await renderPdfPagesToPngImages(absPath, outputDir, {
    filenamePrefix: 'page',
    onStage: message => opts?.onProgress?.(message),
  });
  if (imagePaths.length === 0) {
    throw new Error('PDF 转 PNG 未生成任何图片。');
  }

  const sessionId = uuid();
  const relationIndex = await materializeRelationIndex(sourceNode, imagePaths, outputDir);
  const nodes: CanvasNode[] = [
    {
      id: uuid(),
      node_type: 'note',
      title: relationIndex.title,
      position: { x: 0, y: 0 },
      size: { ...DEFAULT_SIZES.note },
      file_path: toRelPath(relationIndex.filePath, canvasUri),
      meta: {
        content_preview: relationIndex.content,
        card_content_mode: 'preview',
        explode_session_id: sessionId,
        explode_provider: 'mineru',
        explode_source_file_path: sourceNode.file_path,
        explode_source_node_id: sourceNode.id,
        explode_status: 'ready',
        explode_source_type: 'pdf',
        exploded_from_node_id: sourceNode.id,
        explode_unit_type: 'section',
        explode_kind: 'text',
        explode_order: -1,
      },
    },
    ...imagePaths.map((imagePath, index): CanvasNode => {
      const page = index + 1;
      return {
        id: uuid(),
        node_type: 'image',
        title: `第 ${page} 页图片`,
        position: { x: 0, y: 0 },
        size: { ...DEFAULT_SIZES.image },
        file_path: toRelPath(imagePath, canvasUri),
        meta: {
          display_mode: 'file',
          content_preview: [
            `第 ${page} 页图片`,
            `来源文件：${sourceNode.title || path.basename(absPath)}`,
            `资源文件名：${path.basename(imagePath)}`,
          ].join('\n'),
          explode_session_id: sessionId,
          explode_provider: 'mineru',
          explode_source_file_path: sourceNode.file_path,
          explode_source_node_id: sourceNode.id,
          explode_status: 'ready',
          explode_source_type: 'pdf',
          exploded_from_node_id: sourceNode.id,
          explode_unit_type: 'page',
          explode_unit_index: page,
          explode_kind: 'image',
          explode_order: index,
        },
      };
    }),
  ];

  return {
    sourceNodeId: sourceNode.id,
    groupName: `${sourceNode.title || 'PDF'} · 页面图片组`,
    nodes,
    warnings: [],
  };
}
