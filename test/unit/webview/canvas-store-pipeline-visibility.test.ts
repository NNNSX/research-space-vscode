import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../src/core/canvas-model';
import { loadCanvasFixture } from '../helpers/load-canvas-fixture';

vi.mock('../../../webview/src/bridge', () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(() => () => {}),
  saveState: vi.fn(),
  getState: vi.fn(() => null),
}));

async function loadFreshCanvasStore() {
  vi.resetModules();
  return import('../../../webview/src/stores/canvas-store');
}

describe('canvas-store blueprint pipeline visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps blueprint internal pipeline runtime outputs hidden instead of binding them as final outputs', async () => {
    const canvas = loadCanvasFixture('blueprint-pipeline-hidden.rsws');
    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    const normalized = useCanvasStore.getState().canvasFile;
    const runtimeNode = normalized?.nodes.find((node: CanvasNode) => node.id === 'runtime-output');
    const runtimeFlowNode = useCanvasStore.getState().nodes.find(node => node.id === 'runtime-output');

    expect(runtimeNode).toBeTruthy();
    expect(runtimeNode?.meta?.blueprint_instance_id).toBe('inst-pipeline-hidden');
    expect(runtimeNode?.meta?.blueprint_runtime_hidden).toBe(true);
    expect(runtimeNode?.meta?.blueprint_bound_slot_kind).toBeUndefined();
    expect(runtimeFlowNode?.hidden).toBe(true);
  });
});
