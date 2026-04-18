import * as vscode from 'vscode';
import { v4 as uuid } from 'uuid';
import {
  isBlueprintInstanceContainerNode,
  isFunctionNode,
  type PipelineCompletionStatus,
  type CanvasFile,
  type CanvasNode,
  type CanvasEdge,
} from '../core/canvas-model';
import { buildFunctionExecutionPlan } from '../core/execution-plan';
import { AIContent } from '../ai/provider';
import { runFunctionNode, FunctionRunResult, cancelRunByNodeId } from '../ai/function-runner';
import { readCanvas } from '../core/storage';
import { buildPipelinePlan, PipelinePlan } from './pipeline-engine';
import { validatePipeline } from './pipeline-validator';
import { CanvasEditorProvider } from '../providers/CanvasEditorProvider';
import { extractContent } from '../core/content-extractor';

// ── Pipeline Runner (v2.0) ──────────────────────────────────────────────────
// Executes a pipeline: topological sort → layer-by-layer execution
// Each layer runs in parallel; next layer waits for current to finish.

export type PipelineNodeStatus = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

interface PipelineContext {
  pipelineId: string;
  triggerNodeId: string;
  plan: PipelinePlan;
  nodeStatuses: Map<string, PipelineNodeStatus>;
  /** Maps function-node-id → its AI output content (for injection into downstream) */
  outputContents: Map<string, AIContent>;
  /** Maps function-node-id → its output CanvasNode (for edge tracking) */
  outputNodes: Map<string, CanvasNode>;
  isPaused: boolean;
  isCancelled: boolean;
  abortController: AbortController;
  pausePromise: Promise<void> | null;
  pauseResolve: (() => void) | null;
}

// Active pipeline contexts (for pause/resume/cancel from outside)
const activePipelines = new Map<string, PipelineContext>();

function inferPipelineIssueKind(message: string): 'missing_input' | 'missing_config' | 'run_failed' {
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
    lower.includes('请填写') ||
    lower.includes('需要输入')
  ) {
    return 'missing_input';
  }
  return 'run_failed';
}

function inferPipelineCompletionStatus(ctx: PipelineContext): PipelineCompletionStatus {
  if (ctx.isCancelled) { return 'cancelled'; }
  for (const status of ctx.nodeStatuses.values()) {
    if (status === 'failed') { return 'failed'; }
  }
  return 'succeeded';
}

function postBlueprintRunRejectedIfNeeded(
  triggerNodeId: string,
  executionCanvas: CanvasFile,
  webview: vscode.Webview,
  message: string,
): void {
  const triggerNode = executionCanvas.nodes.find(node => node.id === triggerNodeId);
  if (!isBlueprintInstanceContainerNode(triggerNode)) { return; }
  webview.postMessage({ type: 'blueprintRunRejected', containerNodeId: triggerNodeId, message });
}

export function pausePipeline(pipelineId: string): void {
  const ctx = activePipelines.get(pipelineId);
  if (!ctx || ctx.isCancelled) { return; }
  ctx.isPaused = true;
  ctx.pausePromise = new Promise<void>(resolve => { ctx.pauseResolve = resolve; });
}

export function resumePipeline(pipelineId: string): void {
  const ctx = activePipelines.get(pipelineId);
  if (!ctx) { return; }
  ctx.isPaused = false;
  if (ctx.pauseResolve) { ctx.pauseResolve(); ctx.pauseResolve = null; ctx.pausePromise = null; }
}

export function cancelPipeline(pipelineId: string): void {
  const ctx = activePipelines.get(pipelineId);
  if (!ctx) { return; }
  ctx.isCancelled = true;
  ctx.abortController.abort();
  // Also resume if paused so the loop can exit
  if (ctx.pauseResolve) { ctx.pauseResolve(); }
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function runPipeline(
  triggerNodeId: string,
  executionCanvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
): Promise<void> {
  const triggerNode = executionCanvas.nodes.find(node => node.id === triggerNodeId);
  if (!isFunctionNode(triggerNode)) {
    webview.postMessage({ type: 'error', message: 'Pipeline 只能从功能节点启动。' });
    return;
  }

  const plan = buildPipelinePlan(triggerNodeId, executionCanvas.nodes, executionCanvas.edges, executionCanvas.nodeGroups);
  if ('error' in plan) {
    webview.postMessage({ type: 'error', message: `Pipeline 构建失败: ${plan.error}` });
    return;
  }

  await runPipelinePlan(triggerNodeId, plan, executionCanvas, canvasUri, webview);
}

export async function runPipelinePlan(
  triggerNodeId: string,
  plan: PipelinePlan,
  executionCanvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
): Promise<void> {
  let canvas = executionCanvas;

  if (plan.layers.length === 0) {
    postBlueprintRunRejectedIfNeeded(triggerNodeId, executionCanvas, webview, '没有可执行的管道节点');
    webview.postMessage({ type: 'error', message: '没有可执行的管道节点' });
    return;
  }

  // Pre-run validation
  const validation = validatePipeline(plan, canvas.nodes, canvas.edges);
  if (!validation.valid) {
    const errorMessages = validation.errors
      .filter(e => e.severity === 'error')
      .map(e => e.message)
      .join('\n');
    postBlueprintRunRejectedIfNeeded(triggerNodeId, executionCanvas, webview, `Pipeline 校验失败:\n${errorMessages}`);
    webview.postMessage({ type: 'error', message: `Pipeline 校验失败:\n${errorMessages}` });
    return;
  }
  const warnings = validation.errors.filter(e => e.severity === 'warning');

  const pipelineId = uuid();
  const totalCount = plan.pipelineNodeIds.length;
  const ctx: PipelineContext = {
    pipelineId,
    triggerNodeId,
    plan,
    nodeStatuses: new Map(plan.pipelineNodeIds.map(id => [id, 'waiting' as PipelineNodeStatus])),
    outputContents: new Map(),
    outputNodes: new Map(),
    isPaused: false,
    isCancelled: false,
    abortController: new AbortController(),
    pausePromise: null,
    pauseResolve: null,
  };

  activePipelines.set(pipelineId, ctx);

  // Notify webview that pipeline started (with full metadata for UI)
  webview.postMessage({
    type: 'pipelineStarted',
    pipelineId,
    triggerNodeId,
    nodeIds: plan.pipelineNodeIds,
    totalNodes: totalCount,
  });

  for (const w of warnings) {
    webview.postMessage({
      type: 'pipelineValidationWarning',
      pipelineId,
      nodeId: w.nodeId,
      message: w.message,
    });
  }

  // Clear any stale per-node status from a previous run. Waiting/skip/running
  // states are driven by the pipeline-specific status messages.
  for (const nodeId of plan.pipelineNodeIds) {
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
  }

  let completedCount = 0;

  try {
    for (let layerIdx = 0; layerIdx < plan.layers.length; layerIdx++) {
      if (ctx.isCancelled) { break; }
      if (ctx.isPaused && ctx.pausePromise) { await ctx.pausePromise; }
      if (ctx.isCancelled) { break; }

      const layer = plan.layers[layerIdx];
      const layerPromises: Promise<void>[] = [];

      for (const nodeId of layer.nodeIds) {
        if (ctx.isCancelled) { break; }
        if (ctx.nodeStatuses.get(nodeId) === 'skipped') { continue; }

        // Check if any upstream node failed → skip this node
        const dependencyNodeIds = plan.dependencyNodeIdsByNode[nodeId] ?? [];
        const hasFailedUpstream = dependencyNodeIds.some(sourceId => ctx.nodeStatuses.get(sourceId) === 'failed');
        if (hasFailedUpstream) {
          ctx.nodeStatuses.set(nodeId, 'skipped');
          completedCount++;
          webview.postMessage({
            type: 'pipelineNodeSkipped',
            pipelineId,
            nodeId,
            reason: '上游节点执行失败',
            issueKind: 'skipped',
          });
          continue;
        }

        layerPromises.push(
          runPipelineNode(ctx, nodeId, canvas, canvasUri, webview).then(result => {
            if (result.success && result.outputNode) {
              ctx.nodeStatuses.set(nodeId, 'done');
              completedCount++;
              webview.postMessage({
                type: 'pipelineNodeComplete',
                pipelineId,
                nodeId,
                outputNodeId: result.outputNode.id,
              });
            } else {
              if (ctx.isCancelled && result.errorMessage === 'Cancelled') {
                ctx.nodeStatuses.set(nodeId, 'skipped');
                completedCount++;
                webview.postMessage({
                  type: 'pipelineNodeSkipped',
                  pipelineId,
                  nodeId,
                  reason: '用户取消执行',
                  issueKind: 'skipped',
                });
                return;
              }
              ctx.nodeStatuses.set(nodeId, 'failed');
              completedCount++;
              // Mark all downstream as skipped
              completedCount += markDownstreamSkipped(ctx, nodeId, webview);
              webview.postMessage({
                type: 'pipelineNodeError',
                pipelineId,
                nodeId,
                error: result.errorMessage ?? 'Unknown error',
                issueKind: inferPipelineIssueKind(result.errorMessage ?? 'Unknown error'),
              });
            }
          })
        );
      }

      // Wait for all nodes in current layer to complete
      await Promise.all(layerPromises);

      // Re-read canvas to pick up output nodes added during this layer
      canvas = await readCanvas(canvasUri);
    }
  } finally {
    activePipelines.delete(pipelineId);
    const completionStatus = inferPipelineCompletionStatus(ctx);

    // Reset all pipeline node statuses after a short delay
    setTimeout(() => {
      for (const nodeId of plan.pipelineNodeIds) {
        webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      }
    }, 5000);

    webview.postMessage({
      type: 'pipelineComplete',
      pipelineId,
      totalNodes: totalCount,
      completedNodes: countCompletedNodes(ctx),
      status: completionStatus,
    });
  }
}

// ── Run a single node within a pipeline context ─────────────────────────────

async function runPipelineNode(
  ctx: PipelineContext,
  nodeId: string,
  _canvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
): Promise<FunctionRunResult> {
  ctx.nodeStatuses.set(nodeId, 'running');
  webview.postMessage({ type: 'pipelineNodeStart', pipelineId: ctx.pipelineId, nodeId });

  // Re-read canvas for this node's run (may have been updated by earlier nodes)
  const freshCanvas = await readCanvas(canvasUri);
  const executionPlan = buildFunctionExecutionPlan(nodeId, freshCanvas, ['data_flow', 'pipeline_flow']);
  if ('error' in executionPlan) {
    return {
      success: false,
      runId: uuid(),
      errorMessage: executionPlan.error,
    };
  }

  // Build injected contents from upstream pipeline outputs using the same input
  // plan that single-node execution uses. This keeps "function input resolution"
  // and "pipeline chaining resolution" aligned on one source of truth.
  const injectedContents = new Map<string, AIContent>();
  for (const sourceId of executionPlan.directPipelineSourceIds) {
    const upstreamOutput = ctx.outputContents.get(sourceId);
    if (!upstreamOutput) { continue; }
    injectedContents.set(sourceId, upstreamOutput);
  }

  const result = await runFunctionNode(nodeId, freshCanvas, canvasUri, webview, {
    injectedContents: injectedContents.size > 0 ? injectedContents : undefined,
  });

  if (result.success && result.outputNode) {
    // Store the output content for downstream nodes
    try {
      const outputContent = await extractContent(result.outputNode, canvasUri);
      ctx.outputContents.set(nodeId, outputContent);
      ctx.outputNodes.set(nodeId, result.outputNode);
    } catch {
      // If we can't extract, use preview as fallback
      ctx.outputContents.set(nodeId, {
        type: 'text',
        title: result.outputNode.title,
        text: result.outputNode.meta?.content_preview ?? '',
      });
      ctx.outputNodes.set(nodeId, result.outputNode);
    }
  }

  return result;
}

// ── Mark all downstream nodes as skipped ────────────────────────────────────

function markDownstreamSkipped(
  ctx: PipelineContext,
  failedNodeId: string,
  webview: vscode.Webview,
): number {
  const queue = [failedNodeId];
  const visited = new Set<string>();
  let skippedCount = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of ctx.plan.pipelineEdges) {
      if (edge.source !== current) { continue; }
      if (visited.has(edge.target)) { continue; }
      visited.add(edge.target);
      const prevStatus = ctx.nodeStatuses.get(edge.target);
      if (prevStatus && ['done', 'failed', 'skipped'].includes(prevStatus)) { continue; }
      ctx.nodeStatuses.set(edge.target, 'skipped');
      skippedCount++;
      webview.postMessage({
        type: 'pipelineNodeSkipped',
        pipelineId: ctx.pipelineId,
        nodeId: edge.target,
        reason: '上游节点执行失败',
        issueKind: 'skipped',
      });
      queue.push(edge.target);
    }
  }

  return skippedCount;
}

function countCompletedNodes(ctx: PipelineContext): number {
  let total = 0;
  for (const status of ctx.nodeStatuses.values()) {
    if (status === 'done' || status === 'failed' || status === 'skipped') {
      total++;
    }
  }
  return total;
}
