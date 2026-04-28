import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../src/core/canvas-model';
import { clientToContainerPoint, flowToScreenPoint, resolvePetFollowPosition, resolvePetManualDragPosition } from '../../../webview/src/pet/pet-follow-position';

function node(partial: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'n1',
    node_type: 'note',
    title: '节点',
    position: { x: 100, y: 200 },
    size: { width: 180, height: 120 },
    meta: {},
    ...partial,
  } as CanvasNode;
}

describe('pet follow position', () => {
  it('converts flow coordinates to screen coordinates with viewport transform', () => {
    expect(flowToScreenPoint({ x: 100, y: 50 }, { x: 20, y: -10, zoom: 2 })).toEqual({ x: 220, y: 90 });
  });

  it('converts browser pointer coordinates into canvas container coordinates', () => {
    expect(clientToContainerPoint(
      { x: 420, y: 260 },
      { left: 120, top: 80 },
    )).toEqual({ x: 300, y: 180 });
  });

  it('places pet near selected node while keeping screen size and bounds', () => {
    const position = resolvePetFollowPosition({
      selectedNode: node(),
      viewport: { x: 10, y: 20, zoom: 1.5 },
      container: { width: 900, height: 700 },
      widget: { width: 96, height: 82 },
    });

    expect(position.target).toBe('selection');
    expect(position.lowDetail).toBe(false);
    expect(position.left).toBeGreaterThan(400);
    expect(position.top).toBeGreaterThan(200);
  });

  it('falls back to lower-left corner without selected node', () => {
    const position = resolvePetFollowPosition({
      selectedNode: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      container: { width: 900, height: 700 },
      widget: { width: 96, height: 82 },
    });

    expect(position.target).toBe('corner');
    expect(position.left).toBe(16);
    expect(position.top).toBe(602);
  });

  it('marks low detail at small zoom and clamps to visible area', () => {
    const position = resolvePetFollowPosition({
      selectedNode: node({ position: { x: 10_000, y: 10_000 } }),
      viewport: { x: 0, y: 0, zoom: 0.1 },
      container: { width: 320, height: 240 },
      widget: { width: 96, height: 82 },
    });

    expect(position.lowDetail).toBe(true);
    expect(position.left).toBe(208);
    expect(position.top).toBe(142);
  });

  it('resolves manual drag relative to the canvas container instead of the browser viewport', () => {
    expect(resolvePetManualDragPosition({
      client: { x: 430, y: 300 },
      containerRect: { left: 100, top: 60 },
      dragOffset: { x: 30, y: 20 },
      maxLeft: 600,
      maxTop: 500,
    })).toEqual({ left: 300, top: 220 });

    expect(resolvePetManualDragPosition({
      client: { x: 80, y: 40 },
      containerRect: { left: 100, top: 60 },
      dragOffset: { x: 30, y: 20 },
      maxLeft: 600,
      maxTop: 500,
    })).toEqual({ left: 16, top: 16 });
  });
});
