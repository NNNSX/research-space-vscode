import type { CanvasNode, CanvasEdge } from '../core/canvas-model';

// ── Pipeline Engine (v2.0) ─────────────────────────────────────────────────
// Responsible for analyzing a pipeline's topology and producing an execution plan.

export interface PipelineLayer {
  nodeIds: string[];  // Nodes in this layer (can run in parallel)
}

export interface PipelinePlan {
  layers: PipelineLayer[];
  pipelineNodeIds: string[];   // All function node IDs in execution order
  pipelineEdges: CanvasEdge[]; // Edges within the pipeline subgraph
}

/**
 * Build a pipeline execution plan starting from the trigger node.
 *
 * 1. BFS downstream from triggerNodeId following pipeline_flow edges to function nodes
 * 2. Also include data_flow edges from function nodes to function nodes
 * 3. Topologically sort into layers for parallel execution
 */
export function buildPipelinePlan(
  triggerNodeId: string,
  allNodes: CanvasNode[],
  allEdges: CanvasEdge[]
): PipelinePlan | { error: string } {
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  // Step 1: BFS downstream from trigger, following pipeline_flow edges to function nodes
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

  const pipelineNodeIds = Array.from(downstream);

  // Step 2: Collect all edges within the pipeline subgraph
  const pipelineEdges = allEdges.filter(
    e => downstream.has(e.source) && downstream.has(e.target) &&
         (e.edge_type === 'pipeline_flow' || e.edge_type === 'data_flow')
  );

  // Step 3: Kahn's algorithm — topological sort into layers
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of pipelineNodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of pipelineEdges) {
    if (!downstream.has(edge.source) || !downstream.has(edge.target)) { continue; }
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
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

  // Flatten layers into ordered node IDs
  const orderedIds = layers.flatMap(l => l.nodeIds);

  return {
    layers,
    pipelineNodeIds: orderedIds,
    pipelineEdges,
  };
}
