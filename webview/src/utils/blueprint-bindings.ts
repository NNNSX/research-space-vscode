import type { CanvasNode } from '../../../../src/core/canvas-model';
import type { BlueprintSlotDef } from '../../../../src/blueprint/blueprint-types';
import type { FlowEdge } from '../stores/canvas-store';

export function buildBlueprintInputSlotBindingMap(params: {
  blueprintNodeId: string;
  instanceId?: string;
  inputSlots: BlueprintSlotDef[];
  canvasNodes: CanvasNode[];
  edges: FlowEdge[];
}): Map<string, number> {
  const {
    blueprintNodeId,
    instanceId,
    inputSlots,
    canvasNodes,
    edges,
  } = params;

  const bindings = new Map<string, number>();
  for (const slot of inputSlots) {
    bindings.set(slot.id, 0);
  }

  if (!instanceId) {
    for (const edge of edges) {
      if (edge.target !== blueprintNodeId || edge.data?.edge_type !== 'data_flow') { continue; }
      const slotId = edge.data?.role ?? edge.targetHandle;
      if (!slotId) { continue; }
      bindings.set(slotId, (bindings.get(slotId) ?? 0) + 1);
    }
    return bindings;
  }

  const replacedBindings = canvasNodes.filter(node =>
    node.meta?.blueprint_bound_instance_id === instanceId &&
    node.meta?.blueprint_bound_slot_kind !== 'output' &&
    !!node.meta?.blueprint_bound_slot_id
  );
  for (const node of replacedBindings) {
    const slotId = node.meta?.blueprint_bound_slot_id;
    if (!slotId) { continue; }
    bindings.set(slotId, (bindings.get(slotId) ?? 0) + 1);
  }

  const placeholderNodes = canvasNodes.filter(node =>
    node.meta?.blueprint_instance_id === instanceId &&
    node.meta?.blueprint_placeholder_kind === 'input' &&
    !!node.meta?.blueprint_placeholder_slot_id
  );
  const placeholderIdToSlotId = new Map(
    placeholderNodes.map(node => [node.id, node.meta?.blueprint_placeholder_slot_id ?? ''])
  );
  for (const edge of edges) {
    if (edge.data?.edge_type !== 'data_flow') { continue; }
    const slotId = placeholderIdToSlotId.get(edge.target);
    if (!slotId) { continue; }
    bindings.set(slotId, (bindings.get(slotId) ?? 0) + 1);
  }

  for (const edge of edges) {
    if (edge.data?.edge_type !== 'data_flow') { continue; }
    if (edge.target !== blueprintNodeId) { continue; }
    const slotId = edge.data?.role ?? edge.targetHandle;
    if (!slotId) { continue; }
    bindings.set(slotId, (bindings.get(slotId) ?? 0) + 1);
  }

  return bindings;
}
