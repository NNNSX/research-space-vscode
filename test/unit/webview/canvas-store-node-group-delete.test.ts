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

function buildNode(id: string, x: number, y: number): CanvasNode {
  return {
    id,
    node_type: 'note',
    title: id,
    position: { x, y },
    size: { width: 280, height: 160 },
    meta: { content_preview: id },
  };
}

function buildCanvas(): CanvasFile {
  const nodeA = buildNode('note-a', 100, 100);
  const nodeB = buildNode('note-b', 420, 100);
  const nodeC = buildNode('note-c', 740, 100);
  const consumer: CanvasNode = {
    id: 'consumer',
    node_type: 'function',
    title: '总结',
    position: { x: 1100, y: 100 },
    size: { width: 280, height: 220 },
    meta: {
      ai_tool: 'summarize',
      fn_status: 'idle',
    },
  };
  const mainHub: CanvasNode = {
    id: 'hub-main',
    node_type: 'group_hub',
    title: '主组',
    position: { x: 60, y: 60 },
    size: { width: 720, height: 260 },
    meta: {
      hub_group_id: 'group-main',
      input_order: ['note-a', 'note-b'],
    },
  };
  const secondaryHub: CanvasNode = {
    id: 'hub-secondary',
    node_type: 'group_hub',
    title: '副组',
    position: { x: 380, y: 60 },
    size: { width: 720, height: 260 },
    meta: {
      hub_group_id: 'group-secondary',
      input_order: ['note-b', 'note-c'],
    },
  };

  return {
    version: '1.0',
    nodes: [nodeA, nodeB, nodeC, consumer, mainHub, secondaryHub],
    edges: [
      { id: 'edge-a-main', source: 'note-a', target: 'hub-main', edge_type: 'hub_member' },
      { id: 'edge-b-main', source: 'note-b', target: 'hub-main', edge_type: 'hub_member' },
      { id: 'edge-b-secondary', source: 'note-b', target: 'hub-secondary', edge_type: 'hub_member' },
      { id: 'edge-c-secondary', source: 'note-c', target: 'hub-secondary', edge_type: 'hub_member' },
      { id: 'edge-main-consumer', source: 'hub-main', target: 'consumer', edge_type: 'data_flow' },
      { id: 'edge-b-consumer', source: 'note-b', target: 'consumer', edge_type: 'data_flow' },
      { id: 'edge-secondary-consumer', source: 'hub-secondary', target: 'consumer', edge_type: 'data_flow' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title: 'group-delete',
      created_at: '2026-04-24T00:00:00.000Z',
      updated_at: '2026-04-24T00:00:00.000Z',
    },
    nodeGroups: [
      {
        id: 'group-main',
        name: '主组',
        hubNodeId: 'hub-main',
        nodeIds: ['note-a', 'note-b'],
        bounds: { x: 60, y: 60, width: 720, height: 260 },
        collapsed: false,
      },
      {
        id: 'group-secondary',
        name: '副组',
        hubNodeId: 'hub-secondary',
        nodeIds: ['note-b', 'note-c'],
        bounds: { x: 380, y: 60, width: 720, height: 260 },
        collapsed: false,
      },
    ],
    boards: [],
    stagingNodes: [],
  };
}

describe('canvas-store node group delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes only the group shell by default and keeps member content', async () => {
    const { useCanvasStore } = await loadFreshCanvasStore();
    useCanvasStore.getState().initCanvas(clone(buildCanvas()), '/tmp/research-space');
    useCanvasStore.getState().setSelectedNodeIds(['hub-main', 'note-b', 'hub-secondary']);

    useCanvasStore.getState().deleteNodeGroup('group-main');

    const state = useCanvasStore.getState();
    const nextCanvas = clone(state.canvasFile);
    expect(nextCanvas?.nodeGroups?.map(group => group.id)).toEqual(['group-secondary']);
    expect(nextCanvas?.nodes.some(node => node.id === 'hub-main')).toBe(false);
    expect(nextCanvas?.nodes.some(node => node.id === 'note-a')).toBe(true);
    expect(nextCanvas?.nodes.some(node => node.id === 'note-b')).toBe(true);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-main-consumer')).toBe(false);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-a-main')).toBe(false);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-b-main')).toBe(false);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-b-consumer')).toBe(true);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-secondary-consumer')).toBe(true);
    expect(state.selectedNodeIds).toEqual(['note-b', 'hub-secondary']);
  });

  it('can delete the group together with its content and prune other affected groups', async () => {
    const { useCanvasStore } = await loadFreshCanvasStore();
    useCanvasStore.getState().initCanvas(clone(buildCanvas()), '/tmp/research-space');
    useCanvasStore.getState().setSelectedNodeIds(['hub-main', 'note-b', 'hub-secondary']);

    useCanvasStore.getState().deleteNodeGroup('group-main', 'group-and-content');

    const state = useCanvasStore.getState();
    const nextCanvas = clone(state.canvasFile);
    expect(nextCanvas?.nodeGroups).toHaveLength(1);
    expect(nextCanvas?.nodeGroups?.[0]).toMatchObject({
      id: 'group-secondary',
      nodeIds: ['note-c'],
    });
    expect(nextCanvas?.nodes.some(node => node.id === 'hub-main')).toBe(false);
    expect(nextCanvas?.nodes.some(node => node.id === 'note-a')).toBe(false);
    expect(nextCanvas?.nodes.some(node => node.id === 'note-b')).toBe(false);
    expect(nextCanvas?.nodes.some(node => node.id === 'note-c')).toBe(true);
    expect(nextCanvas?.nodes.some(node => node.id === 'hub-secondary')).toBe(true);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-main-consumer')).toBe(false);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-b-consumer')).toBe(false);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-b-secondary')).toBe(false);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-c-secondary')).toBe(true);
    expect(nextCanvas?.edges.some(edge => edge.id === 'edge-secondary-consumer')).toBe(true);
    expect(state.selectedNodeIds).toEqual(['hub-secondary']);
  });
});
