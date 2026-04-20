import * as vscode from 'vscode';
import {
  isBlueprintInstanceContainerNode,
  isFunctionNode,
  type CanvasEdge,
  type CanvasFile,
  type CanvasNode,
} from '../core/canvas-model';
import type { AIContent } from '../ai/provider';
import { buildPipelinePlanForNodeSet } from '../pipeline/pipeline-engine';
import { runPipelinePlan } from '../pipeline/pipeline-runner';
import { extractContent } from '../core/content-extractor';

function rejectBlueprintRun(
  containerNodeId: string,
  message: string,
  webview: vscode.Webview,
  options?: { runMode?: 'full' | 'resume'; reusedCachedNodeCount?: number },
): void {
  webview.postMessage({
    type: 'blueprintRunRejected',
    containerNodeId,
    message,
    runMode: options?.runMode,
    reusedCachedNodeCount: options?.reusedCachedNodeCount,
  });
}

function countBlueprintSlotBindings(
  containerNode: CanvasNode,
  slotId: string,
  canvas: CanvasFile,
): number {
  const instanceId = containerNode.meta?.blueprint_instance_id;
  if (!instanceId) { return 0; }

  const replacedBindings = canvas.nodes.filter(node =>
    node.meta?.blueprint_bound_instance_id === instanceId &&
    node.meta?.blueprint_bound_slot_id === slotId &&
    node.meta?.blueprint_bound_slot_kind !== 'output'
  ).length;

  const placeholderNodeIds = new Set(
    canvas.nodes
      .filter(node =>
        node.meta?.blueprint_instance_id === instanceId &&
        node.meta?.blueprint_placeholder_kind === 'input' &&
        node.meta?.blueprint_placeholder_slot_id === slotId
      )
      .map(node => node.id)
  );

  const placeholderBindings = canvas.edges.filter(edge =>
    edge.edge_type === 'data_flow' &&
    placeholderNodeIds.has(edge.target)
  ).length;

  const directContainerBindings = canvas.edges.filter(edge =>
    edge.edge_type === 'data_flow' &&
    edge.target === containerNode.id &&
    (edge.role ?? edge.targetHandle) === slotId
  ).length;

  return replacedBindings + placeholderBindings + directContainerBindings;
}

function findExternalPipelineInputs(
  functionNodeIds: Set<string>,
  canvas: CanvasFile,
): CanvasEdge[] {
  return canvas.edges.filter(edge =>
    edge.edge_type === 'pipeline_flow' &&
    functionNodeIds.has(edge.target) &&
    !functionNodeIds.has(edge.source)
  );
}

function collectReachableFunctionNodeIds(
  startNodeId: string,
  functionNodeIds: Set<string>,
  canvas: CanvasFile,
): Set<string> {
  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) { continue; }
    visited.add(current);
    for (const edge of canvas.edges) {
      if (edge.edge_type !== 'pipeline_flow' || edge.source !== current) { continue; }
      if (!functionNodeIds.has(edge.target) || visited.has(edge.target)) { continue; }
      queue.push(edge.target);
    }
  }
  return visited;
}

function extractTimestampKey(filePath?: string): string {
  if (!filePath) { return ''; }
  const basename = filePath.split('/').pop() ?? filePath;
  const match = basename.match(/_(\d{4}_\d{6})(?:_\d+)?\.[^.]+$/);
  return match?.[1] ?? '';
}

function findLatestFunctionOutputNode(
  functionNodeId: string,
  canvas: CanvasFile,
): CanvasNode | null {
  const targetIds = canvas.edges
    .filter(edge => edge.edge_type === 'ai_generated' && edge.source === functionNodeId)
    .map(edge => edge.target);
  const candidates = canvas.nodes.filter(node => targetIds.includes(node.id));
  if (candidates.length === 0) { return null; }
  return candidates.sort((a, b) => {
    const timeDiff = extractTimestampKey(b.file_path).localeCompare(extractTimestampKey(a.file_path));
    if (timeDiff !== 0) { return timeDiff; }
    return b.id.localeCompare(a.id);
  })[0] ?? null;
}

export async function runBlueprintInstance(
  containerNodeId: string,
  executionCanvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  options?: { resumeFromFailure?: boolean },
): Promise<void> {
  const containerNode = executionCanvas.nodes.find(node => node.id === containerNodeId);
  if (!isBlueprintInstanceContainerNode(containerNode)) {
    rejectBlueprintRun(containerNodeId, '蓝图运行入口只能绑定到正式蓝图实例容器。', webview, {
      runMode: options?.resumeFromFailure ? 'resume' : 'full',
    });
    return;
  }

  const instanceId = containerNode.meta?.blueprint_instance_id;
  if (!instanceId) {
    rejectBlueprintRun(containerNode.id, '蓝图实例缺少 instance_id，无法运行。', webview, {
      runMode: options?.resumeFromFailure ? 'resume' : 'full',
    });
    return;
  }

  const internalFunctionNodes = executionCanvas.nodes.filter(node =>
    node.meta?.blueprint_instance_id === instanceId && isFunctionNode(node)
  );
  if (internalFunctionNodes.length === 0) {
    rejectBlueprintRun(containerNode.id, '当前蓝图实例内没有可执行的功能节点。', webview, {
      runMode: options?.resumeFromFailure ? 'resume' : 'full',
    });
    return;
  }

  const requiredSlots = containerNode.meta?.blueprint_input_slot_defs?.filter(slot => slot.required) ?? [];
  const missingRequiredSlots = requiredSlots.filter(slot => countBlueprintSlotBindings(containerNode, slot.id, executionCanvas) === 0);
  if (missingRequiredSlots.length > 0) {
    rejectBlueprintRun(
      containerNode.id,
      `蓝图实例缺少必填输入：${missingRequiredSlots.map(slot => slot.title).join('、')}`,
      webview,
      { runMode: options?.resumeFromFailure ? 'resume' : 'full' },
    );
    return;
  }

  const internalFunctionNodeIds = new Set(internalFunctionNodes.map(node => node.id));
  const externalPipelineInputs = findExternalPipelineInputs(internalFunctionNodeIds, executionCanvas);
  if (externalPipelineInputs.length > 0) {
    const names = externalPipelineInputs
      .map(edge => executionCanvas.nodes.find(node => node.id === edge.target)?.title ?? edge.target)
      .filter((title, index, list) => list.indexOf(title) === index);
    rejectBlueprintRun(
      containerNode.id,
      `蓝图实例暂不支持从实例外部功能节点接入 Pipeline 依赖：${names.join('、')}`,
      webview,
      { runMode: options?.resumeFromFailure ? 'resume' : 'full' },
    );
    return;
  }

  const plan = buildPipelinePlanForNodeSet(
    internalFunctionNodes.map(node => node.id),
    executionCanvas.nodes,
    executionCanvas.edges,
    executionCanvas.nodeGroups,
  );
  if ('error' in plan) {
    rejectBlueprintRun(containerNode.id, `蓝图执行计划构建失败: ${plan.error}`, webview, {
      runMode: options?.resumeFromFailure ? 'resume' : 'full',
    });
    return;
  }

  if (!options?.resumeFromFailure) {
    await runPipelinePlan(containerNode.id, plan, executionCanvas, canvasUri, webview, { runMode: 'full' });
    return;
  }

  const failedNodeId = containerNode.meta?.blueprint_last_issue_node_id;
  if (!failedNodeId || !internalFunctionNodeIds.has(failedNodeId)) {
    rejectBlueprintRun(containerNode.id, '找不到上一次失败的实例内节点，暂时无法从失败点继续。', webview, {
      runMode: 'resume',
    });
    return;
  }
  if (containerNode.meta?.blueprint_last_run_status !== 'failed') {
    rejectBlueprintRun(containerNode.id, '只有最近一次运行失败时，才可以从失败点继续执行。', webview, {
      runMode: 'resume',
    });
    return;
  }

  const resumeNodeIds = collectReachableFunctionNodeIds(failedNodeId, internalFunctionNodeIds, executionCanvas);
  if (resumeNodeIds.size === 0) {
    rejectBlueprintRun(containerNode.id, '未找到可继续执行的失败节点链路。', webview, {
      runMode: 'resume',
    });
    return;
  }

  const initialStatuses = new Map<string, 'waiting' | 'running' | 'done' | 'failed' | 'skipped'>();
  const initialOutputContents = new Map<string, AIContent>();
  const initialOutputNodes = new Map<string, CanvasNode>();
  let reusedCachedNodeCount = 0;

  for (const node of internalFunctionNodes) {
    if (resumeNodeIds.has(node.id)) {
      initialStatuses.set(node.id, 'waiting');
      continue;
    }
    const outputNode = findLatestFunctionOutputNode(node.id, executionCanvas);
    if (!outputNode) {
      initialStatuses.set(node.id, 'waiting');
      continue;
    }
    try {
      const content = await extractContent(outputNode, canvasUri);
      initialStatuses.set(node.id, 'done');
      initialOutputContents.set(node.id, content);
      initialOutputNodes.set(node.id, outputNode);
      reusedCachedNodeCount++;
    } catch {
      initialStatuses.set(node.id, 'waiting');
    }
  }

  await runPipelinePlan(
    containerNode.id,
    plan,
    executionCanvas,
    canvasUri,
    webview,
    {
      initialNodeStatuses: initialStatuses,
      initialOutputContents,
      initialOutputNodes,
      runMode: 'resume',
      reusedCachedNodeCount,
    },
  );
}
