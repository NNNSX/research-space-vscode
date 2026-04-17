import { v4 as uuid } from 'uuid';
import type { CanvasEdge, CanvasFile, CanvasNode } from '../core/canvas-model';
import { isDataNode, isFunctionNode, isGroupHubNode } from '../core/canvas-model';
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
        replacement_mode: 'replace_with_bound_node',
        binding_hint: '将外部输入节点拖到此占位位置，或直接连接到该输入通道。',
        rect: toBlueprintRect(node, origin),
      });
      slotRefByNodeId.set(node.id, createSlotRef('input_slot', slotId));
      continue;
    }

    const sourceFunctionNodeId = aiGeneratedSourceMap.get(node.id);
    if (consumedBySelectedFunction) {
      const dataNodeId = createSlotId('data', node.id);
      dataNodes.push({
        id: dataNodeId,
        node_type: node.node_type,
        title: node.title,
        source_node_id: node.id,
        source_function_node_id: sourceFunctionNodeId,
        rect: toBlueprintRect(node, origin),
      });
      intermediateSlots.push({
        id: createSlotId('intermediate', node.id),
        kind: 'intermediate',
        title: node.title,
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
    const baseSlot: BlueprintSlotDef = {
      id: slotId,
      kind: 'output',
      title: node.title,
      required: false,
      allow_multiple: false,
      accepts: uniqueAcceptedTypes(node),
      source_node_id: node.id,
      source_function_node_id: sourceFunctionNodeId,
      placeholder_style: 'output_placeholder',
      replacement_mode: 'replace_with_bound_node',
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
