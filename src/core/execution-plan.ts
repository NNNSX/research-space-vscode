import { type CanvasEdge, type CanvasFile, type CanvasNode, isGroupHubNode } from './canvas-model';
import { collectExpandedInputs, type ExpandedInputRef } from './hub-utils';

export interface FunctionExecutionInputEdge {
  edge: CanvasEdge;
  edgeType: Extract<CanvasEdge['edge_type'], 'data_flow' | 'pipeline_flow'>;
  sourceNode?: CanvasNode;
  expandedInputs: ExpandedInputRef[];
  isHubSource: boolean;
}

export interface FunctionExecutionPlan {
  targetNode: CanvasNode;
  acceptedEdgeTypes: CanvasEdge['edge_type'][];
  incomingEdges: CanvasEdge[];
  inputEdges: FunctionExecutionInputEdge[];
  expandedInputs: ExpandedInputRef[];
  upstreamNodes: CanvasNode[];
  orderedInputNodeIds: string[];
  nodeRoleMap: Map<string, string | undefined>;
  directDataSourceIds: string[];
  directPipelineSourceIds: string[];
  directHubSourceIds: string[];
  upstreamPipelineSourceIds: string[];
}

export function buildFunctionExecutionPlan(
  targetNodeId: string,
  canvas: Pick<CanvasFile, 'nodes' | 'edges' | 'nodeGroups'>,
  acceptedEdgeTypes: CanvasEdge['edge_type'][] = ['data_flow', 'pipeline_flow'],
): FunctionExecutionPlan | { error: string } {
  const targetNode = canvas.nodes.find(node => node.id === targetNodeId);
  if (!targetNode) {
    return { error: '找不到目标节点' };
  }

  const incomingEdges = canvas.edges.filter(edge =>
    edge.target === targetNodeId && acceptedEdgeTypes.includes(edge.edge_type)
  );
  const expandedInputs = collectExpandedInputs(targetNodeId, canvas, acceptedEdgeTypes);
  const upstreamNodes = expandedInputs.map(ref => ref.node);
  const orderedInputNodeIds = expandedInputs.map(ref => ref.node.id);
  const nodeRoleMap = new Map<string, string | undefined>();

  for (const ref of expandedInputs) {
    if (!nodeRoleMap.has(ref.node.id)) {
      nodeRoleMap.set(ref.node.id, ref.role);
    }
  }

  const inputEdges: FunctionExecutionInputEdge[] = incomingEdges.map(edge => {
    const sourceNode = canvas.nodes.find(node => node.id === edge.source);
    const expandedForEdge = expandedInputs.filter(ref => ref.topSourceId === edge.source);
    return {
      edge,
      edgeType: edge.edge_type as FunctionExecutionInputEdge['edgeType'],
      sourceNode,
      expandedInputs: expandedForEdge,
      isHubSource: !!sourceNode && isGroupHubNode(sourceNode),
    };
  });

  const directDataSourceIds = inputEdges
    .filter(entry => entry.edgeType === 'data_flow')
    .map(entry => entry.edge.source)
    .filter((id, index, ids) => ids.indexOf(id) === index);

  const directPipelineSourceIds = inputEdges
    .filter(entry => entry.edgeType === 'pipeline_flow')
    .map(entry => entry.edge.source)
    .filter((id, index, ids) => ids.indexOf(id) === index);

  const directHubSourceIds = inputEdges
    .filter(entry => entry.isHubSource)
    .map(entry => entry.edge.source)
    .filter((id, index, ids) => ids.indexOf(id) === index);

  return {
    targetNode,
    acceptedEdgeTypes,
    incomingEdges,
    inputEdges,
    expandedInputs,
    upstreamNodes,
    orderedInputNodeIds,
    nodeRoleMap,
    directDataSourceIds,
    directPipelineSourceIds,
    directHubSourceIds,
    upstreamPipelineSourceIds: directPipelineSourceIds,
  };
}
