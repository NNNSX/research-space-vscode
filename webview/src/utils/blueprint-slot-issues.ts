import type { BlueprintSlotDef } from '../../../../src/blueprint/blueprint-types';
import type { CanvasNode } from '../../../../src/core/canvas-model';
import type { FlowEdge, PipelineState } from '../stores/canvas-store';

export type BlueprintOutputSlotIssue = {
  kind: 'upstream_failed' | 'waiting_output';
  message: string;
  relatedNodeId?: string;
  relatedNodeTitle?: string;
  relatedNodeMessage?: string;
  relatedIssueKind?: string;
};

interface IssueCardLike {
  nodeId?: string;
  title: string;
  kind: string;
  message: string;
}

export function buildBlueprintOutputSlotIssueMap(params: {
  canvasNodes: CanvasNode[];
  edges: FlowEdge[];
  instanceId?: string;
  outputSlots: BlueprintSlotDef[];
  outputBindings: Map<string, number>;
  issueCards: IssueCardLike[];
  instanceRunning: boolean;
  nodeStatuses?: PipelineState['nodeStatuses'];
}): Map<string, BlueprintOutputSlotIssue> {
  const {
    canvasNodes,
    edges,
    instanceId,
    outputSlots,
    outputBindings,
    issueCards,
    instanceRunning,
    nodeStatuses,
  } = params;

  const result = new Map<string, BlueprintOutputSlotIssue>();
  if (!instanceId || outputSlots.length === 0) { return result; }

  const reverseAdjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const supported = edge.data?.edge_type === 'data_flow' || edge.data?.edge_type === 'pipeline_flow' || edge.data?.edge_type === 'ai_generated';
    if (!supported) { continue; }
    if (!reverseAdjacency.has(edge.target)) {
      reverseAdjacency.set(edge.target, []);
    }
    reverseAdjacency.get(edge.target)!.push(edge.source);
  }

  const slotNodeIds = new Map<string, string[]>();
  for (const slot of outputSlots) {
    const ids: string[] = [];
    for (const node of canvasNodes) {
      const slotId = node.meta?.blueprint_placeholder_slot_id ?? node.meta?.blueprint_bound_slot_id;
      const slotKind = node.meta?.blueprint_placeholder_kind ?? node.meta?.blueprint_bound_slot_kind;
      const sameInstance =
        node.meta?.blueprint_instance_id === instanceId ||
        node.meta?.blueprint_bound_instance_id === instanceId;
      if (sameInstance && slotKind === 'output' && slotId === slot.id) {
        ids.push(node.id);
      }
    }
    slotNodeIds.set(slot.id, ids);
  }

  const issueCandidateMap = new Map(
    issueCards
      .filter(card => !!card.nodeId)
      .map(card => [card.nodeId!, card]),
  );

  const findClosestReachableNode = (
    targetIds: string[],
    matcher: (nodeId: string) => boolean,
  ): { nodeId: string; distance: number } | null => {
    const queue: Array<{ nodeId: string; distance: number }> = targetIds.map(nodeId => ({ nodeId, distance: 0 }));
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.nodeId)) { continue; }
      visited.add(current.nodeId);
      if (matcher(current.nodeId)) {
        return current;
      }
      for (const prev of reverseAdjacency.get(current.nodeId) ?? []) {
        if (!visited.has(prev)) {
          queue.push({ nodeId: prev, distance: current.distance + 1 });
        }
      }
    }
    return null;
  };

  for (const slot of outputSlots) {
    const targetIds = slotNodeIds.get(slot.id) ?? [];
    if (targetIds.length === 0 || (outputBindings.get(slot.id) ?? 0) > 0) { continue; }

    const closestIssue = issueCandidateMap.size > 0
      ? findClosestReachableNode(targetIds, nodeId => issueCandidateMap.has(nodeId))
      : null;
    if (closestIssue) {
      const card = issueCandidateMap.get(closestIssue.nodeId);
      const nodeTitle = card?.title ?? closestIssue.nodeId;
      const summary = card?.message?.trim();
      result.set(slot.id, {
        kind: 'upstream_failed',
        relatedNodeId: closestIssue.nodeId,
        relatedNodeTitle: nodeTitle,
        relatedNodeMessage: summary,
        relatedIssueKind: card?.kind,
        message: `该输出槽位受上游节点「${nodeTitle}」影响，本轮未能正常产出。`,
      });
      continue;
    }

    if (!instanceRunning) { continue; }

    const closestRunning = findClosestReachableNode(
      targetIds,
      nodeId => nodeStatuses?.[nodeId] === 'running',
    );
    if (closestRunning) {
      const runningNode = canvasNodes.find(node => node.id === closestRunning.nodeId);
      const runningNodeTitle = runningNode?.title ?? closestRunning.nodeId;
      result.set(slot.id, {
        kind: 'waiting_output',
        relatedNodeId: closestRunning.nodeId,
        relatedNodeTitle: runningNodeTitle,
        message: `该输出槽位正在等待上游节点「${runningNodeTitle}」完成产出。`,
      });
      continue;
    }

    const closestPending = findClosestReachableNode(
      targetIds,
      nodeId => {
        const status = nodeStatuses?.[nodeId];
        return status === 'waiting' || status === 'done';
      },
    );
    if (closestPending) {
      const pendingNode = canvasNodes.find(node => node.id === closestPending.nodeId);
      const pendingNodeTitle = pendingNode?.title ?? closestPending.nodeId;
      result.set(slot.id, {
        kind: 'waiting_output',
        relatedNodeId: closestPending.nodeId,
        relatedNodeTitle: pendingNodeTitle,
        message: `该输出槽位仍在等待上游链路继续推进，最近相关节点是「${pendingNodeTitle}」。`,
      });
      continue;
    }

    result.set(slot.id, {
      kind: 'waiting_output',
      message: '该输出槽位正在等待实例内部上游节点继续产出。',
    });
  }

  return result;
}
