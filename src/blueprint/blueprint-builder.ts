import { v4 as uuid } from 'uuid';
import type { CanvasEdge, CanvasFile, CanvasNode, DataCanvasNode } from '../core/canvas-model';
import {
  isBlueprintInstanceContainerNode,
  isDataNode,
  isFunctionNode,
  isGroupHubNode,
} from '../core/canvas-model';
import {
  BLUEPRINT_DEF_VERSION,
  type BlueprintAcceptedNodeType,
  type BlueprintDataNodeDef,
  type BlueprintDraft,
  type BlueprintDraftIssue,
  type BlueprintEdgeDef,
  type BlueprintEdgeEndpointRef,
  type BlueprintFunctionNodeDef,
  type BlueprintSlotDef,
  toBlueprintRect,
} from './blueprint-types';

const BLUEPRINT_DEFAULT_COLOR = '#2f7d68';

function createDraftIssue(message: string, code: string, nodeId?: string): BlueprintDraftIssue {
  return { level: 'error', code, message, node_id: nodeId };
}

function ensureSupportedSelection(selectedNodes: CanvasNode[], selectedSet: Set<string>, canvas: CanvasFile): void {
  if (selectedNodes.length === 0) {
    throw new Error('请先选择一段工作流，再创建蓝图。');
  }

  const selectedFunctionNodes = selectedNodes.filter(isFunctionNode);
  if (selectedFunctionNodes.length === 0) {
    throw new Error('创建蓝图至少需要选中一个功能节点。');
  }

  const groupHub = selectedNodes.find(isGroupHubNode);
  if (groupHub) {
    throw new Error(`首版蓝图草稿暂不支持直接包含节点组：${groupHub.title}`);
  }

  const unresolvedIncoming = canvas.edges.find(edge =>
    ['data_flow', 'pipeline_flow'].includes(edge.edge_type) &&
    selectedSet.has(edge.target) &&
    !selectedSet.has(edge.source)
  );
  if (unresolvedIncoming) {
    const sourceNode = canvas.nodes.find(node => node.id === unresolvedIncoming.source);
    const targetNode = canvas.nodes.find(node => node.id === unresolvedIncoming.target);
    throw new Error(
      `选区仍依赖未选中的上游节点：${sourceNode?.title ?? unresolvedIncoming.source} → ${targetNode?.title ?? unresolvedIncoming.target}。请把整段工作流一起选中后再创建蓝图。`
    );
  }
}

function relativeOrigin(nodes: CanvasNode[]) {
  return {
    x: Math.min(...nodes.map(node => node.position.x)),
    y: Math.min(...nodes.map(node => node.position.y)),
  };
}

function createSlotId(prefix: string, sourceNodeId: string): string {
  return `${prefix}_${sourceNodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function createFunctionRef(id: string): BlueprintEdgeEndpointRef {
  return { kind: 'function_node', id };
}

function createDataNodeRef(id: string): BlueprintEdgeEndpointRef {
  return { kind: 'data_node', id };
}

function createSlotRef(kind: BlueprintEdgeEndpointRef['kind'], id: string): BlueprintEdgeEndpointRef {
  return { kind, id };
}

function uniqueAcceptedTypes(node: CanvasNode): BlueprintAcceptedNodeType[] {
  return isDataNode(node) ? [node.node_type] : ['note'];
}

function buildBlueprintProducedTitle(
  sourceFunctionTitle: string | undefined,
  kind: 'intermediate' | 'output',
  fallbackTitle: string,
): string {
  const normalizedFnTitle = sourceFunctionTitle?.trim();
  if (!normalizedFnTitle) { return fallbackTitle; }
  return kind === 'intermediate'
    ? `中间结果 · ${normalizedFnTitle}`
    : `输出结果 · ${normalizedFnTitle}`;
}

function dedupeNodes(nodes: CanvasNode[]): CanvasNode[] {
  const seen = new Set<string>();
  const result: CanvasNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) { continue; }
    seen.add(node.id);
    result.push(node);
  }
  return result;
}

function getBlueprintFunctionDefId(node: CanvasNode): string {
  return node.meta?.blueprint_source_kind === 'function_node' && typeof node.meta.blueprint_source_id === 'string'
    ? node.meta.blueprint_source_id
    : node.id;
}

function getBlueprintDataDefId(node: CanvasNode): string {
  return node.meta?.blueprint_source_kind === 'data_node' && typeof node.meta.blueprint_source_id === 'string'
    ? node.meta.blueprint_source_id
    : createSlotId('data', node.id);
}

function getBlueprintSlotId(node: CanvasNode, kind: 'input' | 'output'): string | undefined {
  if (node.meta?.blueprint_placeholder_kind === kind) {
    return node.meta.blueprint_placeholder_slot_id;
  }
  if (node.meta?.blueprint_bound_slot_kind === kind) {
    return node.meta.blueprint_bound_slot_id;
  }
  return undefined;
}

function buildSyntheticTerminalOutputSlots(params: {
  functionDefs: BlueprintFunctionNodeDef[];
  edges: BlueprintEdgeDef[];
  outputSlots: BlueprintSlotDef[];
  dataNodes?: BlueprintDataNodeDef[];
}): BlueprintSlotDef[] {
  const { functionDefs, edges, outputSlots, dataNodes = [] } = params;
  const explicitOutputSourceFnIds = new Set(outputSlots.map(slot => slot.source_function_node_id).filter((value): value is string => !!value));
  const downstreamPipelineSourceIds = new Set(
    edges
      .filter(edge => edge.edge_type === 'pipeline_flow' && edge.source.kind === 'function_node')
      .map(edge => edge.source.id),
  );
  const producedDataSourceFnIds = new Set(dataNodes.map(node => node.source_function_node_id).filter((value): value is string => !!value));

  return functionDefs
    .filter(fnNode => !explicitOutputSourceFnIds.has(fnNode.id))
    .filter(fnNode => !downstreamPipelineSourceIds.has(fnNode.id))
    .filter(fnNode => !producedDataSourceFnIds.has(fnNode.id))
    .map(fnNode => ({
      id: createSlotId('output', fnNode.id),
      kind: 'output' as const,
      title: buildBlueprintProducedTitle(fnNode.title, 'output', fnNode.title || '输出结果'),
      required: false,
      allow_multiple: false,
      accepts: ['ai_output'],
      source_function_node_id: fnNode.id,
      placeholder_style: 'output_placeholder' as const,
      replacement_mode: 'attach_by_edge' as const,
      binding_hint: '蓝图运行完成后，最终输出会优先回填到该占位位置。',
      rect: {
        x: fnNode.rect.x + fnNode.rect.width + 60,
        y: fnNode.rect.y + Math.max((fnNode.rect.height - 136) / 2, 0),
        width: 240,
        height: 136,
      },
    }));
}

function buildSlotFromInstanceCarrier(
  slotId: string,
  kind: 'input' | 'output',
  origin: { x: number; y: number },
  carrierNode: CanvasNode | undefined,
  fallbackSlot: BlueprintSlotDef | undefined,
): BlueprintSlotDef {
  const fallbackTitle = fallbackSlot?.title
    ?? carrierNode?.meta?.blueprint_placeholder_title
    ?? carrierNode?.meta?.blueprint_bound_slot_title
    ?? carrierNode?.title
    ?? (kind === 'input' ? '输入槽位' : '输出槽位');
  const fallbackAccepts = fallbackSlot?.accepts
    ?? carrierNode?.meta?.blueprint_placeholder_accepts
    ?? (carrierNode ? uniqueAcceptedTypes(carrierNode) : ['note']);
  return {
    id: slotId,
    kind,
    title: carrierNode?.meta?.blueprint_placeholder_title
      ?? carrierNode?.meta?.blueprint_bound_slot_title
      ?? fallbackTitle,
    description: fallbackSlot?.description,
    required: carrierNode?.meta?.blueprint_placeholder_required
      ?? fallbackSlot?.required
      ?? (kind === 'input'),
    allow_multiple: carrierNode?.meta?.blueprint_placeholder_allow_multiple
      ?? fallbackSlot?.allow_multiple
      ?? false,
    accepts: [...fallbackAccepts],
    source_node_id: carrierNode?.id ?? fallbackSlot?.source_node_id,
    source_function_node_id: fallbackSlot?.source_function_node_id,
    placeholder_style: fallbackSlot?.placeholder_style ?? (kind === 'input' ? 'input_placeholder' : 'output_placeholder'),
    replacement_mode: carrierNode?.meta?.blueprint_placeholder_replacement_mode
      ?? fallbackSlot?.replacement_mode
      ?? 'attach_by_edge',
    binding_hint: carrierNode?.meta?.blueprint_placeholder_hint
      ?? fallbackSlot?.binding_hint
      ?? (kind === 'input'
        ? '将外部输入节点直接连接到该输入占位，作为蓝图实例输入传递。'
        : '蓝图运行完成后，最终输出会优先回填到该占位位置。'),
    rect: carrierNode ? toBlueprintRect(carrierNode, origin) : (
      fallbackSlot?.rect ?? { x: 0, y: 0, width: 220, height: 136 }
    ),
  };
}

export function buildBlueprintDraftFromSelection(
  selectedNodeIds: string[],
  canvas: CanvasFile,
): BlueprintDraft {
  const selectedSet = new Set(selectedNodeIds);
  const selectedNodes = canvas.nodes.filter(node => selectedSet.has(node.id));
  ensureSupportedSelection(selectedNodes, selectedSet, canvas);

  const origin = relativeOrigin(selectedNodes);
  const selectedFunctionNodes = selectedNodes.filter(isFunctionNode);
  const selectedDataNodes = selectedNodes.filter(isDataNode);
  const internalEdges = canvas.edges.filter(edge =>
    selectedSet.has(edge.source) &&
    selectedSet.has(edge.target) &&
    ['data_flow', 'pipeline_flow', 'ai_generated'].includes(edge.edge_type)
  );

  const aiGeneratedTargets = new Set(
    internalEdges
      .filter(edge => edge.edge_type === 'ai_generated')
      .map(edge => edge.target)
  );
  const aiGeneratedSourceMap = new Map<string, string>();
  for (const edge of internalEdges.filter(item => item.edge_type === 'ai_generated')) {
    aiGeneratedSourceMap.set(edge.target, edge.source);
  }

  const internalDataEdges = internalEdges.filter(edge => edge.edge_type === 'data_flow');
  const inputSlots: BlueprintSlotDef[] = [];
  const intermediateSlots: BlueprintSlotDef[] = [];
  const outputSlots: BlueprintSlotDef[] = [];
  const dataNodes: BlueprintDataNodeDef[] = [];
  const functionTitleById = new Map(selectedFunctionNodes.map(node => [node.id, node.title]));
  const slotRefByNodeId = new Map<string, BlueprintEdgeEndpointRef>();
  const dataNodeRefByNodeId = new Map<string, BlueprintEdgeEndpointRef>();
  const functionDefs: BlueprintFunctionNodeDef[] = selectedFunctionNodes.map(node => ({
    id: node.id,
    title: node.title,
    tool_id: String(node.meta?.ai_tool ?? ''),
    provider: node.meta?.ai_provider,
    model: node.meta?.ai_model,
    param_values: node.meta?.param_values ? { ...node.meta.param_values } : undefined,
    rect: toBlueprintRect(node, origin),
  }));

  for (const node of selectedDataNodes) {
    const producedBySelectedFunction = aiGeneratedTargets.has(node.id);
    const consumedBySelectedFunction = internalDataEdges.some(edge => edge.source === node.id);

    if (!producedBySelectedFunction) {
      const slotId = createSlotId('input', node.id);
      inputSlots.push({
        id: slotId,
        kind: 'input',
        title: node.title,
        required: true,
        allow_multiple: false,
        accepts: uniqueAcceptedTypes(node),
        source_node_id: node.id,
        placeholder_style: 'input_placeholder',
        replacement_mode: 'attach_by_edge',
        binding_hint: '将外部输入节点直接连接到该输入占位，作为蓝图实例输入传递。',
        rect: toBlueprintRect(node, origin),
      });
      slotRefByNodeId.set(node.id, createSlotRef('input_slot', slotId));
      continue;
    }

    const sourceFunctionNodeId = aiGeneratedSourceMap.get(node.id);
    if (consumedBySelectedFunction) {
      const semanticTitle = buildBlueprintProducedTitle(
        sourceFunctionNodeId ? functionTitleById.get(sourceFunctionNodeId) : undefined,
        'intermediate',
        node.title,
      );
      const dataNodeId = createSlotId('data', node.id);
      dataNodes.push({
        id: dataNodeId,
        node_type: node.node_type,
        title: semanticTitle,
        source_node_id: node.id,
        source_function_node_id: sourceFunctionNodeId,
        rect: toBlueprintRect(node, origin),
      });
      intermediateSlots.push({
        id: createSlotId('intermediate', node.id),
        kind: 'intermediate',
        title: semanticTitle,
        required: false,
        allow_multiple: false,
        accepts: uniqueAcceptedTypes(node),
        source_node_id: node.id,
        source_function_node_id: sourceFunctionNodeId,
        placeholder_style: 'output_placeholder',
        replacement_mode: 'attach_by_edge',
        binding_hint: '中间产物保留为蓝图内部节点，供后续功能节点继续消费。',
        rect: toBlueprintRect(node, origin),
      });
      dataNodeRefByNodeId.set(node.id, createDataNodeRef(dataNodeId));
      continue;
    }

    const slotId = createSlotId('output', node.id);
    const semanticTitle = buildBlueprintProducedTitle(
      sourceFunctionNodeId ? functionTitleById.get(sourceFunctionNodeId) : undefined,
      'output',
      node.title,
    );
    const baseSlot: BlueprintSlotDef = {
      id: slotId,
      kind: 'output',
      title: semanticTitle,
      required: false,
      allow_multiple: false,
      accepts: uniqueAcceptedTypes(node),
      source_node_id: node.id,
      source_function_node_id: sourceFunctionNodeId,
      placeholder_style: 'output_placeholder',
      replacement_mode: 'attach_by_edge',
      binding_hint: '蓝图运行完成后，最终输出会优先回填到该占位位置。',
      rect: toBlueprintRect(node, origin),
    };
    outputSlots.push(baseSlot);
    slotRefByNodeId.set(node.id, createSlotRef('output_slot', slotId));
  }

  const edges: BlueprintEdgeDef[] = [];
  const issues: BlueprintDraftIssue[] = [];

  for (const edge of internalEdges) {
    if (edge.edge_type === 'pipeline_flow') {
      edges.push({
        id: edge.id,
        edge_type: 'pipeline_flow',
        source: createFunctionRef(edge.source),
        target: createFunctionRef(edge.target),
      });
      continue;
    }

    if (edge.edge_type === 'data_flow') {
      const sourceRef = slotRefByNodeId.get(edge.source) ?? dataNodeRefByNodeId.get(edge.source);
      if (!sourceRef) {
        issues.push(createDraftIssue(`未能为数据节点 ${edge.source} 生成槽位引用。`, 'missing_slot_ref', edge.source));
        continue;
      }
      edges.push({
        id: edge.id,
        edge_type: 'data_flow',
        source: sourceRef,
        target: createFunctionRef(edge.target),
        role: edge.role,
      });
      continue;
    }

    if (edge.edge_type === 'ai_generated') {
      const targetRef = slotRefByNodeId.get(edge.target) ?? dataNodeRefByNodeId.get(edge.target);
      if (!targetRef) {
        issues.push(createDraftIssue(`未能为 AI 输出节点 ${edge.target} 生成输出槽位。`, 'missing_output_ref', edge.target));
        continue;
      }
      edges.push({
        id: edge.id,
        edge_type: 'data_flow',
        source: createFunctionRef(edge.source),
        target: targetRef,
      });
    }
  }

  const invalidFunction = functionDefs.find(def => !def.tool_id);
  if (invalidFunction) {
    throw new Error(`功能节点 ${invalidFunction.title} 缺少 ai_tool 配置，当前无法创建蓝图草稿。`);
  }

  return {
    version: BLUEPRINT_DEF_VERSION,
    id: uuid(),
    title: `新蓝图 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    description: '',
    color: BLUEPRINT_DEFAULT_COLOR,
    input_slots: inputSlots,
    intermediate_slots: intermediateSlots,
    output_slots: outputSlots,
    data_nodes: dataNodes,
    function_nodes: functionDefs,
    edges,
    metadata: {
      created_at: new Date().toISOString(),
      source_canvas_title: canvas.metadata.title,
      source_canvas_updated_at: canvas.metadata.updated_at,
    },
    source_node_ids: [...selectedNodeIds],
    issues,
  };
}

export function buildBlueprintDraftFromInstance(
  containerNodeId: string,
  canvas: CanvasFile,
): BlueprintDraft {
  const containerNode = canvas.nodes.find(node => node.id === containerNodeId);
  if (!isBlueprintInstanceContainerNode(containerNode)) {
    throw new Error('找不到可演化的蓝图实例容器。');
  }

  const instanceId = containerNode.meta?.blueprint_instance_id;
  if (!instanceId) {
    throw new Error('蓝图实例缺少 instance_id，当前无法基于实例生成新蓝图。');
  }

  const internalNodes = canvas.nodes.filter(node =>
    node.id !== containerNode.id &&
    node.meta?.blueprint_instance_id === instanceId
  );
  const internalFunctionNodes = internalNodes.filter(isFunctionNode);
  if (internalFunctionNodes.length === 0) {
    throw new Error('当前蓝图实例内没有可演化的功能节点。');
  }

  const internalDataNodes = internalNodes.filter((node): node is DataCanvasNode =>
    isDataNode(node) &&
    !node.meta?.blueprint_placeholder_kind &&
    !node.meta?.blueprint_runtime_hidden
  );
  const inputCarrierNodes = canvas.nodes.filter(node =>
    (node.meta?.blueprint_instance_id === instanceId && node.meta?.blueprint_placeholder_kind === 'input') ||
    (node.meta?.blueprint_bound_instance_id === instanceId && node.meta?.blueprint_bound_slot_kind === 'input')
  );
  const outputCarrierNodes = canvas.nodes.filter(node =>
    (node.meta?.blueprint_instance_id === instanceId && node.meta?.blueprint_placeholder_kind === 'output') ||
    (node.meta?.blueprint_bound_instance_id === instanceId && node.meta?.blueprint_bound_slot_kind === 'output')
  );

  const inputSlotFallbacks = new Map((containerNode.meta?.blueprint_input_slot_defs ?? []).map(slot => [slot.id, slot]));
  const outputSlotFallbacks = new Map((containerNode.meta?.blueprint_output_slot_defs ?? []).map(slot => [slot.id, slot]));

  const inputCarrierBySlotId = new Map<string, CanvasNode>();
  for (const node of inputCarrierNodes) {
    const slotId = getBlueprintSlotId(node, 'input');
    if (!slotId || inputCarrierBySlotId.has(slotId)) { continue; }
    inputCarrierBySlotId.set(slotId, node);
  }
  const outputCarrierBySlotId = new Map<string, CanvasNode>();
  for (const node of outputCarrierNodes) {
    const slotId = getBlueprintSlotId(node, 'output');
    if (!slotId || outputCarrierBySlotId.has(slotId)) { continue; }
    outputCarrierBySlotId.set(slotId, node);
  }

  const layoutNodes = dedupeNodes([
    ...internalFunctionNodes,
    ...internalDataNodes,
    ...inputCarrierBySlotId.values(),
    ...outputCarrierBySlotId.values(),
  ]);
  const origin = relativeOrigin(layoutNodes);
  const issues: BlueprintDraftIssue[] = [];

  const functionNodeIdSet = new Set(internalFunctionNodes.map(node => node.id));
  const dataNodeIdSet = new Set(internalDataNodes.map(node => node.id));
  const inputCarrierIdSet = new Set(inputCarrierNodes.map(node => node.id));
  const outputCarrierIdSet = new Set(outputCarrierNodes.map(node => node.id));
  const relevantEdges = canvas.edges.filter(edge => {
    if (!['data_flow', 'pipeline_flow', 'ai_generated'].includes(edge.edge_type)) { return false; }
    if (edge.edge_type === 'pipeline_flow') {
      return functionNodeIdSet.has(edge.source) && functionNodeIdSet.has(edge.target);
    }
    if (edge.edge_type === 'data_flow') {
      return functionNodeIdSet.has(edge.target) && (dataNodeIdSet.has(edge.source) || inputCarrierIdSet.has(edge.source));
    }
    return functionNodeIdSet.has(edge.source) && (dataNodeIdSet.has(edge.target) || outputCarrierIdSet.has(edge.target));
  });

  const functionIdByCanvasNodeId = new Map<string, string>();
  const functionTitleByBlueprintId = new Map<string, string>();
  const functionDefs: BlueprintFunctionNodeDef[] = internalFunctionNodes.map(node => {
    const blueprintId = getBlueprintFunctionDefId(node);
    functionIdByCanvasNodeId.set(node.id, blueprintId);
    functionTitleByBlueprintId.set(blueprintId, node.title);
    return {
      id: blueprintId,
      title: node.title,
      tool_id: String(node.meta?.ai_tool ?? ''),
      provider: node.meta?.ai_provider,
      model: node.meta?.ai_model,
      param_values: node.meta?.param_values ? { ...node.meta.param_values } : undefined,
      rect: toBlueprintRect(node, origin),
    };
  });

  const aiGeneratedSourceCanvasIdByTargetId = new Map<string, string>();
  for (const edge of relevantEdges.filter(edge => edge.edge_type === 'ai_generated')) {
    aiGeneratedSourceCanvasIdByTargetId.set(edge.target, edge.source);
  }

  const dataNodeRefByCanvasNodeId = new Map<string, BlueprintEdgeEndpointRef>();
  const dataNodes: BlueprintDataNodeDef[] = [];
  const intermediateSlots: BlueprintSlotDef[] = [];
  for (const node of internalDataNodes) {
    const blueprintDataId = getBlueprintDataDefId(node);
    const sourceFunctionCanvasId = aiGeneratedSourceCanvasIdByTargetId.get(node.id);
    const sourceFunctionBlueprintId = sourceFunctionCanvasId ? functionIdByCanvasNodeId.get(sourceFunctionCanvasId) : undefined;
    const consumedBySelectedFunction = relevantEdges.some(edge => edge.edge_type === 'data_flow' && edge.source === node.id);
    const semanticTitle = buildBlueprintProducedTitle(
      sourceFunctionBlueprintId ? functionTitleByBlueprintId.get(sourceFunctionBlueprintId) : undefined,
      'intermediate',
      node.title,
    );
    dataNodes.push({
      id: blueprintDataId,
      node_type: node.node_type,
      title: semanticTitle,
      source_node_id: node.id,
      source_function_node_id: sourceFunctionBlueprintId,
      rect: toBlueprintRect(node, origin),
    });
    dataNodeRefByCanvasNodeId.set(node.id, createDataNodeRef(blueprintDataId));
    if (consumedBySelectedFunction) {
      intermediateSlots.push({
        id: createSlotId('intermediate', blueprintDataId),
        kind: 'intermediate',
        title: semanticTitle,
        required: false,
        allow_multiple: false,
        accepts: uniqueAcceptedTypes(node),
        source_node_id: node.id,
        source_function_node_id: sourceFunctionBlueprintId,
        placeholder_style: 'output_placeholder',
        replacement_mode: 'attach_by_edge',
        binding_hint: '中间产物保留为蓝图内部节点，供后续功能节点继续消费。',
        rect: toBlueprintRect(node, origin),
      });
    }
  }

  const slotRefByCanvasNodeId = new Map<string, BlueprintEdgeEndpointRef>();
  const buildSlotList = (
    kind: 'input' | 'output',
    carrierBySlotId: Map<string, CanvasNode>,
    fallbackMap: Map<string, BlueprintSlotDef>,
  ): BlueprintSlotDef[] => {
    const slotIds = new Set<string>([...fallbackMap.keys(), ...carrierBySlotId.keys()]);
    return [...slotIds]
      .map(slotId => {
        const carrierNode = carrierBySlotId.get(slotId);
        const fallbackSlot = fallbackMap.get(slotId);
        if (!carrierNode && !fallbackSlot) { return null; }
        if (carrierNode) {
          slotRefByCanvasNodeId.set(
            carrierNode.id,
            createSlotRef(kind === 'input' ? 'input_slot' : 'output_slot', slotId),
          );
        } else {
          issues.push(createDraftIssue(`实例里的${kind === 'input' ? '输入' : '输出'}槽位 ${slotId} 缺少当前承载节点，已回退到原蓝图定义位置。`, 'missing_instance_slot_carrier'));
        }
        return buildSlotFromInstanceCarrier(slotId, kind, origin, carrierNode, fallbackSlot);
      })
      .filter((slot): slot is BlueprintSlotDef => !!slot)
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  };

  const inputSlots = buildSlotList('input', inputCarrierBySlotId, inputSlotFallbacks);
  const outputSlots = buildSlotList('output', outputCarrierBySlotId, outputSlotFallbacks);

  const edges: BlueprintEdgeDef[] = [];
  for (const edge of relevantEdges) {
    if (edge.edge_type === 'pipeline_flow') {
      const sourceId = functionIdByCanvasNodeId.get(edge.source);
      const targetId = functionIdByCanvasNodeId.get(edge.target);
      if (!sourceId || !targetId) {
        issues.push(createDraftIssue(`未能恢复 Pipeline 边 ${edge.source} → ${edge.target}。`, 'missing_pipeline_ref'));
        continue;
      }
      edges.push({
        id: edge.id,
        edge_type: 'pipeline_flow',
        source: createFunctionRef(sourceId),
        target: createFunctionRef(targetId),
      });
      continue;
    }

    if (edge.edge_type === 'data_flow') {
      const sourceRef = slotRefByCanvasNodeId.get(edge.source) ?? dataNodeRefByCanvasNodeId.get(edge.source);
      const targetId = functionIdByCanvasNodeId.get(edge.target);
      if (!sourceRef || !targetId) {
        issues.push(createDraftIssue(`未能恢复数据边 ${edge.source} → ${edge.target}。`, 'missing_data_ref'));
        continue;
      }
      edges.push({
        id: edge.id,
        edge_type: 'data_flow',
        source: sourceRef,
        target: createFunctionRef(targetId),
        role: edge.role,
      });
      continue;
    }

    const sourceId = functionIdByCanvasNodeId.get(edge.source);
    const targetRef = slotRefByCanvasNodeId.get(edge.target) ?? dataNodeRefByCanvasNodeId.get(edge.target);
    if (!sourceId || !targetRef) {
      issues.push(createDraftIssue(`未能恢复输出边 ${edge.source} → ${edge.target}。`, 'missing_output_ref'));
      continue;
    }
    edges.push({
      id: edge.id,
      edge_type: 'data_flow',
      source: createFunctionRef(sourceId),
      target: targetRef,
    });
  }

  const invalidFunction = functionDefs.find(def => !def.tool_id);
  if (invalidFunction) {
    throw new Error(`功能节点 ${invalidFunction.title} 缺少 ai_tool 配置，当前无法基于实例生成蓝图草稿。`);
  }

  const syntheticInstanceOutputSlots = buildSyntheticTerminalOutputSlots({
    functionDefs,
    edges,
    outputSlots,
    dataNodes,
  });
  if (syntheticInstanceOutputSlots.length > 0) {
    for (const slot of syntheticInstanceOutputSlots) {
      outputSlots.push(slot);
      if (slot.source_function_node_id) {
        edges.push({
          id: uuid(),
          edge_type: 'data_flow',
          source: createFunctionRef(slot.source_function_node_id),
          target: createSlotRef('output_slot', slot.id),
        });
      }
    }
  }

  return {
    version: BLUEPRINT_DEF_VERSION,
    id: uuid(),
    title: containerNode.title || '新蓝图',
    description: containerNode.meta?.blueprint_last_run_summary ?? '',
    color: containerNode.meta?.blueprint_color ?? BLUEPRINT_DEFAULT_COLOR,
    input_slots: inputSlots,
    intermediate_slots: intermediateSlots,
    output_slots: outputSlots,
    data_nodes: dataNodes,
    function_nodes: functionDefs,
    edges,
    metadata: {
      created_at: new Date().toISOString(),
      source_canvas_title: canvas.metadata.title,
      source_canvas_updated_at: canvas.metadata.updated_at,
    },
    source_node_ids: [
      ...internalNodes.map(node => node.id),
      ...inputCarrierNodes.map(node => node.id),
      ...outputCarrierNodes.map(node => node.id),
    ],
    issues,
    source_mode: 'create',
  };
}
