import type { CanvasFile, CanvasNode, EdgeType } from '../../../../src/core/canvas-model';

export type CanvasHealthSeverity = 'error' | 'warning' | 'info';

export interface CanvasHealthIssue {
  id: string;
  severity: CanvasHealthSeverity;
  title: string;
  detail: string;
  targetId?: string;
  repair?: {
    kind: string;
    label: string;
    description: string;
    risk: 'low' | 'medium' | 'high';
  };
}

export interface CanvasHealthReport {
  checkedAt: number;
  summary: Record<CanvasHealthSeverity, number>;
  stats: {
    nodeCount: number;
    edgeCount: number;
    boardCount: number;
    nodeGroupCount: number;
    stagingNodeCount: number;
    blueprintNodeCount: number;
  };
  issues: CanvasHealthIssue[];
  repairPlan: CanvasHealthRepairPlanItem[];
}

export interface CanvasHealthRepairPlanItem {
  issueId: string;
  title: string;
  action: string;
  targetId?: string;
  risk: 'low' | 'medium' | 'high';
}

export interface CanvasHealthRepairResult {
  canvas: CanvasFile;
  changed: boolean;
  appliedCount: number;
  actions: string[];
}

function issue(
  issues: CanvasHealthIssue[],
  severity: CanvasHealthSeverity,
  id: string,
  title: string,
  detail: string,
  targetId?: string,
  repair?: CanvasHealthIssue['repair'],
): void {
  issues.push({ id, severity, title, detail, targetId, repair });
}

function isFiniteRect(rect: { x: number; y: number; width: number; height: number } | undefined | null): boolean {
  return !!rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0;
}

function isFiniteNodeGeometry(node: CanvasNode): boolean {
  return Number.isFinite(node.position?.x) &&
    Number.isFinite(node.position?.y) &&
    Number.isFinite(node.size?.width) &&
    Number.isFinite(node.size?.height) &&
    node.size.width > 0 &&
    node.size.height > 0;
}

const VALID_EDGE_TYPES = new Set<EdgeType>(['data_flow', 'pipeline_flow', 'ai_generated', 'reference', 'hub_member']);

export function buildCanvasHealthReport(canvas: CanvasFile | null | undefined): CanvasHealthReport {
  const issues: CanvasHealthIssue[] = [];
  const nodes = canvas?.nodes ?? [];
  const edges = canvas?.edges ?? [];
  const boards = canvas?.boards ?? [];
  const nodeGroups = canvas?.nodeGroups ?? [];
  const stagingNodes = canvas?.stagingNodes ?? [];

  if (!canvas) {
    issue(issues, 'error', 'canvas-missing', '画布数据未加载', '当前没有可检查的画布数据。');
  }

  const nodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node.id) {
      issue(issues, 'error', 'node-missing-id', '节点缺少 ID', `节点“${node.title || '未命名'}”缺少 id。`);
      continue;
    }
    if (nodeIds.has(node.id)) {
      duplicateNodeIds.add(node.id);
    }
    nodeIds.add(node.id);
  }
  for (const id of duplicateNodeIds) {
    issue(issues, 'error', `node-duplicate-${id}`, '存在重复节点 ID', `节点 ID “${id}” 出现多次，会导致连线、选择和保存恢复异常。`, id);
  }

  for (const node of nodes) {
    if (!isFiniteNodeGeometry(node)) {
      issue(issues, 'error', `node-geometry-${node.id}`, '节点几何数据异常', `节点“${node.title || node.id}”的位置或尺寸不是有效正数。`, node.id);
    }
    if (node.node_type !== 'function' && node.node_type !== 'group_hub' && node.node_type !== 'blueprint' && !node.file_path && node.node_type !== 'task' && node.node_type !== 'experiment_log') {
      issue(issues, 'info', `node-fileless-${node.id}`, '节点没有文件路径', `节点“${node.title || node.id}”当前没有 file_path；如果它是草稿或临时节点可忽略。`, node.id);
    }
    const instanceId = node.meta?.blueprint_instance_id;
    const boundInstanceId = node.meta?.blueprint_bound_instance_id;
    if (node.meta?.blueprint_placeholder_kind && !instanceId && !boundInstanceId) {
      issue(issues, 'warning', `blueprint-placeholder-orphan-${node.id}`, '蓝图占位节点缺少实例绑定', `占位节点“${node.title || node.id}”缺少 blueprint_instance_id / blueprint_bound_instance_id。`, node.id);
    }
    if (node.node_type === 'blueprint' && instanceId && !node.meta?.blueprint_file_path) {
      issue(issues, 'warning', `blueprint-missing-file-${node.id}`, '蓝图实例缺少定义文件路径', `蓝图实例“${node.title || node.id}”缺少 blueprint_file_path，重开后可能无法恢复定义。`, node.id);
    }
  }

  const edgeIds = new Set<string>();
  const duplicateEdgeIds = new Set<string>();
  for (const edge of edges) {
    if (!edge.id) {
      issue(issues, 'error', 'edge-missing-id', '连线缺少 ID', `存在一条 ${edge.source || '?'} → ${edge.target || '?'} 的连线缺少 id。`);
      continue;
    }
    if (edgeIds.has(edge.id)) {
      duplicateEdgeIds.add(edge.id);
    }
    edgeIds.add(edge.id);
  }
  for (const id of duplicateEdgeIds) {
    issue(issues, 'error', `edge-duplicate-${id}`, '存在重复连线 ID', `连线 ID “${id}” 出现多次。`, id);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      issue(issues, 'error', `edge-missing-source-${edge.id}`, '连线源节点缺失', `连线“${edge.id}”的源节点“${edge.source}”不存在。`, edge.id, {
        kind: 'remove-edge',
        label: '移除悬挂连线',
        description: `删除源节点不存在的连线“${edge.id}”。`,
        risk: 'low',
      });
    }
    if (!nodeIds.has(edge.target)) {
      issue(issues, 'error', `edge-missing-target-${edge.id}`, '连线目标节点缺失', `连线“${edge.id}”的目标节点“${edge.target}”不存在。`, edge.id, {
        kind: 'remove-edge',
        label: '移除悬挂连线',
        description: `删除目标节点不存在的连线“${edge.id}”。`,
        risk: 'low',
      });
    }
    if (!VALID_EDGE_TYPES.has(edge.edge_type)) {
      issue(issues, 'warning', `edge-type-${edge.id}`, '连线类型异常', `连线“${edge.id}”的类型为“${edge.edge_type}”，不在当前已知类型中。`, edge.id);
    }
    if (edge.edge_type === 'hub_member') {
      const source = nodes.find(n => n.id === edge.source);
      const target = nodes.find(n => n.id === edge.target);
      if (source?.node_type !== 'group_hub' && target?.node_type !== 'group_hub') {
        issue(issues, 'warning', `hub-edge-no-hub-${edge.id}`, '节点组成员连线未连接 hub', `hub_member 连线“${edge.id}”没有连接 group_hub 节点。`, edge.id);
      }
    }
  }

  const boardIds = new Set<string>();
  for (const board of boards) {
    if (boardIds.has(board.id)) {
      issue(issues, 'error', `board-duplicate-${board.id}`, '存在重复画板 ID', `画板 ID “${board.id}” 出现多次。`, board.id);
    }
    boardIds.add(board.id);
    if (!isFiniteRect(board.bounds)) {
      issue(issues, 'error', `board-bounds-${board.id}`, '画板边界异常', `画板“${board.name || board.id}”的 bounds 不是有效正数。`, board.id);
    }
  }

  const groupIds = new Set<string>();
  for (const group of nodeGroups) {
    if (groupIds.has(group.id)) {
      issue(issues, 'error', `group-duplicate-${group.id}`, '存在重复节点组 ID', `节点组 ID “${group.id}” 出现多次。`, group.id);
    }
    groupIds.add(group.id);
    if (!group.hubNodeId || !nodeIds.has(group.hubNodeId)) {
      issue(issues, 'error', `group-missing-hub-${group.id}`, '节点组 hub 缺失', `节点组“${group.name || group.id}”引用的 hubNodeId “${group.hubNodeId || '空'}”不存在。`, group.id, {
        kind: 'rebuild-group-hub',
        label: '重建节点组 hub',
        description: `为节点组“${group.name || group.id}”重建 group_hub 节点，并重新绑定成员关系。`,
        risk: 'medium',
      });
    } else {
      const hub = nodes.find(n => n.id === group.hubNodeId);
      if (hub?.node_type !== 'group_hub') {
        issue(issues, 'warning', `group-hub-type-${group.id}`, '节点组 hub 类型异常', `节点组“${group.name || group.id}”的 hubNodeId 指向的不是 group_hub 节点。`, group.id);
      }
    }
    if (!Array.isArray(group.nodeIds) || group.nodeIds.length === 0) {
      issue(issues, 'info', `group-empty-${group.id}`, '节点组为空', `节点组“${group.name || group.id}”没有成员节点。`, group.id);
    }
    const seenMembers = new Set<string>();
    for (const memberId of group.nodeIds ?? []) {
      if (seenMembers.has(memberId)) {
        issue(issues, 'warning', `group-duplicate-member-${group.id}-${memberId}`, '节点组成员重复', `节点组“${group.name || group.id}”重复引用成员“${memberId}”。`, group.id, {
          kind: 'dedupe-group-members',
          label: '去重节点组成员',
          description: `保留节点组“${group.name || group.id}”中成员“${memberId}”的第一处引用，移除重复引用。`,
          risk: 'low',
        });
      }
      seenMembers.add(memberId);
      if (!nodeIds.has(memberId)) {
        issue(issues, 'error', `group-missing-member-${group.id}-${memberId}`, '节点组成员缺失', `节点组“${group.name || group.id}”引用的成员节点“${memberId}”不存在。`, group.id, {
          kind: 'remove-missing-group-member',
          label: '移除缺失成员引用',
          description: `从节点组“${group.name || group.id}”中移除不存在的成员引用“${memberId}”。`,
          risk: 'low',
        });
      }
    }
    if (!isFiniteRect(group.bounds)) {
      issue(issues, 'error', `group-bounds-${group.id}`, '节点组边界异常', `节点组“${group.name || group.id}”的 bounds 不是有效正数。`, group.id);
    }
  }

  const hubIdsInGroups = new Set(nodeGroups.map(group => group.hubNodeId).filter(Boolean));
  for (const node of nodes) {
    if (node.node_type === 'group_hub' && !hubIdsInGroups.has(node.id)) {
      issue(issues, 'warning', `orphan-hub-${node.id}`, '孤立节点组 hub', `group_hub 节点“${node.title || node.id}”没有被任何 nodeGroups 条目引用。`, node.id, {
        kind: 'remove-orphan-hub',
        label: '移除孤立 hub',
        description: `删除未被任何节点组引用的 group_hub 节点“${node.title || node.id}”及其相关 hub_member 连线。`,
        risk: 'medium',
      });
    }
  }

  const stagingIds = new Set<string>();
  for (const node of stagingNodes) {
    if (stagingIds.has(node.id) || nodeIds.has(node.id)) {
      issue(issues, 'warning', `staging-duplicate-${node.id}`, '暂存节点 ID 冲突', `暂存节点“${node.title || node.id}”的 ID 与画布节点或其他暂存节点重复。`, node.id);
    }
    stagingIds.add(node.id);
  }

  const summary: Record<CanvasHealthSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const entry of issues) {
    summary[entry.severity] += 1;
  }
  const repairPlan = issues
    .filter(entry => !!entry.repair)
    .map(entry => ({
      issueId: entry.id,
      title: entry.repair!.label,
      action: entry.repair!.description,
      targetId: entry.targetId,
      risk: entry.repair!.risk,
    }));

  return {
    checkedAt: Date.now(),
    summary,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      boardCount: boards.length,
      nodeGroupCount: nodeGroups.length,
      stagingNodeCount: stagingNodes.length,
      blueprintNodeCount: nodes.filter(node => node.node_type === 'blueprint' || !!node.meta?.blueprint_instance_id).length,
    },
    issues,
    repairPlan,
  };
}

export function applyLowRiskCanvasHealthRepairs(canvas: CanvasFile): CanvasHealthRepairResult {
  const nodeIds = new Set(canvas.nodes.map(node => node.id));
  const actions: string[] = [];

  const nextEdges = canvas.edges.filter(edge => {
    const keep = nodeIds.has(edge.source) && nodeIds.has(edge.target);
    if (!keep) {
      actions.push(`移除悬挂连线“${edge.id}”。`);
    }
    return keep;
  });

  const nextNodeGroups = (canvas.nodeGroups ?? []).map(group => {
    const seen = new Set<string>();
    const nextNodeIds: string[] = [];
    for (const nodeId of group.nodeIds ?? []) {
      if (!nodeIds.has(nodeId)) {
        actions.push(`从节点组“${group.name || group.id}”移除缺失成员引用“${nodeId}”。`);
        continue;
      }
      if (seen.has(nodeId)) {
        actions.push(`从节点组“${group.name || group.id}”移除重复成员引用“${nodeId}”。`);
        continue;
      }
      seen.add(nodeId);
      nextNodeIds.push(nodeId);
    }
    return nextNodeIds.length === (group.nodeIds ?? []).length
      ? group
      : { ...group, nodeIds: nextNodeIds };
  });

  const changed = nextEdges.length !== canvas.edges.length ||
    nextNodeGroups.some((group, index) => group !== (canvas.nodeGroups ?? [])[index]);

  if (!changed) {
    return { canvas, changed: false, appliedCount: 0, actions: [] };
  }

  return {
    canvas: {
      ...canvas,
      edges: nextEdges,
      nodeGroups: nextNodeGroups,
      metadata: {
        ...canvas.metadata,
        updated_at: new Date().toISOString(),
      },
    },
    changed: true,
    appliedCount: actions.length,
    actions,
  };
}
