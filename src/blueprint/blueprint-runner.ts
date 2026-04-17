import * as vscode from 'vscode';
import {
  isBlueprintInstanceContainerNode,
  isFunctionNode,
  type CanvasEdge,
  type CanvasFile,
  type CanvasNode,
} from '../core/canvas-model';
import { buildPipelinePlanForNodeSet } from '../pipeline/pipeline-engine';
import { runPipelinePlan } from '../pipeline/pipeline-runner';

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

export async function runBlueprintInstance(
  containerNodeId: string,
  executionCanvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
): Promise<void> {
  const containerNode = executionCanvas.nodes.find(node => node.id === containerNodeId);
  if (!isBlueprintInstanceContainerNode(containerNode)) {
    webview.postMessage({ type: 'error', message: '蓝图运行入口只能绑定到正式蓝图实例容器。' });
    return;
  }

  const instanceId = containerNode.meta?.blueprint_instance_id;
  if (!instanceId) {
    webview.postMessage({ type: 'error', message: '蓝图实例缺少 instance_id，无法运行。' });
    return;
  }

  const internalFunctionNodes = executionCanvas.nodes.filter(node =>
    node.meta?.blueprint_instance_id === instanceId && isFunctionNode(node)
  );
  if (internalFunctionNodes.length === 0) {
    webview.postMessage({ type: 'error', message: '当前蓝图实例内没有可执行的功能节点。' });
    return;
  }

  const requiredSlots = containerNode.meta?.blueprint_input_slot_defs?.filter(slot => slot.required) ?? [];
  const missingRequiredSlots = requiredSlots.filter(slot => countBlueprintSlotBindings(containerNode, slot.id, executionCanvas) === 0);
  if (missingRequiredSlots.length > 0) {
    webview.postMessage({
      type: 'error',
      message: `蓝图实例缺少必填输入：${missingRequiredSlots.map(slot => slot.title).join('、')}`,
    });
    return;
  }

  const internalFunctionNodeIds = new Set(internalFunctionNodes.map(node => node.id));
  const externalPipelineInputs = findExternalPipelineInputs(internalFunctionNodeIds, executionCanvas);
  if (externalPipelineInputs.length > 0) {
    const names = externalPipelineInputs
      .map(edge => executionCanvas.nodes.find(node => node.id === edge.target)?.title ?? edge.target)
      .filter((title, index, list) => list.indexOf(title) === index);
    webview.postMessage({
      type: 'error',
      message: `蓝图实例暂不支持从实例外部功能节点接入 Pipeline 依赖：${names.join('、')}`,
    });
    return;
  }

  const plan = buildPipelinePlanForNodeSet(
    internalFunctionNodes.map(node => node.id),
    executionCanvas.nodes,
    executionCanvas.edges,
    executionCanvas.nodeGroups,
  );
  if ('error' in plan) {
    webview.postMessage({ type: 'error', message: `蓝图执行计划构建失败: ${plan.error}` });
    return;
  }

  await runPipelinePlan(containerNode.id, plan, executionCanvas, canvasUri, webview);
}
