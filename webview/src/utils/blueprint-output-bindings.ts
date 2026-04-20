import type { BlueprintSlotDef } from '../../../../src/blueprint/blueprint-types';
import type { CanvasNode } from '../../../../src/core/canvas-model';

function extractBlueprintOutputTimestampKey(filePath?: string): string {
  if (!filePath) { return ''; }
  const basename = filePath.split('/').pop() ?? filePath;
  const match = basename.match(/_(\d{4}_\d{6})(?:_\d+)?\.[^.]+$/);
  return match?.[1] ?? '';
}

function sortBlueprintBoundOutputNodes(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((a, b) => {
    const timeDiff = extractBlueprintOutputTimestampKey(a.file_path).localeCompare(extractBlueprintOutputTimestampKey(b.file_path));
    if (timeDiff !== 0) { return timeDiff; }
    return a.id.localeCompare(b.id);
  });
}

export function buildBlueprintOutputSlotBindingState(params: {
  instanceId?: string;
  outputSlots: BlueprintSlotDef[];
  canvasNodes: CanvasNode[];
}): {
  outputBindings: Map<string, number>;
  boundNodesBySlot: Map<string, CanvasNode[]>;
} {
  const { instanceId, outputSlots, canvasNodes } = params;
  const outputBindings = new Map<string, number>();
  const boundNodesBySlot = new Map<string, CanvasNode[]>();

  for (const slot of outputSlots) {
    outputBindings.set(slot.id, 0);
    boundNodesBySlot.set(slot.id, []);
  }

  if (!instanceId) {
    return { outputBindings, boundNodesBySlot };
  }

  for (const node of canvasNodes) {
    if (
      node.meta?.blueprint_bound_instance_id !== instanceId ||
      node.meta?.blueprint_bound_slot_kind !== 'output' ||
      !node.meta?.blueprint_bound_slot_id
    ) {
      continue;
    }
    const slotId = node.meta.blueprint_bound_slot_id;
    const list = boundNodesBySlot.get(slotId) ?? [];
    list.push(node);
    boundNodesBySlot.set(slotId, list);
  }

  for (const [slotId, nodes] of boundNodesBySlot.entries()) {
    const sortedNodes = sortBlueprintBoundOutputNodes(nodes);
    boundNodesBySlot.set(slotId, sortedNodes);
    outputBindings.set(slotId, sortedNodes.length);
  }

  return { outputBindings, boundNodesBySlot };
}
