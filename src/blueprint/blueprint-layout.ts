import type {
  BlueprintDataNodeDef,
  BlueprintDefinition,
  BlueprintEdgeEndpointRef,
  BlueprintFunctionNodeDef,
  BlueprintSlotDef,
} from './blueprint-types';

const INPUT_TO_FUNCTION_GAP = 170;
const FUNCTION_TO_DATA_GAP = 72;
const DATA_TO_NEXT_FUNCTION_GAP = 110;
const OUTPUT_GAP = 170;
const MIN_ROW_PITCH = 220;
const ROW_VERTICAL_PADDING = 56;
const INPUT_VERTICAL_GAP = 18;

type NodeLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getEffectiveInputSlotSize(slot: BlueprintSlotDef): { width: number; height: number } {
  return {
    width: Math.max(250, Math.min(300, slot.rect.width || 0)),
    height: Math.max(150, Math.min(210, slot.rect.height || 0)),
  };
}

function centerY(layout: Pick<NodeLayout, 'y' | 'height'>): number {
  return layout.y + (layout.height / 2);
}

function topFromCenter(center: number, height: number): number {
  return center - (height / 2);
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) { return fallback; }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveSourceFunctionId(
  endpoint: BlueprintEdgeEndpointRef,
  dataNodeById: Map<string, BlueprintDataNodeDef>,
  intermediateById: Map<string, BlueprintSlotDef>,
): string | undefined {
  switch (endpoint.kind) {
    case 'function_node':
      return endpoint.id;
    case 'data_node':
      return dataNodeById.get(endpoint.id)?.source_function_node_id;
    case 'intermediate_slot':
      return intermediateById.get(endpoint.id)?.source_function_node_id;
    default:
      return undefined;
  }
}

function buildFunctionRanks(definition: BlueprintDefinition): Map<string, number> {
  const dataNodeById = new Map(definition.data_nodes.map(node => [node.id, node]));
  const intermediateById = new Map(definition.intermediate_slots.map(slot => [slot.id, slot]));
  const predecessors = new Map<string, Set<string>>();

  for (const fnNode of definition.function_nodes) {
    predecessors.set(fnNode.id, new Set<string>());
  }

  for (const edge of definition.edges) {
    if (edge.target.kind !== 'function_node') { continue; }
    const sourceFunctionId = resolveSourceFunctionId(edge.source, dataNodeById, intermediateById);
    if (!sourceFunctionId || sourceFunctionId === edge.target.id) { continue; }
    predecessors.get(edge.target.id)?.add(sourceFunctionId);
  }

  const rankMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const computeRank = (functionId: string): number => {
    const cached = rankMemo.get(functionId);
    if (cached !== undefined) { return cached; }
    if (visiting.has(functionId)) { return 0; }
    visiting.add(functionId);
    const prev = Array.from(predecessors.get(functionId) ?? []);
    const rank = prev.length === 0 ? 0 : (Math.max(...prev.map(computeRank)) + 1);
    visiting.delete(functionId);
    rankMemo.set(functionId, rank);
    return rank;
  };

  for (const fnNode of definition.function_nodes) {
    computeRank(fnNode.id);
  }
  return rankMemo;
}

function rankItemsByOriginalOrder<T extends { id: string; rect: { x: number; y: number } }>(items: T[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.rect.y - b.rect.y) > 0.01) { return a.rect.y - b.rect.y; }
    if (Math.abs(a.rect.x - b.rect.x) > 0.01) { return a.rect.x - b.rect.x; }
    return a.id.localeCompare(b.id);
  });
  return new Map(sorted.map((item, index) => [item.id, index]));
}

function findNearestAvailableRow(target: number, used: Set<number>): number {
  const rounded = Math.max(0, Math.round(target));
  if (!used.has(rounded)) { return rounded; }
  for (let offset = 1; offset < 1000; offset += 1) {
    const lower = rounded - offset;
    if (lower >= 0 && !used.has(lower)) { return lower; }
    const upper = rounded + offset;
    if (!used.has(upper)) { return upper; }
  }
  return rounded;
}

function assignDiscreteRows<T extends { id: string; desiredRow: number; order: number }>(items: T[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.desiredRow - b.desiredRow) > 0.01) { return a.desiredRow - b.desiredRow; }
    if (a.order !== b.order) { return a.order - b.order; }
    return a.id.localeCompare(b.id);
  });
  const usedRows = new Set<number>();
  const rows = new Map<string, number>();
  for (const item of sorted) {
    const row = findNearestAvailableRow(item.desiredRow, usedRows);
    usedRows.add(row);
    rows.set(item.id, row);
  }
  return rows;
}

function distributeVertically<T extends { id: string; desiredY: number; height: number; order: number }>(
  items: T[],
  gap: number,
): Map<string, number> {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.desiredY - b.desiredY) > 0.01) { return a.desiredY - b.desiredY; }
    if (a.order !== b.order) { return a.order - b.order; }
    return a.id.localeCompare(b.id);
  });
  const result = new Map<string, number>();
  let cursor = Number.NEGATIVE_INFINITY;
  for (const item of sorted) {
    const nextY = Math.max(item.desiredY, cursor);
    result.set(item.id, Math.round(nextY));
    cursor = nextY + item.height + gap;
  }
  return result;
}

function computeRowPitch(definition: BlueprintDefinition): number {
  const allHeights = [
    ...definition.input_slots.map(slot => slot.rect.height),
    ...definition.function_nodes.map(node => node.rect.height),
    ...definition.data_nodes.map(node => node.rect.height),
    ...definition.output_slots.map(slot => slot.rect.height),
  ];
  const maxHeight = Math.max(...allHeights, MIN_ROW_PITCH - ROW_VERTICAL_PADDING);
  return Math.max(MIN_ROW_PITCH, maxHeight + ROW_VERTICAL_PADDING);
}

function topForRow(row: number, rowPitch: number, height: number): number {
  return Math.round((row * rowPitch) + ((rowPitch - height) / 2));
}

export function optimizeBlueprintDefinitionLayout<T extends BlueprintDefinition>(definition: T): T {
  if (definition.function_nodes.length === 0) {
    return definition;
  }

  const rowPitch = computeRowPitch(definition);
  const functionRanks = buildFunctionRanks(definition);
  const rankIds = Array.from(new Set(Array.from(functionRanks.values()))).sort((a, b) => a - b);
  const functionsByRank = new Map<number, BlueprintFunctionNodeDef[]>();
  for (const fnNode of definition.function_nodes) {
    const rank = functionRanks.get(fnNode.id) ?? 0;
    const list = functionsByRank.get(rank) ?? [];
    list.push(fnNode);
    functionsByRank.set(rank, list);
  }

  const functionOrder = rankItemsByOriginalOrder(definition.function_nodes);
  const inputOrder = rankItemsByOriginalOrder(definition.input_slots);
  const outputOrder = rankItemsByOriginalOrder(definition.output_slots);
  const dataOrder = rankItemsByOriginalOrder(definition.data_nodes);

  const dataNodeById = new Map(definition.data_nodes.map(node => [node.id, node]));
  const intermediateById = new Map(definition.intermediate_slots.map(slot => [slot.id, slot]));
  const functionPredecessors = new Map<string, string[]>();
  const functionConsumersByInput = new Map<string, string[]>();
  const functionConsumersByData = new Map<string, string[]>();
  const outputProducersBySlot = new Map<string, string[]>();

  for (const fnNode of definition.function_nodes) {
    functionPredecessors.set(fnNode.id, []);
  }

  for (const edge of definition.edges) {
    if (edge.target.kind === 'function_node') {
      if (edge.source.kind === 'input_slot') {
        const list = functionConsumersByInput.get(edge.source.id) ?? [];
        list.push(edge.target.id);
        functionConsumersByInput.set(edge.source.id, list);
      }
      if (edge.source.kind === 'data_node') {
        const list = functionConsumersByData.get(edge.source.id) ?? [];
        list.push(edge.target.id);
        functionConsumersByData.set(edge.source.id, list);
      }
      const sourceFunctionId = resolveSourceFunctionId(edge.source, dataNodeById, intermediateById);
      if (sourceFunctionId && sourceFunctionId !== edge.target.id) {
        const list = functionPredecessors.get(edge.target.id) ?? [];
        list.push(sourceFunctionId);
        functionPredecessors.set(edge.target.id, list);
      }
    }
    if (edge.target.kind === 'output_slot' && edge.source.kind === 'function_node') {
      const list = outputProducersBySlot.get(edge.target.id) ?? [];
      list.push(edge.source.id);
      outputProducersBySlot.set(edge.target.id, list);
    }
  }

  const functionRows = new Map<string, number>();
  for (const rank of rankIds) {
    const fnNodes = functionsByRank.get(rank) ?? [];
    const assigned = assignDiscreteRows(fnNodes.map((node, index) => {
      const predecessors = functionPredecessors.get(node.id) ?? [];
      const predecessorRows = predecessors
        .map(id => functionRows.get(id))
        .filter((value): value is number => value !== undefined);
      return {
        id: node.id,
        desiredRow: predecessorRows.length > 0
          ? average(predecessorRows, index)
          : (functionOrder.get(node.id) ?? index),
        order: functionOrder.get(node.id) ?? index,
      };
    }));
    for (const node of fnNodes) {
      functionRows.set(node.id, assigned.get(node.id) ?? 0);
    }
  }

  const dataNodesBySourceFn = new Map<string, BlueprintDataNodeDef[]>();
  for (const dataNode of definition.data_nodes) {
    if (!dataNode.source_function_node_id) { continue; }
    const list = dataNodesBySourceFn.get(dataNode.source_function_node_id) ?? [];
    list.push(dataNode);
    dataNodesBySourceFn.set(dataNode.source_function_node_id, list);
  }

  const dataRows = new Map<string, number>();
  for (const rank of rankIds) {
    const producerNodes = functionsByRank.get(rank) ?? [];
    const producedDataNodes = producerNodes.flatMap(node => dataNodesBySourceFn.get(node.id) ?? []);
    if (producedDataNodes.length === 0) { continue; }
    const assigned = assignDiscreteRows(producedDataNodes.map((dataNode, index) => {
      const sourceRow = dataNode.source_function_node_id ? (functionRows.get(dataNode.source_function_node_id) ?? index) : index;
      const consumerRows = (functionConsumersByData.get(dataNode.id) ?? [])
        .map(id => functionRows.get(id))
        .filter((value): value is number => value !== undefined);
      return {
        id: dataNode.id,
        desiredRow: consumerRows.length > 0 ? average([sourceRow, ...consumerRows], sourceRow) : sourceRow,
        order: dataOrder.get(dataNode.id) ?? index,
      };
    }));
    for (const dataNode of producedDataNodes) {
      dataRows.set(dataNode.id, assigned.get(dataNode.id) ?? 0);
    }
  }

  const inputRows = assignDiscreteRows(definition.input_slots.map((slot, index) => {
    const consumerRows = (functionConsumersByInput.get(slot.id) ?? [])
      .map(id => functionRows.get(id))
      .filter((value): value is number => value !== undefined);
    return {
      id: slot.id,
      desiredRow: consumerRows.length > 0 ? average(consumerRows, index) : (inputOrder.get(slot.id) ?? index),
      order: inputOrder.get(slot.id) ?? index,
    };
  }));

  const outputRows = assignDiscreteRows(definition.output_slots.map((slot, index) => {
    const producerRows = (outputProducersBySlot.get(slot.id) ?? [])
      .map(id => functionRows.get(id))
      .filter((value): value is number => value !== undefined);
    return {
      id: slot.id,
      desiredRow: producerRows.length > 0 ? average(producerRows, index) : (outputOrder.get(slot.id) ?? index),
      order: outputOrder.get(slot.id) ?? index,
    };
  }));

  const effectiveInputSlotSize = new Map(
    definition.input_slots.map(slot => [slot.id, getEffectiveInputSlotSize(slot)]),
  );
  const maxInputWidth = Math.max(
    250,
    ...definition.input_slots.map(slot => effectiveInputSlotSize.get(slot.id)?.width ?? slot.rect.width),
    0,
  );
  const maxOutputWidth = Math.max(240, ...definition.output_slots.map(slot => slot.rect.width), 0);
  const rankWidth = new Map<number, number>();
  const rankDataWidth = new Map<number, number>();
  for (const rank of rankIds) {
    const fnNodes = functionsByRank.get(rank) ?? [];
    rankWidth.set(rank, Math.max(280, ...fnNodes.map(node => node.rect.width), 0));
    rankDataWidth.set(
      rank,
      Math.max(
        0,
        ...fnNodes.flatMap(node => (dataNodesBySourceFn.get(node.id) ?? []).map(dataNode => dataNode.rect.width)),
      ),
    );
  }

  const functionX = new Map<string, number>();
  let cursorX = maxInputWidth + INPUT_TO_FUNCTION_GAP;
  for (const rank of rankIds) {
    for (const node of functionsByRank.get(rank) ?? []) {
      functionX.set(node.id, cursorX);
    }
    cursorX += (rankWidth.get(rank) ?? 280) + Math.max(FUNCTION_TO_DATA_GAP + (rankDataWidth.get(rank) ?? 0) + DATA_TO_NEXT_FUNCTION_GAP, 260);
  }

  const functionLayouts = new Map<string, NodeLayout>();
  for (const node of definition.function_nodes) {
    functionLayouts.set(node.id, {
      x: functionX.get(node.id) ?? 0,
      y: topForRow(functionRows.get(node.id) ?? 0, rowPitch, node.rect.height),
      width: node.rect.width,
      height: node.rect.height,
    });
  }

  const inputLayouts = new Map<string, NodeLayout>();
  const compactInputY = distributeVertically(definition.input_slots.map((slot, index) => {
    const slotSize = effectiveInputSlotSize.get(slot.id) ?? { width: slot.rect.width, height: slot.rect.height };
    const consumerRows = (functionConsumersByInput.get(slot.id) ?? [])
      .map(id => functionRows.get(id))
      .filter((value): value is number => value !== undefined);
    const desiredCenter = consumerRows.length > 0
      ? average(
          consumerRows.map(row => centerY({
            y: topForRow(row, rowPitch, slotSize.height),
            height: slotSize.height,
          })),
          centerY({ y: slot.rect.y, height: slotSize.height }),
        )
      : centerY({ y: slot.rect.y, height: slotSize.height });
    return {
      id: slot.id,
      desiredY: topFromCenter(desiredCenter, slotSize.height),
      height: slotSize.height,
      order: inputOrder.get(slot.id) ?? index,
    };
  }), INPUT_VERTICAL_GAP);
  for (const slot of definition.input_slots) {
    const slotSize = effectiveInputSlotSize.get(slot.id) ?? { width: slot.rect.width, height: slot.rect.height };
    inputLayouts.set(slot.id, {
      x: 0,
      y: compactInputY.get(slot.id) ?? topForRow(inputRows.get(slot.id) ?? 0, rowPitch, slotSize.height),
      width: slotSize.width,
      height: slotSize.height,
    });
  }

  const dataLayouts = new Map<string, NodeLayout>();
  for (const dataNode of definition.data_nodes) {
    const sourceRank = dataNode.source_function_node_id ? (functionRanks.get(dataNode.source_function_node_id) ?? 0) : 0;
    const sourceFnX = dataNode.source_function_node_id ? (functionX.get(dataNode.source_function_node_id) ?? 0) : 0;
    dataLayouts.set(dataNode.id, {
      x: sourceFnX + (rankWidth.get(sourceRank) ?? 280) + FUNCTION_TO_DATA_GAP,
      y: topForRow(dataRows.get(dataNode.id) ?? 0, rowPitch, dataNode.rect.height),
      width: dataNode.rect.width,
      height: dataNode.rect.height,
    });
  }

  const maxFunctionOrDataX = Math.max(
    ...definition.function_nodes.map(node => {
      const rank = functionRanks.get(node.id) ?? 0;
      const fnX = functionX.get(node.id) ?? 0;
      const producedDataWidth = rankDataWidth.get(rank) ?? 0;
      return fnX + (rankWidth.get(rank) ?? node.rect.width) + (producedDataWidth > 0 ? (FUNCTION_TO_DATA_GAP + producedDataWidth) : 0);
    }),
    maxInputWidth,
  );
  const outputColumnX = maxFunctionOrDataX + OUTPUT_GAP;

  const outputLayouts = new Map<string, NodeLayout>();
  for (const slot of definition.output_slots) {
    outputLayouts.set(slot.id, {
      x: outputColumnX,
      y: topForRow(outputRows.get(slot.id) ?? 0, rowPitch, slot.rect.height),
      width: slot.rect.width,
      height: slot.rect.height,
    });
  }

  const intermediateLayouts = new Map<string, NodeLayout>();
  for (const slot of definition.intermediate_slots) {
    const dataNode = definition.data_nodes.find(node => node.source_node_id === slot.source_node_id);
    const matchedLayout = dataNode ? dataLayouts.get(dataNode.id) : undefined;
    intermediateLayouts.set(slot.id, matchedLayout ?? {
      x: slot.rect.x,
      y: slot.rect.y,
      width: slot.rect.width,
      height: slot.rect.height,
    });
  }

  const allLayouts = [
    ...inputLayouts.values(),
    ...functionLayouts.values(),
    ...dataLayouts.values(),
    ...outputLayouts.values(),
    ...intermediateLayouts.values(),
  ];
  const minX = Math.min(...allLayouts.map(layout => layout.x), 0);
  const minY = Math.min(...allLayouts.map(layout => layout.y), 0);
  const shiftX = minX < 0 ? -minX : 0;
  const shiftY = minY < 0 ? -minY : 0;

  const patchRect = (layout: NodeLayout | undefined, fallback: { x: number; y: number; width: number; height: number }) => ({
    x: Math.round((layout?.x ?? fallback.x) + shiftX),
    y: Math.round((layout?.y ?? fallback.y) + shiftY),
    width: Math.round(layout?.width ?? fallback.width),
    height: Math.round(layout?.height ?? fallback.height),
  });

  return {
    ...definition,
    input_slots: definition.input_slots.map(slot => ({
      ...slot,
      rect: patchRect(inputLayouts.get(slot.id), slot.rect),
    })),
    intermediate_slots: definition.intermediate_slots.map(slot => ({
      ...slot,
      rect: patchRect(intermediateLayouts.get(slot.id), slot.rect),
    })),
    output_slots: definition.output_slots.map(slot => ({
      ...slot,
      rect: patchRect(outputLayouts.get(slot.id), slot.rect),
    })),
    data_nodes: definition.data_nodes.map(node => ({
      ...node,
      rect: patchRect(dataLayouts.get(node.id), node.rect),
    })),
    function_nodes: definition.function_nodes.map(node => ({
      ...node,
      rect: patchRect(functionLayouts.get(node.id), node.rect),
    })),
  };
}
