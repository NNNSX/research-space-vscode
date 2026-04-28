import * as vscode from 'vscode';
import { CanvasNode } from '../core/canvas-model';
import { readCanvas, toAbsPath, writeCanvas } from '../core/storage';
import { mindMapSummaryToPreview, normalizeMindMapFile, summarizeMindMap } from './mindmap-model';
import type { MindMapFile, MindMapSummary } from './mindmap-model';
import { writeMindMapFile } from './mindmap-storage';

export interface SavedMindMapCanvasResult {
  written: MindMapFile;
  summary: MindMapSummary;
  preview: string;
  title: string;
}

export async function saveMindMapToCanvasNode(
  canvasUri: vscode.Uri,
  nodeId: string,
  filePath: string,
  input: unknown,
): Promise<SavedMindMapCanvasResult> {
  const absPath = toAbsPath(filePath, canvasUri);
  const normalizedInput = normalizeMindMapFile(input);
  const written = await writeMindMapFile(vscode.Uri.file(absPath), normalizedInput);
  const summary = summarizeMindMap(written);
  const preview = mindMapSummaryToPreview(summary);
  const canvas = await readCanvas(canvasUri);
  const updateNode = (node: CanvasNode) => node.id === nodeId
    ? {
        ...node,
        title: summary.rootTitle,
        meta: {
          ...node.meta,
          content_preview: preview,
          mindmap_summary: summary,
          file_missing: false,
          ai_readable_chars: preview.length,
        },
      }
    : node;
  canvas.nodes = canvas.nodes.map(updateNode);
  canvas.stagingNodes = canvas.stagingNodes?.map(updateNode);
  await writeCanvas(canvasUri, canvas);
  return {
    written,
    summary,
    preview,
    title: summary.rootTitle,
  };
}
