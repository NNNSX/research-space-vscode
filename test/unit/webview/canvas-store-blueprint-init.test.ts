import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../../src/core/canvas-model';
import { loadCanvasFixture } from '../helpers/load-canvas-fixture';

vi.mock('../../../webview/src/bridge', () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(() => () => {}),
  saveState: vi.fn(),
  getState: vi.fn(() => null),
}));

function snapshotNodes(nodes: CanvasNode[]) {
  return nodes
    .filter(node => ['bp-container', 'output-placeholder', 'bound-output'].includes(node.id))
    .map(node => ({
      id: node.id,
      position: node.position,
      meta: {
        blueprint_instance_id: node.meta?.blueprint_instance_id,
        blueprint_placeholder_kind: node.meta?.blueprint_placeholder_kind,
        blueprint_placeholder_slot_id: node.meta?.blueprint_placeholder_slot_id,
        blueprint_bound_instance_id: node.meta?.blueprint_bound_instance_id,
        blueprint_bound_slot_kind: node.meta?.blueprint_bound_slot_kind,
        blueprint_bound_slot_id: node.meta?.blueprint_bound_slot_id,
      },
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function snapshotEdges(edges: CanvasEdge[]) {
  return edges
    .map(edge => ({
      source: edge.source,
      target: edge.target,
      edge_type: edge.edge_type,
      role: edge.role,
    }))
    .sort((a, b) => `${a.source}:${a.target}:${a.edge_type}:${a.role ?? ''}`.localeCompare(`${b.source}:${b.target}:${b.edge_type}:${b.role ?? ''}`));
}

async function loadFreshCanvasStore() {
  vi.resetModules();
  return import('../../../webview/src/stores/canvas-store');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('canvas-store blueprint init stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps blueprint bound outputs outside the placeholder across repeated initCanvas calls', async () => {
    const canvas = loadCanvasFixture('blueprint-output-stable.rsws');
    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    const firstCanvas = JSON.parse(JSON.stringify(useCanvasStore.getState().canvasFile));

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    const secondCanvas = JSON.parse(JSON.stringify(useCanvasStore.getState().canvasFile));

    const firstPlaceholder = firstCanvas.nodes.find((node: CanvasNode) => node.id === 'output-placeholder');
    const firstBoundOutput = firstCanvas.nodes.find((node: CanvasNode) => node.id === 'bound-output');
    const secondPlaceholder = secondCanvas.nodes.find((node: CanvasNode) => node.id === 'output-placeholder');
    const secondBoundOutput = secondCanvas.nodes.find((node: CanvasNode) => node.id === 'bound-output');

    expect(firstPlaceholder).toBeTruthy();
    expect(firstBoundOutput).toBeTruthy();
    expect(secondPlaceholder).toBeTruthy();
    expect(secondBoundOutput).toBeTruthy();

    const expectedFirstX = firstPlaceholder.position.x + firstPlaceholder.size.width + 72;
    const expectedSecondX = secondPlaceholder.position.x + secondPlaceholder.size.width + 72;

    expect(firstBoundOutput.position.x).toBe(expectedFirstX);
    expect(secondBoundOutput.position.x).toBe(expectedSecondX);
    expect(snapshotNodes(firstCanvas.nodes)).toEqual(snapshotNodes(secondCanvas.nodes));
    expect(snapshotEdges(firstCanvas.edges)).toEqual(snapshotEdges(secondCanvas.edges));
  });

  it('keeps manually moved blueprint bound outputs stable across reopen', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));
    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    useCanvasStore.getState().onNodesChange([
      {
        id: 'bound-output',
        type: 'position',
        position: { x: 1120, y: 420 },
        dragging: false,
      },
    ]);

    const movedCanvas = clone(useCanvasStore.getState().canvasFile);
    const movedOutput = movedCanvas?.nodes.find((node: CanvasNode) => node.id === 'bound-output');

    expect(movedOutput?.position).toEqual({ x: 1120, y: 420 });
    expect(movedOutput?.meta?.blueprint_output_position_manual).toBe(true);

    useCanvasStore.getState().initCanvas(clone(movedCanvas!), '/tmp/research-space');
    const reopenedCanvas = clone(useCanvasStore.getState().canvasFile);
    const reopenedOutput = reopenedCanvas?.nodes.find((node: CanvasNode) => node.id === 'bound-output');

    expect(reopenedOutput?.position).toEqual({ x: 1120, y: 420 });
    expect(reopenedOutput?.meta?.blueprint_output_position_manual).toBe(true);
  });

  it('keeps externally moved blueprint bound outputs stable even when older files lack manual-position metadata', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));
    const boundOutput = canvas.nodes.find((node: CanvasNode) => node.id === 'bound-output');
    if (!boundOutput) {
      throw new Error('missing bound-output fixture node');
    }
    boundOutput.position = { x: 1120, y: 420 };
    if (boundOutput.meta) {
      delete boundOutput.meta.blueprint_output_position_manual;
    }

    const { useCanvasStore } = await loadFreshCanvasStore();
    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    const normalizedCanvas = clone(useCanvasStore.getState().canvasFile);
    const normalizedOutput = normalizedCanvas?.nodes.find((node: CanvasNode) => node.id === 'bound-output');

    expect(normalizedOutput?.position).toEqual({ x: 1120, y: 420 });
    expect(normalizedOutput?.meta?.blueprint_output_position_manual).toBeUndefined();
  });
});
