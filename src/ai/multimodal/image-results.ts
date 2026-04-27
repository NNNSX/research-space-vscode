import * as vscode from 'vscode';
import { v4 as uuid } from 'uuid';
import type { AIContent } from '../provider';
import type { CanvasEdge, CanvasFile, CanvasNode } from '../../core/canvas-model';
import { ensureAiOutputDir, formatTimestamp, toRelPath, writeCanvas } from '../../core/storage';
import { CanvasEditorProvider } from '../../providers/CanvasEditorProvider';

export type PredictionImageCandidate = { url?: string; dataUrl?: string; mimeType?: string };

export interface PersistGeneratedImagesOptions {
  nodeId: string;
  fnNode: CanvasNode;
  canvasUri: vscode.Uri;
  filePrefix: string;
  titlePrefix: string;
  candidates: PredictionImageCandidate[];
  model: string;
  calcOutputPosition: (
    nodeId: string,
    fnNode: CanvasNode,
    outSize: { width: number; height: number },
    canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
  ) => { x: number; y: number };
  buildOutputMeta: (
    nodeId: string,
    fnNode: CanvasNode,
    canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
    extra?: CanvasNode['meta'],
  ) => CanvasNode['meta'];
  appendOutputToCanvas: (
    canvas: Pick<CanvasFile, 'nodes' | 'edges'>,
    nodeId: string,
    outNode: CanvasNode,
  ) => CanvasEdge[];
}

export function buildMultimodalNodeMeta(
  model: string,
  extra?: CanvasNode['meta'],
): CanvasNode['meta'] {
  return {
    ai_provider: 'AIHubMix',
    ai_model: model || undefined,
    ...(extra ?? {}),
  };
}

function normalizePredictionImageCandidate(item: unknown): PredictionImageCandidate | null {
  if (!item) { return null; }
  if (typeof item === 'string') {
    if (/^data:image\//i.test(item)) {
      return { dataUrl: item };
    }
    return { url: item };
  }
  if (typeof item !== 'object') { return null; }
  const rec = item as Record<string, unknown>;
  const stringValue = ['url', 'image', 'src'].find(key => typeof rec[key] === 'string');
  if (stringValue) {
    const value = String(rec[stringValue]);
    return /^data:image\//i.test(value) ? { dataUrl: value } : { url: value };
  }
  const base64Value = ['b64_json', 'base64', 'data'].find(key => typeof rec[key] === 'string');
  if (base64Value) {
    const value = String(rec[base64Value]);
    if (/^data:image\//i.test(value)) {
      return { dataUrl: value };
    }
    const mimeType = typeof rec['mime_type'] === 'string'
      ? String(rec['mime_type'])
      : typeof rec['mimeType'] === 'string'
        ? String(rec['mimeType'])
        : 'image/png';
    return { dataUrl: `data:${mimeType};base64,${value}`, mimeType };
  }
  return null;
}

export function extractPredictionImageCandidates(payload: unknown): PredictionImageCandidate[] {
  if (!payload || typeof payload !== 'object') { return []; }
  const rec = payload as Record<string, unknown>;
  const buckets = [rec['output'], rec['data'], rec['images'], rec['image']];
  const entries: unknown[] = [];
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      entries.push(...bucket);
    } else if (bucket && typeof bucket === 'object') {
      const nested = bucket as Record<string, unknown>;
      if (Array.isArray(nested['images'])) {
        entries.push(...nested['images']);
      } else {
        entries.push(bucket);
      }
    } else if (typeof bucket === 'string') {
      entries.push(bucket);
    }
  }
  return entries
    .map(normalizePredictionImageCandidate)
    .filter((item): item is PredictionImageCandidate => !!item);
}

export async function materializePredictionImage(candidate: PredictionImageCandidate): Promise<{ bytes: Buffer; mimeType: string }> {
  if (candidate.dataUrl) {
    const match = candidate.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      throw new Error('图像接口返回了无法识别的 data URL 图像');
    }
    return {
      bytes: Buffer.from(match[2], 'base64'),
      mimeType: match[1],
    };
  }
  if (!candidate.url) {
    throw new Error('图像接口未返回可下载的图像地址');
  }
  const response = await fetch(candidate.url);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`下载生成图像失败 ${response.status}: ${errText}`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type') ?? candidate.mimeType ?? 'image/png',
  };
}

export async function persistGeneratedImages(
  options: PersistGeneratedImagesOptions,
): Promise<{ outputNodes: CanvasNode[]; outputEdges: CanvasEdge[]; outputContents: AIContent[] }> {
  const {
    nodeId,
    fnNode,
    canvasUri,
    filePrefix,
    titlePrefix,
    candidates,
    model,
    calcOutputPosition,
    buildOutputMeta,
    appendOutputToCanvas,
  } = options;

  if (candidates.length === 0) {
    throw new Error('模型未返回任何图像结果');
  }

  const activeDoc = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
  const outputNodes: CanvasNode[] = [];
  const outputEdges: CanvasEdge[] = [];
  const outputContents: AIContent[] = [];
  const ts = formatTimestamp();
  const outSize = { width: 240, height: 200 };
  const basePosition = calcOutputPosition(nodeId, fnNode, outSize, activeDoc?.data);
  const GAP_Y = 60;

  for (let index = 0; index < candidates.length; index++) {
    const { bytes, mimeType } = await materializePredictionImage(candidates[index]);
    const aiDir = await ensureAiOutputDir(canvasUri);
    const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
    const filename = `${filePrefix}_${ts}_${index + 1}.${ext}`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, bytes);
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'image',
      title: candidates.length === 1 ? `${titlePrefix} ${ts}` : `${titlePrefix} ${index + 1} ${ts}`,
      position: {
        x: basePosition.x,
        y: basePosition.y + index * (outSize.height + GAP_Y),
      },
      size: outSize,
      file_path: relPath,
      meta: buildOutputMeta(nodeId, fnNode, activeDoc?.data, buildMultimodalNodeMeta(model, { display_mode: 'file' })),
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };
    outputNodes.push(outNode);
    outputEdges.push(outEdge);
    outputContents.push({
      type: 'image',
      title: outNode.title,
      localPath: fileUri.fsPath,
      base64: bytes.toString('base64'),
      mediaType: (mimeType.includes('jpeg') ? 'image/jpeg' : mimeType.includes('webp') ? 'image/webp' : 'image/png') as 'image/png' | 'image/jpeg' | 'image/webp',
    });
  }

  if (activeDoc) {
    const persistedEdges: CanvasEdge[] = [];
    for (const outputNode of outputNodes) {
      persistedEdges.push(...appendOutputToCanvas(activeDoc.data, nodeId, outputNode));
    }
    outputEdges.length = 0;
    outputEdges.push(...persistedEdges.filter(edge => edge.edge_type === 'ai_generated'));
    CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
    await writeCanvas(canvasUri, activeDoc.data);
  }

  return { outputNodes, outputEdges, outputContents };
}
