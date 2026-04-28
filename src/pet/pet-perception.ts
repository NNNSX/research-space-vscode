import type { CanvasEdge, CanvasFile, CanvasNode, DataNodeType } from '../core/canvas-model';

export type PetScene = 'paper' | 'proposal' | 'patent' | 'mixed' | 'unknown';
export type PetPhase = 'collecting' | 'structuring' | 'processing' | 'organizing' | 'delivering' | 'unknown';

export interface PetFocusSnapshot {
  nodeId: string;
  title: string;
  nodeType: CanvasNode['node_type'];
}

export interface PetBoardSnapshot {
  id: string;
  name: string;
  nodeCount: number;
}

export interface PetMindMapSnapshot {
  id: string;
  title: string;
  firstLevelCount: number;
  totalItems: number;
}

export interface PetFrictionSignal {
  type: 'many_isolated_nodes' | 'ai_errors' | 'many_outputs_without_structure';
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface PetPerceptionSnapshot {
  canvasTitle: string;
  scene: PetScene;
  phase: PetPhase;
  nodeStats: Record<string, number>;
  edgeCount: number;
  isolatedNodeCount: number;
  boards: PetBoardSnapshot[];
  nodeGroupCount: number;
  blueprintCount: number;
  mindmaps: PetMindMapSnapshot[];
  functionNodeNames: string[];
  recentOutputPreviews: string[];
  frictionSignals: PetFrictionSignal[];
}

const SCENE_KEYWORDS: Record<Exclude<PetScene, 'mixed' | 'unknown'>, string[]> = {
  paper: ['论文', '文献', 'paper', 'article', 'manuscript', 'literature', 'review'],
  proposal: ['项目书', '基金', '申报', 'proposal', 'grant', '立项', '课题'],
  patent: ['专利', '权利要求', '说明书', 'patent', 'claim', 'invention'],
};

function textOfCanvas(canvas: CanvasFile): string {
  return [
    canvas.metadata?.title ?? '',
    ...canvas.nodes.flatMap(node => [
      node.title,
      node.file_path ?? '',
      node.meta?.content_preview?.slice(0, 240) ?? '',
      node.meta?.mindmap_summary?.rootTitle ?? '',
      node.meta?.mindmap_summary?.firstLevelTitles?.join(' ') ?? '',
    ]),
    ...(canvas.boards ?? []).map(board => board.name),
    ...(canvas.nodeGroups ?? []).map(group => group.name),
  ].join(' ').toLowerCase();
}

export function inferPetScene(canvas: CanvasFile): PetScene {
  const text = textOfCanvas(canvas);
  const hits = Object.entries(SCENE_KEYWORDS)
    .map(([scene, keywords]) => ({ scene: scene as Exclude<PetScene, 'mixed' | 'unknown'>, count: keywords.filter(keyword => text.includes(keyword.toLowerCase())).length }))
    .filter(item => item.count > 0);
  if (hits.length === 0) { return 'unknown'; }
  if (hits.length > 1) { return 'mixed'; }
  return hits[0].scene;
}

function nodeHasDataContent(node: CanvasNode): boolean {
  return node.node_type !== 'function' && node.node_type !== 'group_hub' && node.node_type !== 'blueprint';
}

function isStructureNode(node: CanvasNode): boolean {
  return node.node_type === 'mindmap' || node.node_type === 'note' || node.node_type === 'task' || node.node_type === 'experiment_log';
}

export function inferPetPhase(canvas: CanvasFile, nodeStats: Record<string, number>): PetPhase {
  const nodeCount = canvas.nodes.length;
  if (nodeCount === 0) { return 'unknown'; }
  const functionCount = nodeStats.function ?? 0;
  const outputCount = nodeStats.ai_output ?? 0;
  const structureCount = canvas.nodes.filter(isStructureNode).length + (canvas.boards?.length ?? 0) + (canvas.nodeGroups?.length ?? 0);
  const dataCount = canvas.nodes.filter(nodeHasDataContent).length;
  const runningFunctionCount = canvas.nodes.filter(node => node.node_type === 'function' && node.meta?.fn_status === 'running').length;

  if (runningFunctionCount > 0) { return 'processing'; }
  if (outputCount > 0 && structureCount > 0) { return 'organizing'; }
  if (functionCount > 0 || outputCount > 0) { return 'processing'; }
  if (structureCount > 0) { return 'structuring'; }
  if (dataCount >= 2) { return 'collecting'; }
  return 'unknown';
}

function buildConnectedNodeSet(edges: CanvasEdge[]): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }
  return connected;
}

function countNodesInBoard(canvas: CanvasFile, board: NonNullable<CanvasFile['boards']>[number]): number {
  const { x, y, width, height } = board.bounds;
  return canvas.nodes.filter(node => {
    const cx = node.position.x + node.size.width / 2;
    const cy = node.position.y + node.size.height / 2;
    return cx >= x && cx <= x + width && cy >= y && cy <= y + height;
  }).length;
}

function buildFrictionSignals(canvas: CanvasFile, isolatedNodeCount: number): PetFrictionSignal[] {
  const signals: PetFrictionSignal[] = [];
  const aiErrorCount = canvas.nodes.filter(node => node.node_type === 'function' && node.meta?.fn_status === 'error').length;
  const outputCount = canvas.nodes.filter(node => node.node_type === 'ai_output').length;
  const structureCount = canvas.nodes.filter(isStructureNode).length + (canvas.boards?.length ?? 0) + (canvas.nodeGroups?.length ?? 0);

  if (isolatedNodeCount >= 5) {
    signals.push({
      type: 'many_isolated_nodes',
      severity: isolatedNodeCount >= 10 ? 'high' : 'medium',
      message: `画布上有 ${isolatedNodeCount} 个未连接节点，可能需要整理结构。`,
    });
  }
  if (aiErrorCount > 0) {
    signals.push({
      type: 'ai_errors',
      severity: aiErrorCount >= 3 ? 'high' : 'medium',
      message: `有 ${aiErrorCount} 个 AI 工具节点处于错误状态。`,
    });
  }
  if (outputCount >= 4 && structureCount === 0) {
    signals.push({
      type: 'many_outputs_without_structure',
      severity: 'medium',
      message: `已有 ${outputCount} 个 AI 输出，但还缺少导图、笔记、画板或节点组来收口。`,
    });
  }
  return signals;
}

export function extractPetPerception(canvas: CanvasFile): PetPerceptionSnapshot {
  const nodeStats: Record<string, number> = {};
  const functionNodeNames: string[] = [];
  const aiOutputs: CanvasNode[] = [];
  for (const node of canvas.nodes) {
    nodeStats[node.node_type] = (nodeStats[node.node_type] ?? 0) + 1;
    if (node.node_type === 'function' && node.title) {
      functionNodeNames.push(node.title);
    }
    if (node.node_type === 'ai_output') {
      aiOutputs.push(node);
    }
  }

  const connected = buildConnectedNodeSet(canvas.edges);
  const isolatedNodeCount = canvas.nodes.filter(node => node.node_type !== 'group_hub' && !connected.has(node.id)).length;
  const boards = (canvas.boards ?? []).map(board => ({
    id: board.id,
    name: board.name,
    nodeCount: countNodesInBoard(canvas, board),
  }));
  const mindmaps = canvas.nodes
    .filter((node): node is CanvasNode & { node_type: DataNodeType } => node.node_type === 'mindmap')
    .map(node => ({
      id: node.id,
      title: node.title,
      firstLevelCount: node.meta?.mindmap_summary?.firstLevelCount ?? 0,
      totalItems: node.meta?.mindmap_summary?.totalItems ?? 1,
    }));
  const recentOutputPreviews = aiOutputs
    .slice(-3)
    .map(node => (node.meta?.content_preview ?? '').slice(0, 200))
    .filter(Boolean);

  return {
    canvasTitle: canvas.metadata?.title || 'untitled',
    scene: inferPetScene(canvas),
    phase: inferPetPhase(canvas, nodeStats),
    nodeStats,
    edgeCount: canvas.edges.length,
    isolatedNodeCount,
    boards,
    nodeGroupCount: canvas.nodeGroups?.length ?? 0,
    blueprintCount: canvas.nodes.filter(node => node.node_type === 'blueprint').length,
    mindmaps,
    functionNodeNames: functionNodeNames.slice(0, 8),
    recentOutputPreviews,
    frictionSignals: buildFrictionSignals(canvas, isolatedNodeCount),
  };
}
