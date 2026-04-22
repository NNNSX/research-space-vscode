import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../../src/core/canvas-model';
import { loadCanvasFixture } from '../helpers/load-canvas-fixture';

vi.mock('../../../webview/src/bridge', () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(() => () => {}),
  saveState: vi.fn(),
  getState: vi.fn(() => null),
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function loadFreshCanvasStore() {
  vi.resetModules();
  return import('../../../webview/src/stores/canvas-store');
}

function snapshotBoundOutputs(nodes: CanvasNode[], edges: CanvasEdge[]) {
  return {
    outputs: nodes
      .filter(node =>
        node.meta?.blueprint_bound_instance_id === 'inst-stable-output' &&
        node.meta?.blueprint_bound_slot_kind === 'output' &&
        node.meta?.blueprint_bound_slot_id === 'output_slot_summary'
      )
      .map(node => ({
        id: node.id,
        position: node.position,
        file_path: node.file_path,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    bindings: edges
      .filter(edge =>
        edge.source === 'output-placeholder' &&
        edge.edge_type === 'data_flow' &&
        edge.role === 'output_slot_summary'
      )
      .map(edge => edge.target)
      .sort(),
  };
}

describe('canvas-store blueprint output history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves blueprint final output history across reruns and reopen', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));
    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');

    useCanvasStore.getState().finishAiRun(
      'run-history-2',
      {
        id: 'bound-output-2',
        node_type: 'ai_output',
        title: '摘要结果（第二次）',
        position: { x: 0, y: 0 },
        size: { width: 240, height: 160 },
        file_path: 'outputs/summary_0421_123456.md',
        meta: {
          ai_provider: 'copilot',
          ai_model: 'gpt-4.1',
        },
      },
      {
        id: 'edge-fn-to-output-2',
        source: 'fn-summary',
        target: 'bound-output-2',
        edge_type: 'ai_generated',
      },
    );

    const firstCanvas = clone(useCanvasStore.getState().canvasFile);
    const placeholder = firstCanvas?.nodes.find(node => node.id === 'output-placeholder');
    const oldOutput = firstCanvas?.nodes.find(node => node.id === 'bound-output');
    const newOutput = firstCanvas?.nodes.find(node => node.id === 'bound-output-2');

    expect(placeholder).toBeTruthy();
    expect(oldOutput).toBeTruthy();
    expect(newOutput).toBeTruthy();
    expect(firstCanvas?.nodes.filter(node =>
      node.meta?.blueprint_bound_instance_id === 'inst-stable-output' &&
      node.meta?.blueprint_bound_slot_kind === 'output' &&
      node.meta?.blueprint_bound_slot_id === 'output_slot_summary'
    )).toHaveLength(2);

    const expectedX = (placeholder?.position.x ?? 0) + (placeholder?.size.width ?? 0) + 72;
    expect(oldOutput?.position.x).toBe(expectedX);
    expect(newOutput?.position.x).toBe(expectedX);
    expect(newOutput?.position.y).toBe((oldOutput?.position.y ?? 0) + 36);
    expect(firstCanvas?.edges.filter(edge =>
      edge.source === 'fn-summary' &&
      edge.target === 'output-placeholder' &&
      edge.edge_type === 'ai_generated'
    )).toHaveLength(1);
    expect(firstCanvas?.edges.filter(edge =>
      edge.source === 'output-placeholder' &&
      edge.edge_type === 'data_flow' &&
      edge.role === 'output_slot_summary'
    )).toHaveLength(2);

    const firstSnapshot = snapshotBoundOutputs(firstCanvas?.nodes ?? [], firstCanvas?.edges ?? []);

    useCanvasStore.getState().initCanvas(clone(firstCanvas!), '/tmp/research-space');
    const reopenedCanvas = clone(useCanvasStore.getState().canvasFile);
    const reopenedSnapshot = snapshotBoundOutputs(reopenedCanvas?.nodes ?? [], reopenedCanvas?.edges ?? []);

    expect(reopenedSnapshot).toEqual(firstSnapshot);
  });
});
