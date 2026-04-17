import type { CanvasEdge, CanvasNode, NodeType } from '../core/canvas-model';

export const BLUEPRINT_DEF_VERSION = '2.1.0-alpha.2';

export type BlueprintSlotKind = 'input' | 'intermediate' | 'output';
export type BlueprintAcceptedNodeType = Exclude<NodeType, 'function' | 'group_hub'>;
export type BlueprintEdgeType = Extract<CanvasEdge['edge_type'], 'data_flow' | 'pipeline_flow'>;
export type BlueprintPlaceholderStyle = 'input_placeholder' | 'output_placeholder';
export type BlueprintReplacementMode = 'replace_with_bound_node' | 'attach_by_edge';

export interface BlueprintRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlueprintMetadata {
  created_at: string;
  source_canvas_title?: string;
  source_canvas_updated_at?: string;
}

export interface BlueprintSlotDef {
  id: string;
  kind: BlueprintSlotKind;
  title: string;
  description?: string;
  required: boolean;
  allow_multiple: boolean;
  accepts: BlueprintAcceptedNodeType[];
  source_node_id?: string;
  source_function_node_id?: string;
  placeholder_style: BlueprintPlaceholderStyle;
  replacement_mode: BlueprintReplacementMode;
  binding_hint?: string;
  rect: BlueprintRect;
}

export interface BlueprintDataNodeDef {
  id: string;
  node_type: BlueprintAcceptedNodeType;
  title: string;
  source_node_id: string;
  source_function_node_id?: string;
  rect: BlueprintRect;
}

export interface BlueprintFunctionNodeDef {
  id: string;
  title: string;
  tool_id: string;
  provider?: string;
  model?: string;
  param_values?: Record<string, unknown>;
  rect: BlueprintRect;
}

export interface BlueprintEdgeEndpointRef {
  kind: 'input_slot' | 'intermediate_slot' | 'output_slot' | 'function_node' | 'data_node';
  id: string;
}

export interface BlueprintEdgeDef {
  id: string;
  edge_type: BlueprintEdgeType;
  source: BlueprintEdgeEndpointRef;
  target: BlueprintEdgeEndpointRef;
  role?: string;
}

export interface BlueprintDefinition {
  version: typeof BLUEPRINT_DEF_VERSION;
  id: string;
  title: string;
  description?: string;
  color: string;
  input_slots: BlueprintSlotDef[];
  intermediate_slots: BlueprintSlotDef[];
  output_slots: BlueprintSlotDef[];
  data_nodes: BlueprintDataNodeDef[];
  function_nodes: BlueprintFunctionNodeDef[];
  edges: BlueprintEdgeDef[];
  metadata: BlueprintMetadata;
}

export interface BlueprintDraftIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  node_id?: string;
}

export interface BlueprintDraft extends BlueprintDefinition {
  source_node_ids: string[];
  issues: BlueprintDraftIssue[];
}

export interface BlueprintDraftSummary {
  input_count: number;
  intermediate_count: number;
  output_count: number;
  data_node_count: number;
  function_count: number;
  edge_count: number;
}

export function getBlueprintDraftSummary(draft: BlueprintDraft): BlueprintDraftSummary {
  return {
    input_count: draft.input_slots.length,
    intermediate_count: draft.intermediate_slots.length,
    output_count: draft.output_slots.length,
    data_node_count: draft.data_nodes.length,
    function_count: draft.function_nodes.length,
    edge_count: draft.edges.length,
  };
}

export function toBlueprintRect(node: Pick<CanvasNode, 'position' | 'size'>, origin: { x: number; y: number }): BlueprintRect {
  return {
    x: Math.round(node.position.x - origin.x),
    y: Math.round(node.position.y - origin.y),
    width: Math.round(node.size.width),
    height: Math.round(node.size.height),
  };
}
