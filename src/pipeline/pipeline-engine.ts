import { isFunctionNode, type CanvasNode, type CanvasEdge, type NodeGroup } from '../core/canvas-model';
import { buildFunctionExecutionPlan, type FunctionExecutionPlan } from '../core/execution-plan';

// ── Pipeline Engine (v2.0) ─────────────────────────────────────────────────
// Responsible for analyzing a pipeline's topology and producing an execution plan.

export interface PipelineLayer {
  nodeIds: string[];  // Nodes in this layer (can run in parallel)
}

export interface PipelinePlan {
  layers: PipelineLayer[];
  pipelineNodeIds: string[];   // All function node IDs in execution order
  pipelineEdges: CanvasEdge[]; // pipeline_flow edges within the pipeline subgraph
  nodeExecutionPlans: Record<string, FunctionExecutionPlan>;
  dependencyNodeIdsByNode: Record<string, string[]>;
}

export function buildPipelinePlanForNodeSet(
  pipelineNodeIdsInput: string[],
  allNodes: CanvasNode[],
  allEdges: CanvasEdge[],
  allNodeGroups?: NodeGroup[],
): PipelinePlan | { error: string } {
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const pipelineNodeIds = Array.from(new Set(pipelineNodeIdsInput));
  if (pipelineNodeIds.length === 0) {
    return { error: '没有可执行的管道节点' };
  }

  for (const nodeId of pipelineNodeIds) {
    const node = nodeMap.get(nodeId);
    if (!node) {
      return { error: `找不到节点：${nodeId}` };
    }
    if (!isFunctionNode(node)) {
      return { error: `节点「${node.title}」不是功能节点，无法进入执行计划` };
    }
  }

  const nodeExecutionPlans: Record<string, FunctionExecutionPlan> = {};
  const dependencyNodeIdsByNode: Record<string, string[]> = {};
  const pipelineNodeSet = new Set(pipelineNodeIds);

  for (const nodeId of pipelineNodeIds) {
    const nodePlan = buildFunctionExecutionPlan(nodeId, {
      nodes: allNodes,
      edges: allEdges,
      nodeGroups: allNodeGroups,
    }, ['data_flow', 'pipeline_flow']);
    if ('error' in nodePlan) {
      return { error: `节点「${nodeMap.get(nodeId)?.title ?? nodeId}」执行计划构建失败：${nodePlan.error}` };
    }
    nodeExecutionPlans[nodeId] = nodePlan;
    dependencyNodeIdsByNode[nodeId] = nodePlan.directPipelineSourceIds.filter(sourceId => pipelineNodeSet.has(sourceId));
  }

  const pipelineEdges = allEdges.filter(
    edge =>
      pipelineNodeSet.has(edge.source) &&
      pipelineNodeSet.has(edge.target) &&
      edge.edge_type === 'pipeline_flow'
  );

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of pipelineNodeIds) {
    inDegree.set(id, dependencyNodeIdsByNode[id]?.length ?? 0);
    adj.set(id, []);
  }

  for (const [targetId, sourceIds] of Object.entries(dependencyNodeIdsByNode)) {
    for (const sourceId of sourceIds) {
      adj.get(sourceId)?.push(targetId);
    }
  }

  const layers: PipelineLayer[] = [];
  let remaining = pipelineNodeIds.length;
  let currentLayer: string[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) { currentLayer.push(id); }
  }

  while (currentLayer.length > 0) {
    layers.push({ nodeIds: currentLayer });
    remaining -= currentLayer.length;

    const nextLayer: string[] = [];
    for (const current of currentLayer) {
      for (const neighbor of (adj.get(current) ?? [])) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) { nextLayer.push(neighbor); }
      }
    }
    currentLayer = nextLayer;
  }

  if (remaining > 0) {
    return { error: '管道中存在循环依赖' };
  }

  const orderedIds = layers.flatMap(layer => layer.nodeIds);
  return {
    layers,
    pipelineNodeIds: orderedIds,
    pipelineEdges,
    nodeExecutionPlans,
    dependencyNodeIdsByNode,
  };
}

/**
 * Build a pipeline execution plan starting from the trigger node.
 *
 * 1. BFS downstream from triggerNodeId following pipeline_flow edges to function nodes
 * 2. For every pipeline function node, build the same function execution plan used
 *    by single-node execution (input expansion / hub semantics / edge typing)
 * 3. Topologically sort by pipeline_flow dependencies into layers for parallel execution
 */
export function buildPipelinePlan(
  triggerNodeId: string,
  allNodes: CanvasNode[],
  allEdges: CanvasEdge[],
  allNodeGroups?: NodeGroup[],
): PipelinePlan | { error: string } {
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const triggerNode = nodeMap.get(triggerNodeId);
  if (!triggerNode) {
    return { error: '找不到触发节点' };
  }
  if (!isFunctionNode(triggerNode)) {
    return { error: 'Pipeline 只能从功能节点启动' };
  }

  const downstream = new Set<string>();
  const queue = [triggerNodeId];
  downstream.add(triggerNodeId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of allEdges) {
      if (edge.source !== current) { continue; }
      if (edge.edge_type !== 'pipeline_flow') { continue; }
      const targetNode = nodeMap.get(edge.target);
      if (!targetNode || targetNode.node_type !== 'function') { continue; }
      if (downstream.has(edge.target)) { continue; }
      downstream.add(edge.target);
      queue.push(edge.target);
    }
  }

  return buildPipelinePlanForNodeSet(Array.from(downstream), allNodes, allEdges, allNodeGroups);
}
