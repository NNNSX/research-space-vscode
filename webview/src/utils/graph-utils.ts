import type { CanvasEdge } from '../../../src/core/canvas-model';

// ── Graph utilities for Pipeline system (v2.0) ─────────────────────────────

/**
 * Detect if adding edge (source → target) would create a cycle.
 * Uses DFS from `target` following existing directed edges.
 * If we can reach `source` from `target`, then adding source→target creates a cycle.
 */
export function wouldCreateCycle(
  edges: CanvasEdge[],
  sourceId: string,
  targetId: string
): boolean {
  // Self-loop
  if (sourceId === targetId) { return true; }

  // Build adjacency list from existing edges
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adj.has(edge.source)) { adj.set(edge.source, []); }
    adj.get(edge.source)!.push(edge.target);
  }

  // DFS from target: can we reach source?
  const visited = new Set<string>();
  const stack = [targetId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceId) { return true; }
    if (visited.has(current)) { continue; }
    visited.add(current);
    const neighbors = adj.get(current) ?? [];
    for (const n of neighbors) {
      stack.push(n);
    }
  }

  return false;
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns sorted node IDs, or null if a cycle is detected.
 */
export function topologicalSort(
  nodeIds: string[],
  edges: CanvasEdge[]
): string[] | null {
  const nodeSet = new Set(nodeIds);

  // Build in-degree map and adjacency list (only for nodes in nodeIds)
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) { continue; }
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Start with nodes that have 0 in-degree
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) { queue.push(id); }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of (adj.get(current) ?? [])) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) { queue.push(neighbor); }
    }
  }

  // If not all nodes are in sorted result, there's a cycle
  return sorted.length === nodeIds.length ? sorted : null;
}

/**
 * Build execution layers using Kahn's algorithm.
 * Returns array of layers — each layer contains node IDs that can execute in parallel.
 */
export function buildExecutionLayers(
  nodeIds: string[],
  edges: CanvasEdge[]
): string[][] | null {
  const nodeSet = new Set(nodeIds);

  // Build in-degree map and adjacency list
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) { continue; }
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const layers: string[][] = [];
  let remaining = nodeIds.length;

  // Collect initial zero in-degree nodes
  let currentLayer: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) { currentLayer.push(id); }
  }

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
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

  // If not all nodes processed, there's a cycle
  return remaining === 0 ? layers : null;
}
