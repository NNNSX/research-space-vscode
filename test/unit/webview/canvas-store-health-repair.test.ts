import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasFile, CanvasNode } from '../../../src/core/canvas-model';

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

async function loadBridgeMock() {
  return import('../../../webview/src/bridge');
}

function node(id: string, nodeType: CanvasNode['node_type'] = 'note'): CanvasNode {
  return {
    id,
    node_type: nodeType,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 280, height: 160 },
    meta: {},
  };
}

function buildCanvasWithLowRiskIssues(): CanvasFile {
  return {
    version: '1.0',
    nodes: [node('a'), node('b'), node('hub', 'group_hub')],
    edges: [
      { id: 'valid-edge', source: 'a', target: 'b', edge_type: 'data_flow' },
      { id: 'valid-hub-edge', source: 'a', target: 'hub', edge_type: 'hub_member' },
      { id: 'dangling-edge', source: 'a', target: 'ghost', edge_type: 'data_flow' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title: 'health-store',
      created_at: '2026-04-26T00:00:00.000Z',
      updated_at: '2026-04-26T00:00:00.000Z',
    },
    boards: [],
    nodeGroups: [
      {
        id: 'group-1',
        name: '组 1',
        hubNodeId: 'hub',
        nodeIds: ['a', 'ghost-member', 'b', 'b'],
        bounds: { x: 0, y: 0, width: 400, height: 240 },
        collapsed: false,
      },
    ],
    stagingNodes: [],
  };
}

describe('canvas-store health repair integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies low-risk health repairs through the store, pushes undo, and immediately saves', async () => {
    const { useCanvasStore } = await loadFreshCanvasStore();
    const bridge = await loadBridgeMock();
    const canvas = buildCanvasWithLowRiskIssues();

    const cleanCanvas = clone(canvas);
    cleanCanvas.edges = cleanCanvas.edges.filter(edge => edge.id !== 'dangling-edge');
    cleanCanvas.nodeGroups![0].nodeIds = ['a', 'b'];
    useCanvasStore.getState().initCanvas(cleanCanvas, '/tmp/research-space');
    useCanvasStore.setState({
      canvasFile: clone(canvas),
      nodeGroups: clone(canvas.nodeGroups ?? []),
      selectedNodeIds: ['a', 'hub'],
    });
    vi.mocked(bridge.postMessage).mockClear();

    const result = useCanvasStore.getState().applyLowRiskCanvasHealthRepairs();

    expect(result).toMatchObject({
      changed: true,
      appliedCount: 3,
    });
    expect(result.actions).toEqual([
      '移除悬挂连线“dangling-edge”。',
      '从节点组“组 1”移除缺失成员引用“ghost-member”。',
      '从节点组“组 1”移除重复成员引用“b”。',
    ]);

    const state = useCanvasStore.getState();
    expect(state.canvasFile?.edges.map(edge => edge.id)).toEqual(['valid-edge', 'valid-hub-edge']);
    expect(state.canvasFile?.nodeGroups?.[0].nodeIds).toEqual(['a', 'b']);
    expect(state.edges.map(edge => edge.id)).toEqual(['valid-edge', 'valid-hub-edge']);
    expect(state.nodeGroups[0].nodeIds).toEqual(['a', 'b']);
    expect(state.selectedNodeIds).toEqual([]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack[0].edges.map(edge => edge.id)).toEqual(['valid-edge', 'valid-hub-edge', 'dangling-edge']);
    expect(state.undoStack[0].nodeGroups?.[0].nodeIds).toEqual(['a', 'ghost-member', 'b', 'b']);

    const calls = vi.mocked(bridge.postMessage).mock.calls.map(([message]) => message);
    expect(calls.some(message => message?.type === 'canvasStateSync')).toBe(true);
    expect(calls.some(message =>
      message?.type === 'canvasChanged' &&
      message.data?.edges.every(edge => edge.id !== 'dangling-edge') &&
      message.data?.nodeGroups?.[0]?.nodeIds.join(',') === 'a,b'
    )).toBe(true);
  });

  it('keeps clean canvas unchanged and does not create undo or save messages', async () => {
    const { useCanvasStore } = await loadFreshCanvasStore();
    const bridge = await loadBridgeMock();
    const canvas = buildCanvasWithLowRiskIssues();
    canvas.edges = canvas.edges.filter(edge => edge.id !== 'dangling-edge');
    canvas.nodeGroups![0].nodeIds = ['a', 'b'];

    useCanvasStore.getState().initCanvas(clone(canvas), '/tmp/research-space');
    vi.mocked(bridge.postMessage).mockClear();

    const result = useCanvasStore.getState().applyLowRiskCanvasHealthRepairs();

    expect(result).toEqual({ changed: false, appliedCount: 0, actions: [] });
    expect(useCanvasStore.getState().undoStack).toEqual([]);
    expect(vi.mocked(bridge.postMessage)).not.toHaveBeenCalled();
  });
});
