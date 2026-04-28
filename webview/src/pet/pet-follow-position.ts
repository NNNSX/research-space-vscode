import type { CanvasNode } from '../../../src/core/canvas-model';

export interface PetFollowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PetFollowRect {
  width: number;
  height: number;
}

export interface PetFollowPosition {
  left: number;
  top: number;
  lowDetail: boolean;
  target: 'selection' | 'corner';
}

export function flowToScreenPoint(point: { x: number; y: number }, viewport: PetFollowViewport): { x: number; y: number } {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) { return min; }
  return Math.max(min, Math.min(value, max));
}

export function clientToContainerPoint(
  client: { x: number; y: number },
  containerRect: Pick<DOMRect, 'left' | 'top'> | null | undefined,
): { x: number; y: number } {
  return {
    x: client.x - (containerRect?.left ?? 0),
    y: client.y - (containerRect?.top ?? 0),
  };
}

export function resolvePetManualDragPosition(options: {
  client: { x: number; y: number };
  containerRect?: Pick<DOMRect, 'left' | 'top'> | null;
  dragOffset: { x: number; y: number };
  maxLeft: number;
  maxTop: number;
  margin?: number;
}): { left: number; top: number } {
  const margin = options.margin ?? 16;
  const pointer = clientToContainerPoint(options.client, options.containerRect);
  return {
    left: clamp(pointer.x - options.dragOffset.x, margin, options.maxLeft),
    top: clamp(pointer.y - options.dragOffset.y, margin, options.maxTop),
  };
}

export function resolvePetFollowPosition(options: {
  selectedNode?: CanvasNode | null;
  viewport: PetFollowViewport;
  container: PetFollowRect;
  widget: PetFollowRect;
  margin?: number;
  lowDetailZoom?: number;
}): PetFollowPosition {
  const margin = options.margin ?? 16;
  const lowDetail = options.viewport.zoom <= (options.lowDetailZoom ?? 0.18);
  if (!options.selectedNode) {
    return {
      left: margin,
      top: clamp(options.container.height - options.widget.height - margin, margin, options.container.height - options.widget.height - margin),
      lowDetail,
      target: 'corner',
    };
  }

  const node = options.selectedNode;
  const anchor = flowToScreenPoint({
    x: node.position.x + node.size.width + 14,
    y: node.position.y + Math.min(node.size.height, 96) - options.widget.height,
  }, options.viewport);

  return {
    left: clamp(anchor.x, margin, options.container.width - options.widget.width - margin),
    top: clamp(anchor.y, margin, options.container.height - options.widget.height - margin),
    lowDetail,
    target: 'selection',
  };
}
