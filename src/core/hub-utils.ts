import {
  type CanvasEdge,
  type CanvasFile,
  type CanvasNode,
  type NodeGroup,
  isGroupHubNode,
  isHubEdgeType,
} from './canvas-model';

export interface ExpandedInputRef {
  node: CanvasNode;
  role?: string;
  topSourceId: string;
  viaHubId?: string;
}

export function getGroupByHubNodeId(nodeGroups: NodeGroup[] | undefined, hubNodeId: string): NodeGroup | undefined {
  return (nodeGroups ?? []).find(group => group.hubNodeId === hubNodeId);
}

export function expandHubSourceNodes(
  sourceNodeId: string,
  canvas: Pick<CanvasFile, 'nodes' | 'edges' | 'nodeGroups'>,
  visited = new Set<string>(),
): CanvasNode[] {
  if (visited.has(sourceNodeId)) { return []; }
  visited.add(sourceNodeId);

  const node = canvas.nodes.find(item => item.id === sourceNodeId);
  if (!node) { return []; }
  if (!isGroupHubNode(node)) { return [node]; }

  const group = getGroupByHubNodeId(canvas.nodeGroups, node.id);
  const groupMemberIds = group?.nodeIds ?? [];

  const incomingEdges = canvas.edges.filter(edge =>
    edge.target === node.id &&
    (isHubEdgeType(edge.edge_type) || edge.edge_type === 'data_flow')
  );

  const orderedSourceIds = [
    ...(node.meta?.input_order ?? []),
    ...groupMemberIds,
    ...incomingEdges.map(edge => edge.source),
  ].filter((id, index, list) => list.indexOf(id) === index && id !== node.id);

  const expanded: CanvasNode[] = [];
  const seenLeafIds = new Set<string>();

  for (const childId of orderedSourceIds) {
    const childNodes = expandHubSourceNodes(childId, canvas, visited);
    for (const childNode of childNodes) {
      if (seenLeafIds.has(childNode.id)) { continue; }
      seenLeafIds.add(childNode.id);
      expanded.push(childNode);
    }
  }

  return expanded;
}

export function collectExpandedInputs(
  targetNodeId: string,
  canvas: Pick<CanvasFile, 'nodes' | 'edges' | 'nodeGroups'>,
  acceptedEdgeTypes: CanvasEdge['edge_type'][] = ['data_flow', 'pipeline_flow'],
): ExpandedInputRef[] {
  const targetNode = canvas.nodes.find(node => node.id === targetNodeId);
  const incomingEdges = canvas.edges.filter(edge =>
    edge.target === targetNodeId && acceptedEdgeTypes.includes(edge.edge_type)
  );

  const refs: ExpandedInputRef[] = [];
  const defaultIndex = new Map<string, number>();
  let nextIndex = 0;

  for (const edge of incomingEdges) {
    const leaves = expandHubSourceNodes(edge.source, canvas, new Set());
    for (const leafNode of leaves) {
      defaultIndex.set(`${leafNode.id}|${edge.role ?? ''}|${edge.source}`, nextIndex++);
      refs.push({
        node: leafNode,
        role: edge.role,
        topSourceId: edge.source,
        viaHubId: leafNode.id === edge.source ? undefined : edge.source,
      });
    }
  }

  const orderedIds = targetNode?.meta?.input_order ?? [];
  const orderMap = new Map(orderedIds.map((id, index) => [id, index]));

  refs.sort((a, b) => {
    const aOrder = orderMap.get(a.node.id);
    const bOrder = orderMap.get(b.node.id);
    if (aOrder !== undefined && bOrder !== undefined) { return aOrder - bOrder; }
    if (aOrder !== undefined) { return -1; }
    if (bOrder !== undefined) { return 1; }
    const aDefault = defaultIndex.get(`${a.node.id}|${a.role ?? ''}|${a.topSourceId}`) ?? Number.MAX_SAFE_INTEGER;
    const bDefault = defaultIndex.get(`${b.node.id}|${b.role ?? ''}|${b.topSourceId}`) ?? Number.MAX_SAFE_INTEGER;
    return aDefault - bDefault;
  });

  const deduped: ExpandedInputRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.node.id}|${ref.role ?? ''}|${ref.topSourceId}`;
    if (seen.has(key)) { continue; }
    seen.add(key);
    deduped.push(ref);
  }

  return deduped;
}
