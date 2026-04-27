import * as vscode from 'vscode';
import { v4 as uuid } from 'uuid';
import { CanvasFile, CanvasNode, CanvasEdge, RunIssueKind } from '../core/canvas-model';
import { buildFunctionExecutionPlan } from '../core/execution-plan';
import { AIContent } from './provider';
import { writeCanvas, ensureAiOutputDir, toRelPath, formatTimestamp } from '../core/storage';
import { extractContent } from '../core/content-extractor';
import { getProvider } from './provider';
import { ToolRegistry } from './tool-registry';
import { CanvasEditorProvider } from '../providers/CanvasEditorProvider';
import { parsePositiveLimit, resolveEffectiveLimit } from './model-capabilities';
import { explodeDocumentNodeViaMinerU } from '../explosion/mineru-pdf-explosion';
import { getExplosionSourceTypeFromPath, isMinerUSupportedFilePath, MINERU_SUPPORTED_FILE_HINT } from '../core/explosion-file-types';
import { MinerUError, formatMinerUErrorForDisplay } from '../explosion/mineru-adapter';
import { convertDocumentNodeToPngGroup } from '../explosion/document-to-png';
import { convertSpreadsheetNodeToFile, type SpreadsheetConversionFormat } from '../explosion/spreadsheet-conversion';
import {
  isDoubaoSeedreamModel,
  isOpenAIImageModel,
  normalizeDoubaoSize,
} from '../core/aihubmix-image-models';
import { buildMultimodalNodeMeta } from './multimodal/image-results';
import {
  type ImageRunSuccess,
  requestGeminiImageEdit,
  requestGeminiImageGeneration,
  requestDoubaoImageEdit,
  requestDoubaoImageFusion,
  requestDoubaoImageGeneration,
  requestDoubaoImageGroupOutput,
  requestOpenAIImageEdit,
  requestOpenAIImageGeneration,
} from './multimodal/image-execution';
import { buildImageEditPrompt, buildImageGenerationPrompt } from './multimodal/image-prompts';
import { requestSpeechToText, requestTextToSpeech } from './multimodal/audio-execution';
import { requestVideoGeneration } from './multimodal/video-execution';
import {
  analyzeInlineCitationCoverage,
  buildAiOutputProvenance,
  buildCitationWarning,
  labelAiContentsForInlineCitations,
  withInlineCitationInstruction,
} from './output-provenance';

// ── Shared registry singleton ──────────────────────────────────────────────
let _registry: ToolRegistry | null = null;

export function setToolRegistry(registry: ToolRegistry): void {
  _registry = registry;
}

function getRegistry(): ToolRegistry {
  if (!_registry) {
    _registry = new ToolRegistry();
  }
  return _registry;
}

// ── Active run registry (for cancel support) ───────────────────────────────
const activeRuns = new Map<string, AbortController>();
const nodeToRunId = new Map<string, string>();
const cancelledRuns = new Set<string>();

export function isFunctionNodeRunning(nodeId: string): boolean {
  return nodeToRunId.has(nodeId);
}

export function reserveFunctionNodeRun(
  nodeId: string,
  runId: string,
  webview: vscode.Webview,
): FunctionRunResult | null {
  if (!isFunctionNodeRunning(nodeId)) {
    nodeToRunId.set(nodeId, runId);
    return null;
  }

  const existingRunId = nodeToRunId.get(nodeId) ?? runId;
  const msg = '该功能节点已有任务正在运行，请等待完成或先停止后再运行。';
  webview.postMessage({
    type: 'aiError',
    runId: existingRunId,
    nodeId,
    message: msg,
    issueKind: 'run_failed',
  });
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '已有任务正在运行…' });
  return { success: false, runId: existingRunId, errorMessage: msg };
}

export function cancelRun(runId: string): void {
  cancelledRuns.add(runId);
  activeRuns.get(runId)?.abort();
  activeRuns.delete(runId);
}

export function cancelRunByNodeId(nodeId: string): void {
  const runId = nodeToRunId.get(nodeId);
  if (runId) { cancelRun(runId); nodeToRunId.delete(nodeId); }
}

function registerActiveRun(runId: string, controller: AbortController): void {
  activeRuns.set(runId, controller);
  if (cancelledRuns.has(runId)) {
    controller.abort();
  }
}

function isRunCancelled(runId: string): boolean {
  return cancelledRuns.has(runId);
}

function cleanupRunTracking(runId: string, nodeId: string): void {
  activeRuns.delete(runId);
  cancelledRuns.delete(runId);
  if (nodeToRunId.get(nodeId) === runId) {
    nodeToRunId.delete(nodeId);
  }
}

function completeImageRun(
  webview: vscode.Webview,
  nodeId: string,
  runId: string,
  result: ImageRunSuccess,
): FunctionRunResult {
  activeRuns.delete(runId);
  for (let index = 0; index < result.outputNodes.length; index++) {
    webview.postMessage({ type: 'aiDone', runId, node: result.outputNodes[index], edge: result.outputEdges[index] });
  }
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
  setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);
  return {
    success: true,
    runId,
    outputContent: result.outputContents[0],
    outputNode: result.outputNodes[0],
  };
}

// ── Options type ────────────────────────────────────────────────────────────

export interface RunFunctionOpts {
  /** Pre-built content to inject instead of extracting from disk (pipeline chaining) */
  injectedContents?: Map<string, AIContent>;
}

export interface FunctionRunResult {
  success: boolean;
  runId: string;
  outputNode?: CanvasNode;
  outputContent?: AIContent;
  errorMessage?: string;
}

function inferRunIssueKind(message: string, fallback: RunIssueKind = 'run_failed'): RunIssueKind {
  const lower = message.toLowerCase();
  if (
    lower.includes('未配置') ||
    lower.includes('配置缺失') ||
    lower.includes('unknown tool') ||
    lower.includes('api key') ||
    lower.includes('apikey')
  ) {
    return 'missing_config';
  }
  if (
    lower.includes('未连接') ||
    lower.includes('输入缺失') ||
    lower.includes('找不到目标节点') ||
    lower.includes('找不到功能节点')
  ) {
    return 'missing_input';
  }
  return fallback;
}

function reportNodeIssue(
  webview: vscode.Webview,
  nodeId: string,
  runId: string,
  message: string,
  issueKind?: RunIssueKind,
): void {
  const kind = issueKind ?? inferRunIssueKind(message);
  webview.postMessage({ type: 'aiError', runId, nodeId, message, issueKind: kind });
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'error', issueKind: kind, issueMessage: message });
}

async function runExplosionTool(
  nodeId: string,
  runId: string,
  upstreamNodes: CanvasNode[],
  nodeParams: Record<string, unknown>,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
): Promise<FunctionRunResult> {
  if (upstreamNodes.length === 0) {
    const msg = `文件转换需要连接 1 个受支持的文件节点（${MINERU_SUPPORTED_FILE_HINT}）。`;
    reportNodeIssue(webview, nodeId, runId, msg, 'missing_input');
    return { success: false, runId, errorMessage: msg };
  }

  if (upstreamNodes.length > 1) {
    const msg = `当前文件转换工具一次只支持 1 个受支持的文件节点（${MINERU_SUPPORTED_FILE_HINT}）。`;
    reportNodeIssue(webview, nodeId, runId, msg, 'missing_input');
    return { success: false, runId, errorMessage: msg };
  }

  const sourceNode = upstreamNodes[0];
  if (!isMinerUSupportedFilePath(sourceNode.file_path)) {
    const msg = `当前文件转换工具仅支持 ${MINERU_SUPPORTED_FILE_HINT} 文件节点。`;
    reportNodeIssue(webview, nodeId, runId, msg, 'missing_input');
    return { success: false, runId, errorMessage: msg };
  }

  const sourceType = getExplosionSourceTypeFromPath(sourceNode.file_path);
  const documentMode = String(nodeParams['document_conversion_mode'] ?? 'text_images');
  const spreadsheetFormat = String(nodeParams['spreadsheet_format'] ?? 'md') === 'tex' ? 'tex' : 'md';
  const shouldConvertSpreadsheet = sourceType === 'xlsx';
  const shouldConvertToPng = !shouldConvertSpreadsheet && documentMode === 'png';

  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '文件转换中…' });

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Research Space：正在转换 ${sourceNode.title || '文件'}`,
      cancellable: false,
    }, async progress => {
      const onProgress = (message: string) => {
        progress.report({ message });
        webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: message });
      };

      if (shouldConvertSpreadsheet) {
        onProgress(spreadsheetFormat === 'tex' ? '正在将表格转换为 TeX…' : '正在将表格转换为 Markdown…');
        return convertSpreadsheetNodeToFile(sourceNode, canvasUri, spreadsheetFormat as SpreadsheetConversionFormat);
      }

      if (shouldConvertToPng) {
        onProgress('正在转换为 PNG…');
        return convertDocumentNodeToPngGroup(sourceNode, canvasUri, { onProgress });
      }

      return explodeDocumentNodeViaMinerU(sourceNode, canvasUri, { onProgress });
    });

    webview.postMessage({
      type: 'pdfExploded',
      sourceNodeId: result.sourceNodeId,
      producerNodeId: nodeId,
      groupName: result.groupName,
      nodes: result.nodes,
      warnings: result.warnings,
    });

    if (result.warnings.length > 0) {
      vscode.window.showWarningMessage(`文件转换已完成，但有 ${result.warnings.length} 条提示：${result.warnings[0]}`);
    }

    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done', progressText: `已转换为 ${result.nodes.length} 个节点` });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);
    return { success: true, runId };
  } catch (e) {
    const message = formatMinerUErrorForDisplay(e);
    const fullMessage = `文件转换失败: ${message}`;
    reportNodeIssue(
      webview,
      nodeId,
      runId,
      fullMessage,
      e instanceof MinerUError && (e.code === 'config_missing_token' || e.code === 'api_auth_failed')
        ? 'missing_config'
        : 'run_failed',
    );
    if (e instanceof MinerUError && (e.code === 'config_missing_token' || e.code === 'api_auth_failed')) {
      const action = await vscode.window.showErrorMessage(message, '打开 MinerU 设置');
      if (action === '打开 MinerU 设置') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'researchSpace.explosion.mineru');
      }
    }
    return { success: false, runId, errorMessage: fullMessage };
  }
}

const AIHUBMIX_EXTRACTION_CHARS_PER_TOKEN = 4;
const MIN_DYNAMIC_EXTRACTION_CHARS = 200_000;

function deriveDynamicExtractionCharLimit(contextLength?: number): number | undefined {
  if (!contextLength || contextLength <= 0) {
    return undefined;
  }
  return Math.max(MIN_DYNAMIC_EXTRACTION_CHARS, contextLength * AIHUBMIX_EXTRACTION_CHARS_PER_TOKEN);
}

function estimateTextTokens(text: string): number {
  let asciiChars = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 0x7f) {
      asciiChars++;
    }
  }
  const nonAsciiChars = text.length - asciiChars;
  return Math.max(1, Math.ceil(asciiChars / 4) + nonAsciiChars);
}

function trimTextToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || !text) {
    return '';
  }
  if (estimateTextTokens(text) <= maxTokens) {
    return text;
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const slice = text.slice(0, mid);
    if (estimateTextTokens(slice) <= maxTokens) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low).trimEnd();
}

interface TextBudgetResult {
  contents: AIContent[];
  trimmedTextBlocks: number;
  omittedTextBlocks: number;
}

interface MultimodalBudgetOptions {
  maxTokens?: number;
  maxImages: number;
  minImagesToKeep?: number;
  maxImageBytes: number;
  maxImageTokenShare?: number;
}

interface MultimodalBudgetResult {
  contents: AIContent[];
  keptImages: number;
  droppedImages: number;
  droppedImageTitles: string[];
  trimmedTextBlocks: number;
  omittedTextBlocks: number;
}

function applyInputTokenBudgetDetailed(contents: AIContent[], maxTokens?: number): TextBudgetResult {
  if (!maxTokens || maxTokens <= 0) {
    return { contents, trimmedTextBlocks: 0, omittedTextBlocks: 0 };
  }

  const pinnedTitles = new Set(['User Message', 'User Question', 'Input Budget Notice']);
  const pinnedIndexes = new Set<number>();
  let pinnedTokens = 0;

  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];
    if (content.type === 'text' && pinnedTitles.has(content.title)) {
      pinnedIndexes.add(i);
      pinnedTokens += estimateTextTokens(content.text ?? '');
    }
  }

  let remainingTokens = Math.max(maxTokens - pinnedTokens, 0);
  const nextContents: AIContent[] = [];
  let trimmedTextBlocks = 0;
  let omittedTextBlocks = 0;

  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];

    if (content.type !== 'text' || pinnedIndexes.has(i)) {
      nextContents.push(content);
      continue;
    }

    const text = content.text ?? '';
    if (!text) {
      nextContents.push(content);
      continue;
    }

    const estimatedTokens = estimateTextTokens(text);
    if (estimatedTokens <= remainingTokens) {
      nextContents.push(content);
      remainingTokens -= estimatedTokens;
      continue;
    }

    if (remainingTokens <= 0) {
      omittedTextBlocks += 1;
      continue;
    }

    const trimmedText = trimTextToTokenBudget(text, remainingTokens);
    if (trimmedText) {
      if (trimmedText !== text) {
        trimmedTextBlocks += 1;
      }
      nextContents.push({ ...content, text: trimmedText });
      remainingTokens -= estimateTextTokens(trimmedText);
    } else {
      omittedTextBlocks += 1;
    }
  }

  return { contents: nextContents, trimmedTextBlocks, omittedTextBlocks };
}

function applyInputTokenBudget(contents: AIContent[], maxTokens?: number): AIContent[] {
  return applyInputTokenBudgetDetailed(contents, maxTokens).contents;
}

function estimateImageBytes(content: AIContent): number {
  if (content.type !== 'image') {
    return 0;
  }
  const base64 = content.base64 ?? '';
  if (!base64) {
    return 0;
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function estimateImageInputTokens(content: AIContent): number {
  const bytes = estimateImageBytes(content);
  if (bytes <= 0) {
    return 1024;
  }
  return Math.max(1024, Math.ceil(bytes / 512));
}

function applyMultimodalInputBudget(contents: AIContent[], opts: MultimodalBudgetOptions): MultimodalBudgetResult {
  const imageIndexes = contents
    .map((content, index) => ({ content, index }))
    .filter((entry): entry is { content: AIContent & { type: 'image' }; index: number } => entry.content.type === 'image');

  if (imageIndexes.length === 0) {
    const textBudget = applyInputTokenBudgetDetailed(contents, opts.maxTokens);
    return {
      contents: textBudget.contents,
      keptImages: 0,
      droppedImages: 0,
      droppedImageTitles: [],
      trimmedTextBlocks: textBudget.trimmedTextBlocks,
      omittedTextBlocks: textBudget.omittedTextBlocks,
    };
  }

  const maxImages = Math.max(1, opts.maxImages);
  const minImagesToKeep = Math.max(0, Math.min(opts.minImagesToKeep ?? 0, maxImages));
  const maxImageBytes = Math.max(1, opts.maxImageBytes);
  const maxTokens = opts.maxTokens && opts.maxTokens > 0 ? opts.maxTokens : undefined;
  const imageTokenBudget = maxTokens
    ? Math.max(1024, Math.floor(maxTokens * Math.min(Math.max(opts.maxImageTokenShare ?? 0.7, 0.25), 1)))
    : undefined;

  const keepImageIndexes = new Set<number>();
  const droppedImageTitles: string[] = [];
  let keptImages = 0;
  let usedImageBytes = 0;
  let usedImageTokens = 0;

  for (const entry of imageIndexes) {
    const imageBytes = estimateImageBytes(entry.content);
    const imageTokens = estimateImageInputTokens(entry.content);
    const withinCount = keptImages < maxImages;
    const withinBytes = usedImageBytes + imageBytes <= maxImageBytes;
    const forceKeep = keptImages < minImagesToKeep;
    const withinTokenBudget = !imageTokenBudget || forceKeep || usedImageTokens + imageTokens <= imageTokenBudget;

    if (withinCount && withinBytes && withinTokenBudget) {
      keepImageIndexes.add(entry.index);
      keptImages += 1;
      usedImageBytes += imageBytes;
      usedImageTokens += imageTokens;
      continue;
    }

    droppedImageTitles.push(entry.content.title || 'Untitled');
  }

  const prunedContents = contents.filter((content, index) => content.type !== 'image' || keepImageIndexes.has(index));
  const remainingTextBudget = maxTokens ? Math.max(maxTokens - usedImageTokens, 0) : undefined;
  const textBudget = applyInputTokenBudgetDetailed(prunedContents, remainingTextBudget);

  return {
    contents: textBudget.contents,
    keptImages,
    droppedImages: droppedImageTitles.length,
    droppedImageTitles,
    trimmedTextBlocks: textBudget.trimmedTextBlocks,
    omittedTextBlocks: textBudget.omittedTextBlocks,
  };
}

function resolveMultimodalBudgetOptions(aiType: string, toolId: string, maxTokens?: number): MultimodalBudgetOptions {
  if (aiType === 'video_generation') {
    return {
      maxTokens,
      maxImages: 1,
      minImagesToKeep: 1,
      maxImageBytes: 6 * 1024 * 1024,
      maxImageTokenShare: 0.75,
    };
  }

  if (aiType === 'image_edit') {
    const isFusion = toolId === 'image-fusion';
    return {
      maxTokens,
      maxImages: isFusion ? 4 : 1,
      minImagesToKeep: isFusion ? 2 : 1,
      maxImageBytes: isFusion ? 16 * 1024 * 1024 : 6 * 1024 * 1024,
      maxImageTokenShare: isFusion ? 0.8 : 0.75,
    };
  }

  return {
    maxTokens,
    maxImages: 4,
    minImagesToKeep: 0,
    maxImageBytes: 12 * 1024 * 1024,
    maxImageTokenShare: 0.7,
  };
}

// ── Main executor ──────────────────────────────────────────────────────────

export async function runFunctionNode(
  nodeId: string,
  canvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  opts?: RunFunctionOpts
): Promise<FunctionRunResult> {
  const runId = uuid();
  const reservedError = reserveFunctionNodeRun(nodeId, runId, webview);
  if (reservedError) {
    return reservedError;
  }

  const fnNode = canvas.nodes.find(n => n.id === nodeId);
  if (!fnNode || !fnNode.meta?.ai_tool) {
    cleanupRunTracking(runId, nodeId);
    webview.postMessage({
      type: 'aiError',
      runId,
      nodeId,
      message: '找不到功能节点或 ai_tool 配置',
      issueKind: 'missing_config',
    });
    return { success: false, runId, errorMessage: '找不到功能节点或 ai_tool 配置' };
  }

  const registry = getRegistry();
  const toolId = fnNode.meta.ai_tool as string;
  const toolDef = registry.get(toolId);
  if (!toolDef) {
    cleanupRunTracking(runId, nodeId);
    webview.postMessage({
      type: 'aiError',
      runId,
      nodeId,
      message: `Unknown tool: ${toolId}`,
      issueKind: 'missing_config',
    });
    return { success: false, runId, errorMessage: `Unknown tool: ${toolId}` };
  }

  // Outer safety net: ensure status is always reset even on unexpected throws
  try {
    return await _runFunctionNodeInner(nodeId, fnNode, toolId, toolDef, registry, runId, canvas, canvasUri, webview, opts);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  } finally {
    cleanupRunTracking(runId, nodeId);
  }
}

// ── Batch run ─────────────────────────────────────────────────────────────────
// Runs the function node once per upstream data node. Each upstream node gets
// its own isolated run, producing a separate output node.

export async function runBatchFunctionNode(
  nodeId: string,
  canvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview
): Promise<void> {
  const fnNode = canvas.nodes.find(n => n.id === nodeId);
  if (!fnNode || !fnNode.meta?.ai_tool) {
    webview.postMessage({ type: 'aiError', runId: uuid(), nodeId, message: '找不到功能节点或 ai_tool 配置', issueKind: 'missing_config' });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'error', issueKind: 'missing_config', issueMessage: '找不到功能节点或 ai_tool 配置' });
    return;
  }

  const executionPlan = buildFunctionExecutionPlan(nodeId, canvas, ['data_flow']);
  if ('error' in executionPlan) {
    webview.postMessage({ type: 'aiError', runId: uuid(), nodeId, message: executionPlan.error, issueKind: 'missing_input' });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'error', issueKind: 'missing_input', issueMessage: executionPlan.error });
    return;
  }

  const expandedInputs = executionPlan.expandedInputs;
  if (expandedInputs.length === 0) {
    webview.postMessage({ type: 'aiError', runId: uuid(), nodeId, message: '批量运行：未连接任何输入数据节点。', issueKind: 'missing_input' });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'error', issueKind: 'missing_input', issueMessage: '批量运行：未连接任何输入数据节点。' });
    return;
  }

  const total = expandedInputs.length;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: `批量运行 0/${total}…` });

  let completed = 0;
  let failed = 0;

  // Run sequentially to avoid API rate-limit issues
  for (const input of expandedInputs) {
    // Build a shallow-cloned canvas that has only this one upstream edge
    const singleCanvas: CanvasFile = {
      ...canvas,
      edges: [
        ...canvas.edges.filter(e => !(e.target === nodeId && e.edge_type === 'data_flow')),
        {
          id: uuid(),
          source: input.node.id,
          target: nodeId,
          edge_type: 'data_flow',
          role: input.role,
        },
      ],
    };

    const result = await runFunctionNode(nodeId, singleCanvas, canvasUri, webview);

    // After each run the canvas on disk was updated — refresh our local copy
    // so subsequent runs see the newly added output nodes (for collision avoidance).
    if (result.success && result.outputNode) {
      appendPersistedOutputToCanvas(canvas, nodeId, result.outputNode);
      completed++;
    } else {
      failed++;
    }

    // Update batch progress after each item (overrides the fnStatusUpdate from the single run)
    webview.postMessage({
      type: 'fnStatusUpdate',
      nodeId,
      status: 'running',
      progressText: `批量运行 ${completed + failed}/${total}… (成功 ${completed}，失败 ${failed})`,
    });
  }

  // Final status
  if (failed === 0) {
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
  } else {
    webview.postMessage({
      type: 'fnStatusUpdate',
      nodeId,
      status: failed === total ? 'error' : 'done',
      progressText: `批量完成：成功 ${completed}，失败 ${failed}`,
    });
  }

  setTimeout(() => {
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
  }, 4000);
}

async function _runFunctionNodeInner(
  nodeId: string,
  fnNode: CanvasNode,
  toolId: string,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  registry: ToolRegistry,
  runId: string,
  canvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  opts?: RunFunctionOpts
): Promise<FunctionRunResult> {
  if (isRunCancelled(runId)) {
    return { success: false, runId, errorMessage: 'Cancelled' };
  }
  const aiType = toolDef.apiType ?? 'chat';
  const nodeParams = fnNode.meta?.param_values ?? {};

  // F2: Run Guard — check run condition before doing anything else
  const runGuard = fnNode.meta?.run_guard ?? 'always';
  if (runGuard === 'manual-confirm') {
    // Manual-confirm is handled client-side (FunctionNode shows a confirm dialog before
    // even sending runFunction). If we reach here, the user already confirmed.
    // No additional check needed — fall through.
  }

  // 1. Running status
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '采集输入中…' });

  // 2. Build a shared execution/input plan. Single-node run, batch run, and
  // pipeline chaining all resolve upstream inputs through the same expansion
  // rules (edge filtering, hub expansion, and input_order sorting).
  const executionPlan = buildFunctionExecutionPlan(nodeId, canvas, ['data_flow', 'pipeline_flow']);
  if ('error' in executionPlan) {
    reportNodeIssue(webview, nodeId, runId, executionPlan.error, 'missing_input');
    return { success: false, runId, errorMessage: executionPlan.error };
  }
  if (isRunCancelled(runId)) {
    return { success: false, runId, errorMessage: 'Cancelled' };
  }
  const upstreamNodes = executionPlan.upstreamNodes;
  const nodeRoleMap = executionPlan.nodeRoleMap;
  const provenance = buildAiOutputProvenance({
    sourceNodes: upstreamNodes,
    toolName: toolDef.name,
  });

  if (aiType === 'explosion') {
    return runExplosionTool(nodeId, runId, upstreamNodes, nodeParams, canvasUri, webview);
  }

  if (upstreamNodes.length === 0 && toolId !== 'rag' && toolId !== 'chat' && aiType === 'chat') {
    reportNodeIssue(webview, nodeId, runId, '未连接任何输入数据节点（数据流边）。', 'missing_input');
    return { success: false, runId, errorMessage: '未连接任何输入节点。' };
  }

  // 3. Resolve provider/model early so all providers can share unified output + context budgeting.
  const nodeProvider = nodeParams['_provider'] as string | undefined;
  let provider;
  try {
    provider = await getProvider(nodeProvider);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const nodeModel = nodeParams['_model'] as string | undefined;
  const effectiveModel = await provider.resolveModel(nodeModel);

  // 3b. Resolve system prompt early so dynamic context budgeting can reserve room for it.
  const defaultParams = toolDef.params.reduce<Record<string, unknown>>(
    (acc, p) => { acc[p.name] = p.default; return acc; },
    {}
  );
  const params = { ...defaultParams, ...nodeParams };
  const customPrompt = nodeParams['_systemPrompt'] as string | undefined;
  const baseSystemPrompt = (customPrompt && customPrompt.trim())
    ? customPrompt.trim()
    : registry.buildSystem(toolId, params);
  const systemPrompt = aiType === 'chat'
    ? withInlineCitationInstruction(baseSystemPrompt, provenance)
    : baseSystemPrompt;

  const aiCfg = vscode.workspace.getConfiguration('researchSpace.ai');
  const configuredMaxOutputTokens = parsePositiveLimit(aiCfg.get<number>('maxOutputTokens', 0));
  const configuredMaxContextTokens = parsePositiveLimit(aiCfg.get<number>('maxContextTokens', 0));

  const providerCaps = effectiveModel && provider.getModelCapabilities
    ? await provider.getModelCapabilities(effectiveModel)
    : null;
  const modelMaxOutputTokens = providerCaps?.maxOutputTokens;
  const modelContextTokens = providerCaps?.contextWindowTokens;
  const effectiveMaxOutputTokens = resolveEffectiveLimit(modelMaxOutputTokens, configuredMaxOutputTokens);
  const effectiveContextTokens = resolveEffectiveLimit(modelContextTokens, configuredMaxContextTokens);
  const extractionOpts: { maxTextChars?: number } = {};

  const dynamicExtractionCharLimit = deriveDynamicExtractionCharLimit(effectiveContextTokens);
  if (dynamicExtractionCharLimit) {
    extractionOpts.maxTextChars = dynamicExtractionCharLimit;
  }

  // 4. Extract content — use injectedContents for pipeline chaining, allSettled for resilience
  const injected = opts?.injectedContents;
  const contentResults = await Promise.allSettled(
    upstreamNodes.map(n => extractContent(n, canvasUri, injected, extractionOpts))
  );
  const contents: AIContent[] = [];

  contents.push(
    ...contentResults
      .filter((r): r is PromiseFulfilledResult<AIContent> => r.status === 'fulfilled')
      .map(r => r.value)
  );
  if (aiType === 'chat') {
    labelAiContentsForInlineCitations(contents, upstreamNodes);
  }

  // 3c. If any upstream edge carries a role, regroup contents with semantic headers.
  // Nodes with a role get grouped under "## <role label>" headers.
  // Nodes without a role retain the existing concatenation behaviour.
  const hasAnyRole = upstreamNodes.some(n => nodeRoleMap.get(n.id));
  if (hasAnyRole && toolId !== 'chat' && toolId !== 'rag') {
    // Group contents by role
    const roleGroups = new Map<string, AIContent[]>();
    const noRoleContents: AIContent[] = [];

    for (let i = 0; i < upstreamNodes.length; i++) {
      const node = upstreamNodes[i];
      const role = nodeRoleMap.get(node.id);
      const content = contents[i];
      if (!content) { continue; }

      if (role) {
        if (!roleGroups.has(role)) { roleGroups.set(role, []); }
        roleGroups.get(role)!.push(content);
      } else {
        noRoleContents.push(content);
      }
    }

    // Resolve slot label from tool def (fall back to role id)
    const slotLabelMap = new Map<string, string>();
    for (const slot of (toolDef.slots ?? [])) {
      slotLabelMap.set(slot.name, slot.label);
    }

    // Rebuild contents: role groups first (in slot definition order), then generic inputs
    const groupedContents: AIContent[] = [];
    const processedRoles = new Set<string>();

    // Preserve slot definition order
    for (const slot of (toolDef.slots ?? [])) {
      const group = roleGroups.get(slot.name);
      if (group) {
        const header = slotLabelMap.get(slot.name) ?? slot.name;
        // Prepend header as a text block
        groupedContents.push({ type: 'text', title: `Role: ${header}`, text: `## ${header}` });
        groupedContents.push(...group);
        processedRoles.add(slot.name);
      }
    }
    // Any role not in slots definition
    for (const [role, group] of roleGroups) {
      if (!processedRoles.has(role)) {
        groupedContents.push({ type: 'text', title: `Role: ${role}`, text: `## ${role}` });
        groupedContents.push(...group);
      }
    }
    // Generic (no-role) inputs appended at end
    groupedContents.push(...noRoleContents);

    contents.length = 0;
    contents.push(...groupedContents);
  }
  if (toolId === 'chat') {
    const chatPrompt = (nodeParams['_chatPrompt'] as string | undefined)?.trim() ?? '';
    if (!chatPrompt) {
      const msg = 'Chat 对话需要输入 Prompt，请在 Chat 节点中输入消息。';
      reportNodeIssue(webview, nodeId, runId, msg, 'missing_input');
      return { success: false, runId, errorMessage: msg };
    }
    const atRefs = [...chatPrompt.matchAll(/@([\w.\-]+)/g)].map(m => m[1].toLowerCase());
    if (atRefs.length > 0) {
      const referenced: AIContent[] = [];
      const remaining: AIContent[] = [];
      for (const c of contents) {
        const titleLower = c.title.toLowerCase();
        const isReferenced = atRefs.some(ref =>
          titleLower === ref ||
          titleLower === ref + '.md' ||
          titleLower.startsWith(ref + '.')
        );
        if (isReferenced) { referenced.push(c); } else { remaining.push(c); }
      }
      contents.length = 0;
      contents.push(...referenced, ...remaining);
    }
    contents.push({ type: 'text', title: 'User Message', text: chatPrompt });
  }

  // 3c. For RAG: append the user query as an explicit content block
  if (toolId === 'rag') {
    const query = (nodeParams['query'] as string | undefined)?.trim() ?? '';
    if (!query) {
      const msg = '文档问答需要输入问题，请填写节点上的「问题」字段。';
      reportNodeIssue(webview, nodeId, runId, msg, 'missing_input');
      return { success: false, runId, errorMessage: msg };
    }
    if (contents.length === 0) {
      const allDataNodes = canvas.nodes.filter(
        n => ['paper', 'note', 'code', 'ai_output'].includes(n.node_type)
      );
      const autoResults = await Promise.allSettled(allDataNodes.map(n => extractContent(n, canvasUri, undefined, extractionOpts)));
      const autoContents = autoResults
        .filter((r): r is PromiseFulfilledResult<AIContent> => r.status === 'fulfilled')
        .map(r => r.value);
      contents.push(...autoContents);
    }
    // Apply topK: keep the topK most-recently-added text contents by character overlap with query
    // (lightweight keyword heuristic — avoids embedding dependency)
    const topK = Number(nodeParams['topK'] ?? 5);
    if (contents.length > topK) {
      const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
      const scored = contents.map(c => {
        if (c.type !== 'text') { return { c, score: 0 }; }
        const words = (c.text ?? '').toLowerCase().split(/\s+/);
        const overlap = words.filter(w => queryWords.has(w)).length;
        return { c, score: overlap };
      }).sort((a, b) => b.score - a.score);
      contents.length = 0;
      contents.push(...scored.slice(0, topK).map(s => s.c));
    }
    contents.push({ type: 'text', title: 'User Question', text: query });
  }

  const reservedInputTokens = effectiveContextTokens
    ? Math.max(512, estimateTextTokens(systemPrompt) + 256)
    : undefined;
  const effectiveInputBudget = effectiveContextTokens && reservedInputTokens
    ? Math.max(effectiveContextTokens - reservedInputTokens, 1)
    : undefined;
  const shouldApplyMultimodalBudget = contents.some(c => c.type === 'image') && (
    aiType === 'image_edit' ||
    aiType === 'video_generation' ||
    (aiType === 'chat' && toolDef.supportsImages)
  );

  if (shouldApplyMultimodalBudget) {
    const budgetResult = applyMultimodalInputBudget(
      contents,
      resolveMultimodalBudgetOptions(aiType, toolId, effectiveInputBudget)
    );
    contents.length = 0;
    contents.push(...budgetResult.contents);

    if (budgetResult.droppedImages > 0 || budgetResult.trimmedTextBlocks > 0 || budgetResult.omittedTextBlocks > 0) {
      const warningParts: string[] = [];
      if (budgetResult.droppedImages > 0) {
        warningParts.push(`保留 ${budgetResult.keptImages} 张图，省略 ${budgetResult.droppedImages} 张图`);
      }
      if (budgetResult.trimmedTextBlocks > 0) {
        warningParts.push(`裁剪 ${budgetResult.trimmedTextBlocks} 段文本`);
      }
      if (budgetResult.omittedTextBlocks > 0) {
        warningParts.push(`省略 ${budgetResult.omittedTextBlocks} 段超长文本`);
      }
      const droppedTitlePreview = budgetResult.droppedImageTitles.slice(0, 3).join('、');
      const suffix = budgetResult.droppedImages > 0 && droppedTitlePreview
        ? `（已省略：${droppedTitlePreview}${budgetResult.droppedImages > 3 ? ' 等' : ''}）`
        : '';
      webview.postMessage({
        type: 'fnStatusUpdate',
        nodeId,
        status: 'running',
        progressText: `已按输入预算裁剪：${warningParts.join('；')}${suffix}`,
      });
    }
  } else if (effectiveInputBudget) {
    const cappedContents = applyInputTokenBudget(contents, effectiveInputBudget);
    contents.length = 0;
    contents.push(...cappedContents);
  }

  // F2: on-change guard — compute input fingerprint and skip if unchanged
  if (runGuard === 'on-change') {
    const fingerprint = contents
      .map(c => c.type === 'text' ? c.text : c.localPath ?? '')
      .join('|');
    // Simple djb2 hash (no crypto needed — just needs to be stable within a session)
    let hash = 5381;
    for (let i = 0; i < fingerprint.length; i++) {
      hash = ((hash << 5) + hash) + fingerprint.charCodeAt(i);
      hash |= 0; // force 32-bit int
    }
    const hashStr = String(hash >>> 0);
    const prevHash = fnNode.meta?.input_hash;
    if (prevHash === hashStr) {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done', progressText: '已是最新（输入未变化）' });
      setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);
      return { success: true, runId, errorMessage: undefined };
    }
    // Store hash so next run can compare — write it back to the canvas
    canvas.nodes = canvas.nodes.map(n =>
      n.id === nodeId ? { ...n, meta: { ...n.meta, input_hash: hashStr } } : n
    );
    CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
    await writeCanvas(canvasUri, canvas);
  }

  // 4. Route multimodal tools
  if (aiType !== 'chat') {
    const aiCfg = vscode.workspace.getConfiguration('researchSpace.ai');
    const aiHubMixApiKey = aiCfg.get<string>('aiHubMixApiKey', '');
    const defaultModels = {
      imageGen:   aiCfg.get<string>('aiHubMixImageGenModel', ''),
      imageEdit:  aiCfg.get<string>('aiHubMixImageEditModel', ''),
      imageFusion: aiCfg.get<string>('aiHubMixImageFusionModel', ''),
      imageGroup: aiCfg.get<string>('aiHubMixImageGroupModel', ''),
      tts:        aiCfg.get<string>('aiHubMixTtsModel', ''),
      stt:        aiCfg.get<string>('aiHubMixSttModel', ''),
      videoGen:   aiCfg.get<string>('aiHubMixVideoGenModel', ''),
    };
    switch (aiType) {
      case 'image_generation':
        return runImageGen(
          fnNode,
          toolDef,
          params,
          contents,
          canvasUri,
          webview,
          runId,
          aiHubMixApiKey,
          toolId === 'image-group-output' ? defaultModels.imageGroup : defaultModels.imageGen,
        );
      case 'image_edit':
        return runImageEdit(
          fnNode,
          toolDef,
          params,
          contents,
          canvasUri,
          webview,
          runId,
          aiHubMixApiKey,
          toolId === 'image-fusion' ? defaultModels.imageFusion : defaultModels.imageEdit,
        );
      case 'tts':
        return runTts(fnNode, toolDef, params, contents, canvasUri, webview, runId, aiHubMixApiKey, defaultModels.tts);
      case 'stt':
        return runStt(fnNode, toolDef, params, canvasUri, webview, runId, aiHubMixApiKey, defaultModels.stt);
      case 'video_generation':
        return runVideoGen(fnNode, toolDef, params, contents, canvasUri, webview, runId, aiHubMixApiKey, defaultModels.videoGen);
      default:
        break;
    }
  }

  // 5. Filter images only when the tool itself doesn't support them.
  // Each provider is responsible for handling images in its own stream() implementation.
  const filteredContents = !toolDef.supportsImages
    ? contents.filter(c => c.type !== 'image')
    : contents;

  // 6. Stream
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: 'AI 生成中…' });
  const controller = new AbortController();
  registerActiveRun(runId, controller);

  let fullText = '';
  let lastProgressUpdate = 0;
  try {
    const stream = provider.stream(systemPrompt, filteredContents, {
      signal: controller.signal,
      model: effectiveModel,
      maxTokens: effectiveMaxOutputTokens,
    });
    for await (const chunk of stream) {
      fullText += chunk;
      webview.postMessage({ type: 'aiChunk', runId, chunk });
      // F1: Push char-count progress every ~500ms to avoid flooding
      const now = Date.now();
      if (now - lastProgressUpdate > 500) {
        lastProgressUpdate = now;
        const charCount = fullText.length;
        const preview = fullText.slice(0, 80).replace(/\n/g, ' ');
        webview.postMessage({
          type: 'fnStatusUpdate',
          nodeId,
          status: 'running',
          progressText: `已生成 ${charCount} 字… ${preview}`,
        });
      }
    }
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
  activeRuns.delete(runId);
  if (isRunCancelled(runId) || controller.signal.aborted) {
    return { success: false, runId, errorMessage: 'Cancelled' };
  }

  // 8. Post-process
  const processed = registry.postProcess(toolId, fullText);
  if (isRunCancelled(runId)) {
    return { success: false, runId, errorMessage: 'Cancelled' };
  }
  const persistedText = processed.trimEnd() + '\n';
  const citationCoverage = analyzeInlineCitationCoverage(persistedText, provenance.sourceNodes);
  const citationWarning = buildCitationWarning(citationCoverage);

  // 9. Write output file
  const aiDir = await ensureAiOutputDir(canvasUri);
  const ts = formatTimestamp();
  const filename = `${toolId}_${ts}.md`;
  const fileUri = vscode.Uri.joinPath(aiDir, filename);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(persistedText, 'utf-8'));
  const relPath = toRelPath(fileUri.fsPath, canvasUri);

  // 10. Create output node — place it to the right of the function node,
  //     avoiding overlap with existing nodes using a simple collision scan.
  const outSize = { width: 280, height: 160 };
  const outPos = calcPreferredBlueprintOutputPosition(nodeId, fnNode, outSize, canvas);

  const outNode: CanvasNode = {
    id: uuid(),
    node_type: 'ai_output',
    title: `${toolDef.name} ${ts}`,
    position: outPos,
    size: outSize,
    file_path: relPath,
    meta: buildPersistedBlueprintOutputMeta(nodeId, fnNode, canvas, {
      content_preview: persistedText.slice(0, 300),
      ai_readable_chars: persistedText.length,
      ai_provider: provider.name,
      ai_model: effectiveModel || undefined,
      ai_source_nodes: provenance.sourceNodes,
      ai_source_summary: provenance.sourceSummary,
      ai_citation_coverage: citationCoverage,
      ai_citation_warning: citationWarning,
    }),
  };

  // 11. Create ai_generated edge
  const outEdge: CanvasEdge = {
    id: uuid(),
    source: nodeId,
    target: outNode.id,
    edge_type: 'ai_generated',
  };

  // 12. Persist
  appendPersistedOutputToCanvas(canvas, nodeId, outNode);
  CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
  await writeCanvas(canvasUri, canvas);

  webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done', progressText: citationWarning });

  const _resetTimer = setTimeout(() => {
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
  }, 3000);
  void _resetTimer;

  // 13. Done
  return { success: true, runId, outputNode: outNode };
}

// ── Multimodal execution helpers ───────────────────────────────────────────

type RunFnArgs = [
  fnNode: CanvasNode,
  toolDef: ReturnType<ToolRegistry['get']> & object,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
];

// ── Image generation — Gemini 3.1 Flash ──────────────────────────────────────

async function runImageGen(
  fnNode: CanvasNode,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '图像生成中…' });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const prompt = buildImageGenerationPrompt(params, contents);

  if (!prompt.trim()) {
    const msg = toolDef.id === 'image-group-output'
      ? '组图输出需要组图描述，请在参数中填写，或连接文本节点。'
      : '图像生成需要文字描述，请连接笔记节点或在参数中输入。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  if (toolDef.id === 'image-group-output') {
    const model = (params['model'] as string) || settingsDefaultModel || 'doubao-seedream-4-0-250828';
    const size = normalizeDoubaoSize(params['size'] as string | undefined);
    const maxImages = Math.max(1, Math.min(8, Number(params['max_images'] ?? 4) || 4));
    const watermark = Boolean(params['watermark'] ?? true);
    const controller = new AbortController();
    registerActiveRun(runId, controller);
    return runDoubaoImageGroupOutput(fnNode, prompt, model, size, maxImages, watermark, canvasUri, webview, runId, apiKey, controller);
  }

  const aspectRatio = (params['aspect_ratio'] as string) ?? '1:1';
  const size = normalizeDoubaoSize(params['size'] as string | undefined);
  const watermark = Boolean(params['watermark'] ?? true);
  const webSearch = Boolean(params['web_search'] ?? false);
  const model = (params['model'] as string) || settingsDefaultModel || 'gemini-3-pro-image-preview';
  const controller = new AbortController();
  registerActiveRun(runId, controller);

  if (isOpenAIImageModel(model)) {
    return runImageGenOpenAI(fnNode, params, prompt, model, canvasUri, webview, runId, apiKey, controller);
  }

  if (isDoubaoSeedreamModel(model)) {
    return runImageGenDoubao(fnNode, prompt, model, size, watermark, webSearch, canvasUri, webview, runId, apiKey, controller);
  }

  return runImageGenGemini(fnNode, params, prompt, model, aspectRatio, canvasUri, webview, runId, apiKey, controller);
}

// ── Gemini image generation ────────────────────────────────────────────────

async function runImageGenGemini(
  fnNode: CanvasNode,
  _params: Record<string, unknown>,
  prompt: string,
  model: string,
  aspectRatio: string,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;

  try {
    const result = await requestGeminiImageGeneration({
      nodeId,
      fnNode,
      prompt,
      model,
      aspectRatio,
      canvasUri,
      apiKey,
      signal: controller.signal,
      adapters: getImageExecutionCanvasAdapters(),
    });
    return completeImageRun(webview, nodeId, runId, result);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

async function runImageGenOpenAI(
  fnNode: CanvasNode,
  params: Record<string, unknown>,
  prompt: string,
  model: string,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const result = await requestOpenAIImageGeneration({
      nodeId,
      fnNode,
      params,
      prompt,
      model,
      canvasUri,
      apiKey,
      signal: controller.signal,
      adapters: getImageExecutionCanvasAdapters(),
    });
    return completeImageRun(webview, nodeId, runId, result);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

async function runImageGenDoubao(
  fnNode: CanvasNode,
  prompt: string,
  model: string,
  size: string,
  watermark: boolean,
  webSearch: boolean,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const result = await requestDoubaoImageGeneration({
      nodeId,
      fnNode,
      prompt,
      model,
      size,
      watermark,
      webSearch,
      canvasUri,
      apiKey,
      signal: controller.signal,
      adapters: getImageExecutionCanvasAdapters(),
    });
    return completeImageRun(webview, nodeId, runId, result);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

async function runDoubaoImageGroupOutput(
  fnNode: CanvasNode,
  prompt: string,
  model: string,
  size: string,
  maxImages: number,
  watermark: boolean,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const result = await requestDoubaoImageGroupOutput({
      nodeId,
      fnNode,
      prompt,
      model,
      size,
      maxImages,
      watermark,
      canvasUri,
      apiKey,
      signal: controller.signal,
      adapters: getImageExecutionCanvasAdapters(),
    });
    return completeImageRun(webview, nodeId, runId, result);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}



// ── Text-to-Speech — gpt-4o-mini-tts ──────────────────────────────────────

async function runTts(
  fnNode: CanvasNode,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '语音合成中…' });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const inputText = contents.filter(c => c.type === 'text').map(c => c.text).join('\n\n').slice(0, 4096);
  if (!inputText.trim()) {
    const msg = '文字转语音需要连接笔记或 AI 输出节点作为文本输入。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const model = (params['model'] as string) || settingsDefaultModel || 'gpt-4o-mini-tts';
  const voice = (params['voice'] as string) ?? 'coral';
  const responseFormat = (params['response_format'] as string) ?? 'mp3';
  const controller = new AbortController();
  registerActiveRun(runId, controller);

  try {
    const ttsResult = await requestTextToSpeech({
      apiKey,
      inputText,
      model,
      voice,
      responseFormat,
      signal: controller.signal,
    });
    const aiDir = await ensureAiOutputDir(canvasUri);
    const ts = formatTimestamp();
    const filename = `tts_${ts}.${ttsResult.responseFormat}`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, ttsResult.audioBytes);
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const activeDocTTS = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'audio',
      title: `Audio ${ts}`,
      position: calcPreferredBlueprintOutputPosition(nodeId, fnNode, { width: 240, height: 120 }, activeDocTTS?.data),
      size: { width: 240, height: 120 },
      file_path: relPath,
      meta: buildPersistedBlueprintOutputMeta(nodeId, fnNode, activeDocTTS?.data, buildMultimodalNodeMeta(ttsResult.model)),
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };

    // Persist output node to Extension Host canvas
    if (activeDocTTS) {
      activeDocTTS.data.nodes.push(outNode);
      activeDocTTS.data.edges.push(outEdge);
      CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
      await writeCanvas(canvasUri, activeDocTTS.data);
    }

    activeRuns.delete(runId);
    webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);

    const outputContent: AIContent = { type: 'text', title: outNode.title, text: `[Audio: ${relPath}]` };
    return { success: true, runId, outputContent, outputNode: outNode };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

// ── Speech-to-Text ─────────────────────────────────────────────────────────

async function runStt(
  fnNode: CanvasNode,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  const isMeetingTranscribe = toolDef.id === 'meeting-transcribe';
  webview.postMessage({
    type: 'fnStatusUpdate',
    nodeId,
    status: 'running',
    progressText: isMeetingTranscribe ? '会议录音转写中…' : '音频转录中…',
  });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  // Find connected audio node's file path
  // NOTE: We receive fnNode but not the full canvas here. We use CanvasEditorProvider's
  // active documents to get the current canvas state.
  const activeDoc = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
  const canvas = activeDoc?.data;
  if (!canvas) {
    const msg = '无法访问画布文档，STT 初始化失败。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const executionPlan = buildFunctionExecutionPlan(nodeId, canvas, ['data_flow']);
  if ('error' in executionPlan) {
    reportNodeIssue(webview, nodeId, runId, executionPlan.error, 'missing_input');
    return { success: false, runId, errorMessage: executionPlan.error };
  }

  const audioNode = executionPlan.expandedInputs.find(ref => ref.node.node_type === 'audio')?.node;
  if (!audioNode?.file_path) {
    const msg = '语音转文字需要连接音频节点（通过数据流边）。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const { toAbsPath } = await import('../core/storage');
  const absPath = toAbsPath(audioNode.file_path, canvasUri);
  const audioBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
  const audioBuffer = Buffer.from(audioBytes);

  const model = (params['model'] as string) || settingsDefaultModel || 'whisper-large-v3-turbo';
  const language = (params['language'] as string)?.trim() ?? '';
  const responseFormat = (params['response_format'] as string) ?? 'text';

  const controller = new AbortController();
  registerActiveRun(runId, controller);

  try {
    const sttResult = await requestSpeechToText({
      apiKey,
      audioBytes: audioBuffer,
      filename: absPath,
      model,
      language,
      responseFormat,
      signal: controller.signal,
    });
    const transcriptText = sttResult.text;
    const persistedText = isMeetingTranscribe
      ? [
          '# 会议转写',
          '',
          `- 来源音频：${audioNode.title || audioNode.file_path}`,
          `- 转写模型：${sttResult.model}`,
          language ? `- 语言：${language}` : '- 语言：自动检测',
          '- 输出语义：会议录音转写，适合继续连接“行动项 / 摘要 / 会议纪要”类工具。',
          '',
          '---',
          '',
          transcriptText,
        ].join('\n')
      : transcriptText;

    const aiDir = await ensureAiOutputDir(canvasUri);
    const ts = formatTimestamp();
    const filename = `${isMeetingTranscribe ? 'meeting_transcript' : 'stt'}_${ts}.md`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(persistedText, 'utf-8'));
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'ai_output',
      title: `${isMeetingTranscribe ? 'Meeting Transcript' : 'Transcript'} ${ts}`,
      position: calcPreferredBlueprintOutputPosition(nodeId, fnNode, { width: 280, height: 160 }, activeDoc?.data),
      size: { width: 280, height: 160 },
      file_path: relPath,
      meta: buildPersistedBlueprintOutputMeta(nodeId, fnNode, activeDoc?.data, buildMultimodalNodeMeta(sttResult.model, {
        content_preview: persistedText.slice(0, 300),
        ai_readable_chars: persistedText.length,
      })),
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };

    // Persist output node to Extension Host canvas
    // (canvas is already available via the activeDoc workaround in this function)
    if (activeDoc) {
      activeDoc.data.nodes.push(outNode);
      activeDoc.data.edges.push(outEdge);
      CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
      await writeCanvas(canvasUri, activeDoc.data);
    }

    activeRuns.delete(runId);
    webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);

    const outputContent: AIContent = { type: 'text', title: outNode.title, text: persistedText };
    return { success: true, runId, outputContent, outputNode: outNode };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

// ── Video generation ──────────────────────────────────────────────────────

async function runVideoGen(
  fnNode: CanvasNode,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '提交视频任务…' });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const model = (params['model'] as string) || settingsDefaultModel || 'doubao-seedance-2-0-260128';
  const seconds = String(params['seconds'] ?? '5');
  const size = (params['size'] as string) ?? '1080p';
  const motionPrompt = ((params['motion_prompt'] as string) ?? '').trim();

  // Text prompt from connected text nodes
  const textPrompt = contents.filter(c => c.type === 'text').map(c => c.text).join('\n').slice(0, 1000).trim();
  const effectivePrompt = motionPrompt || textPrompt;

  // image-to-video: check for a reference image in contents
  const imageContent = contents.find((c): c is AIContent & { type: 'image' } => c.type === 'image');
  const isImageToVideo = !!imageContent;

  if (!effectivePrompt && !isImageToVideo) {
    const msg = '视频生成需要文字描述（连接笔记节点）或参考图像（连接图像节点实现图生视频）。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const controller = new AbortController();
  registerActiveRun(runId, controller);

  try {
    const videoResult = await requestVideoGeneration({
      apiKey,
      model,
      prompt: effectivePrompt,
      size,
      seconds,
      imageContent: isImageToVideo && imageContent?.type === 'image' ? imageContent : undefined,
      signal: controller.signal,
      onProgress: progress => {
        if (progress.phase === 'downloading') {
          webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '视频下载中…' });
          return;
        }
        const elapsed = progress.elapsedSeconds ?? 0;
        const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const ss = String(elapsed % 60).padStart(2, '0');
        const statusSuffix = progress.status ? ` · ${progress.status}` : '';
        webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: `视频生成中… ${mm}:${ss}${statusSuffix}` });
      },
    });

    const aiDir = await ensureAiOutputDir(canvasUri);
    const ts = formatTimestamp();
    const filename = `video-gen_${ts}.mp4`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, videoResult.videoBytes);
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const activeDocVG = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'video',
      title: `Video ${ts}`,
      position: calcPreferredBlueprintOutputPosition(nodeId, fnNode, { width: 280, height: 180 }, activeDocVG?.data),
      size: { width: 280, height: 180 },
      file_path: relPath,
      meta: buildPersistedBlueprintOutputMeta(nodeId, fnNode, activeDocVG?.data, buildMultimodalNodeMeta(videoResult.model)),
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };

    if (activeDocVG) {
      activeDocVG.data.nodes.push(outNode);
      activeDocVG.data.edges.push(outEdge);
      CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
      await writeCanvas(canvasUri, activeDocVG.data);
    }

    activeRuns.delete(runId);
    webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);

    const outputContent: AIContent = { type: 'text', title: outNode.title, text: `[Video: ${relPath}]` };
    return { success: true, runId, outputContent, outputNode: outNode };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

function countExistingFunctionOutputNodes(
  nodeId: string,
  canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
): number {
  if (!canvas) { return 0; }

  const outputTargetIds = new Set(
    canvas.edges
      .filter(edge => edge.edge_type === 'ai_generated' && edge.source === nodeId)
      .map(edge => edge.target),
  );
  if (outputTargetIds.size === 0) { return 0; }

  return canvas.nodes.filter(node => outputTargetIds.has(node.id)).length;
}

// ── Output position calculator (A1) ───────────────────────────────────────────
// Keeps normal function outputs anchored to the right of the source function and
// applies a small vertical offset for each existing historical output, mirroring
// the blueprint final-output stacking style.
export function calcOutputPosition(
  nodeId: string,
  fnNode: CanvasNode,
  outSize: { width: number; height: number },
  canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
): { x: number; y: number } {
  const existingOutputCount = countExistingFunctionOutputNodes(nodeId, canvas);
  return {
    x: fnNode.position.x + fnNode.size.width + 72,
    y: fnNode.position.y + Math.max((fnNode.size.height - outSize.height) / 2, 0) + (existingOutputCount * 36),
  };
}

function calcPreferredBlueprintOutputPosition(
  nodeId: string,
  fnNode: CanvasNode,
  outSize: { width: number; height: number },
  canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
): { x: number; y: number } {
  const directOutputTarget = resolveBlueprintOutputTarget(nodeId, canvas);
  if (directOutputTarget?.position) {
    return {
      x: directOutputTarget.position.x + (directOutputTarget.size?.width ?? 240) + 72,
      y: directOutputTarget.position.y + Math.max(((directOutputTarget.size?.height ?? 136) - outSize.height) / 2, 0),
    };
  }
  if (hasBlueprintInternalPipelineConsumers(nodeId, fnNode, canvas)) {
    return {
      x: fnNode.position.x + Math.max((fnNode.size.width - outSize.width) / 2, 12),
      y: fnNode.position.y + Math.max((fnNode.size.height - outSize.height) / 2, 12),
    };
  }
  return calcOutputPosition(nodeId, fnNode, outSize, canvas);
}

function resolveBlueprintOutputTarget(
  nodeId: string,
  canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
): CanvasNode | null {
  if (!canvas) { return null; }

  const directBlueprintTargets = canvas.edges
    .filter(edge =>
      edge.source === nodeId &&
      (edge.edge_type === 'ai_generated' || edge.edge_type === 'data_flow')
    )
    .map(edge => canvas.nodes.find(node => node.id === edge.target))
    .filter((node): node is CanvasNode => !!node);

  const outputPlaceholderNode = directBlueprintTargets.find(node =>
    node.meta?.blueprint_placeholder_kind === 'output'
  );

  const existingBoundOutputNode = directBlueprintTargets.find(node =>
    node.meta?.blueprint_bound_slot_kind === 'output'
  );

  return outputPlaceholderNode ?? existingBoundOutputNode ?? null;
}

function buildPersistedBlueprintOutputMeta(
  nodeId: string,
  fnNode: CanvasNode,
  canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
  extra?: CanvasNode['meta'],
): CanvasNode['meta'] {
  const directOutputTarget = resolveBlueprintOutputTarget(nodeId, canvas);
  const slotId = directOutputTarget?.meta?.blueprint_placeholder_slot_id
    ?? directOutputTarget?.meta?.blueprint_bound_slot_id;
  const instanceId = directOutputTarget?.meta?.blueprint_placeholder_kind === 'output'
    ? directOutputTarget.meta?.blueprint_instance_id
    : directOutputTarget?.meta?.blueprint_bound_slot_kind === 'output'
      ? directOutputTarget.meta?.blueprint_bound_instance_id
      : undefined;
  const slotTitle = directOutputTarget?.meta?.blueprint_placeholder_title
    ?? directOutputTarget?.meta?.blueprint_bound_slot_title
    ?? directOutputTarget?.title;
  const isHiddenBlueprintRuntimeOutput = !slotId && hasBlueprintInternalPipelineConsumers(nodeId, fnNode, canvas);

  return {
    ...(extra ?? {}),
    ...(fnNode.meta?.blueprint_def_id ? { blueprint_def_id: fnNode.meta.blueprint_def_id } : {}),
    ...(fnNode.meta?.blueprint_color ? { blueprint_color: fnNode.meta.blueprint_color } : {}),
    ...(isHiddenBlueprintRuntimeOutput
      ? {
          blueprint_instance_id: fnNode.meta?.blueprint_instance_id,
          blueprint_runtime_hidden: true,
        }
      : {}),
    ...(slotId && instanceId
      ? {
          blueprint_bound_instance_id: instanceId,
          blueprint_bound_slot_id: slotId,
          blueprint_bound_slot_title: slotTitle,
          blueprint_bound_slot_kind: 'output' as const,
        }
      : {}),
  };
}

function resolveBlueprintOutputPlaceholderTarget(
  nodeId: string,
  canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
): CanvasNode | null {
  const directOutputTarget = resolveBlueprintOutputTarget(nodeId, canvas);
  if (!canvas || !directOutputTarget) { return null; }
  if (directOutputTarget.meta?.blueprint_placeholder_kind === 'output') {
    return directOutputTarget;
  }

  const instanceId = directOutputTarget.meta?.blueprint_bound_slot_kind === 'output'
    ? directOutputTarget.meta?.blueprint_bound_instance_id
    : undefined;
  const slotId = directOutputTarget.meta?.blueprint_bound_slot_kind === 'output'
    ? directOutputTarget.meta?.blueprint_bound_slot_id
    : undefined;
  if (!instanceId || !slotId) { return null; }

  return canvas.nodes.find(node =>
    node.meta?.blueprint_instance_id === instanceId &&
    node.meta?.blueprint_placeholder_kind === 'output' &&
    node.meta?.blueprint_placeholder_slot_id === slotId
  ) ?? null;
}

function buildPersistedBlueprintBindingEdge(
  nodeId: string,
  outNode: CanvasNode,
  canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
): CanvasEdge | null {
  if (
    outNode.meta?.blueprint_bound_slot_kind !== 'output' ||
    !outNode.meta?.blueprint_bound_instance_id ||
    !outNode.meta?.blueprint_bound_slot_id
  ) {
    return null;
  }

  const placeholderTarget = resolveBlueprintOutputPlaceholderTarget(nodeId, canvas);
  if (!placeholderTarget) { return null; }

  return {
    id: uuid(),
    source: placeholderTarget.id,
    target: outNode.id,
    edge_type: 'data_flow',
    role: outNode.meta.blueprint_bound_slot_id,
  };
}

function appendPersistedOutputToCanvas(
  canvas: Pick<CanvasFile, 'nodes' | 'edges'>,
  nodeId: string,
  outNode: CanvasNode,
): CanvasEdge[] {
  canvas.nodes.push(outNode);
  const placeholderTarget = resolveBlueprintOutputPlaceholderTarget(nodeId, canvas);
  const generatedEdge: CanvasEdge = {
    id: uuid(),
    source: nodeId,
    target: placeholderTarget?.id ?? outNode.id,
    edge_type: 'ai_generated',
  };
  const edgesToAppend: CanvasEdge[] = [generatedEdge];
  const bindingEdge = buildPersistedBlueprintBindingEdge(nodeId, outNode, canvas);
  if (bindingEdge) {
    edgesToAppend.push(bindingEdge);
  }
  canvas.edges.push(...edgesToAppend);
  return edgesToAppend;
}

function hasBlueprintInternalPipelineConsumers(
  nodeId: string,
  fnNode: CanvasNode,
  canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
): boolean {
  const instanceId = fnNode.meta?.blueprint_instance_id;
  if (!instanceId || !canvas) { return false; }

  return canvas.edges.some(edge => {
    if (edge.edge_type !== 'pipeline_flow' || edge.source !== nodeId) { return false; }
    const targetNode = canvas.nodes.find(node => node.id === edge.target);
    return targetNode?.meta?.blueprint_instance_id === instanceId;
  });
}

function getImageExecutionCanvasAdapters() {
  return {
    calcOutputPosition: calcPreferredBlueprintOutputPosition,
    buildOutputMeta: buildPersistedBlueprintOutputMeta,
    appendOutputToCanvas: appendPersistedOutputToCanvas,
  };
}

// ── Image editing ──────────────────────────────────────────────────────────

async function runImageEdit(
  fnNode: CanvasNode,
  _toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '图像编辑中…' });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const imageContents = contents.filter((c): c is AIContent & { type: 'image' } => c.type === 'image');
  if (imageContents.length === 0) {
    const msg = _toolDef.id === 'image-fusion'
      ? '多图融合需要至少连接 2 个图像节点。'
      : '图像编辑需要连接图像节点作为参考图。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  if (_toolDef.id === 'image-fusion' && imageContents.length < 2) {
    const msg = '多图融合至少需要连接 2 个图像节点。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const prompt = _toolDef.id === 'image-fusion'
    ? ((params['instruction'] as string) ?? '').trim()
    : buildImageEditPrompt(params, contents);

  if (!prompt) {
    const msg = _toolDef.id === 'image-fusion'
      ? '多图融合需要融合指令，请在节点下方填写。'
      : '图像编辑需要编辑指令，请在节点下方填写，或连接文本节点。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const model = (params['model'] as string) || settingsDefaultModel || (_toolDef.id === 'image-fusion' ? 'doubao-seedream-4-0-250828' : 'gemini-3-pro-image-preview');
  const aspectRatio = (params['aspect_ratio'] as string) ?? '1:1';
  const size = normalizeDoubaoSize(params['size'] as string | undefined);
  const watermark = Boolean(params['watermark'] ?? false);

  const controller = new AbortController();
  registerActiveRun(runId, controller);

  if (_toolDef.id === 'image-fusion') {
    return runDoubaoImageFusion(fnNode, prompt, model, imageContents, size, watermark, canvasUri, webview, runId, apiKey, controller);
  }

  if (isOpenAIImageModel(model)) {
    return runImageEditOpenAI(fnNode, params, prompt, model, imageContents[0], canvasUri, webview, runId, apiKey, controller);
  }

  if (isDoubaoSeedreamModel(model)) {
    return runImageEditDoubao(fnNode, prompt, model, imageContents[0], size, watermark, canvasUri, webview, runId, apiKey, controller);
  }

  return runImageEditGemini(fnNode, prompt, model, imageContents[0], aspectRatio, canvasUri, webview, runId, apiKey, controller);
}

async function runImageEditGemini(
  fnNode: CanvasNode,
  prompt: string,
  model: string,
  imageContent: AIContent & { type: 'image' },
  aspectRatio: string,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const result = await requestGeminiImageEdit({
      nodeId,
      fnNode,
      prompt,
      model,
      imageContent,
      aspectRatio,
      canvasUri,
      apiKey,
      signal: controller.signal,
      adapters: getImageExecutionCanvasAdapters(),
    });
    return completeImageRun(webview, nodeId, runId, result);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}


async function runImageEditOpenAI(
  fnNode: CanvasNode,
  params: Record<string, unknown>,
  prompt: string,
  model: string,
  imageContent: AIContent & { type: 'image' },
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const result = await requestOpenAIImageEdit({
      nodeId,
      fnNode,
      params,
      prompt,
      model,
      imageContent,
      canvasUri,
      apiKey,
      signal: controller.signal,
      adapters: getImageExecutionCanvasAdapters(),
    });
    return completeImageRun(webview, nodeId, runId, result);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

async function runImageEditDoubao(
  fnNode: CanvasNode,
  prompt: string,
  model: string,
  imageContent: AIContent & { type: 'image' },
  size: string,
  watermark: boolean,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const result = await requestDoubaoImageEdit({
      nodeId,
      fnNode,
      prompt,
      model,
      imageContent,
      size,
      watermark,
      canvasUri,
      apiKey,
      signal: controller.signal,
      adapters: getImageExecutionCanvasAdapters(),
    });
    return completeImageRun(webview, nodeId, runId, result);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

async function runDoubaoImageFusion(
  fnNode: CanvasNode,
  prompt: string,
  model: string,
  imageContents: Array<AIContent & { type: 'image' }>,
  size: string,
  watermark: boolean,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const result = await requestDoubaoImageFusion({
      nodeId,
      fnNode,
      prompt,
      model,
      imageContents,
      size,
      watermark,
      canvasUri,
      apiKey,
      signal: controller.signal,
      adapters: getImageExecutionCanvasAdapters(),
    });
    return completeImageRun(webview, nodeId, runId, result);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}
