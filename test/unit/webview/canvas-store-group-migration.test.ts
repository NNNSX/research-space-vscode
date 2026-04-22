import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasEdge, CanvasFile, CanvasNode } from '../../../src/core/canvas-model';

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

function hasImmediateMigrationSave(
  calls: Array<[message: { type?: string; data?: CanvasFile }]>,
  predicate: (file: CanvasFile) => boolean,
): boolean {
  return calls.some(([message]) =>
    message?.type === 'canvasChanged' &&
    !!message.data &&
    predicate(message.data)
  );
}

function listEdgesForNode(edges: CanvasEdge[], nodeId: string) {
  return edges
    .filter(edge => edge.source === nodeId || edge.target === nodeId)
    .map(edge => ({
      source: edge.source,
      target: edge.target,
      edge_type: edge.edge_type,
      role: edge.role,
    }))
    .sort((a, b) => `${a.source}:${a.target}:${a.edge_type}:${a.role ?? ''}`.localeCompare(`${b.source}:${b.target}:${b.edge_type}:${b.role ?? ''}`));
}

describe('canvas-store node group migration regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes stale group hubs and every attached edge when no nodeGroups remain', async () => {
    const legacyCanvas: CanvasFile = {
      version: '1.0',
      nodes: [
        {
          id: 'input-note',
          node_type: 'note',
          title: '输入',
          position: { x: 80, y: 100 },
          size: { width: 240, height: 160 },
          file_path: 'notes/input.md',
        },
        {
          id: 'summarize-fn',
          node_type: 'function',
          title: '摘要',
          position: { x: 480, y: 100 },
          size: { width: 280, height: 220 },
          meta: {
            ai_tool: 'summarize',
            param_values: {},
            fn_status: 'idle',
          },
        },
        {
          id: 'stale-hub',
          node_type: 'group_hub',
          title: '残留节点组',
          position: { x: 40, y: 70 },
          size: { width: 360, height: 240 },
          meta: {
            hub_group_id: 'deleted-group',
            input_order: ['input-note'],
          },
        },
      ],
      edges: [
        {
          id: 'edge-member-hub',
          source: 'input-note',
          target: 'stale-hub',
          edge_type: 'hub_member',
        },
        {
          id: 'edge-hub-function',
          source: 'stale-hub',
          target: 'summarize-fn',
          edge_type: 'data_flow',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        title: 'stale-group-hub',
        created_at: '2026-04-21T00:00:00.000Z',
        updated_at: '2026-04-21T00:00:00.000Z',
      },
      nodeGroups: [],
    };

    const { useCanvasStore } = await loadFreshCanvasStore();
    const bridge = await loadBridgeMock();

    useCanvasStore.getState().initCanvas(clone(legacyCanvas), '/tmp/research-space');
    const normalized = clone(useCanvasStore.getState().canvasFile);

    expect(normalized?.nodeGroups).toEqual([]);
    expect(normalized?.nodes.some(node => node.id === 'stale-hub')).toBe(false);
    expect(normalized?.edges).toEqual([]);
    expect(hasImmediateMigrationSave(
      vi.mocked(bridge.postMessage).mock.calls as Array<[message: { type?: string; data?: CanvasFile }]>,
      file => !file.nodes.some(node => node.id === 'stale-hub') && file.edges.length === 0,
    )).toBe(true);
  });

  it('recalculates legacy nodeGroups, prunes stale members, and keeps only valid hub edges', async () => {
    const legacyCanvas: CanvasFile = {
      version: '1.0',
      nodes: [
        {
          id: 'member-a',
          node_type: 'note',
          title: '材料 A',
          position: { x: 100, y: 100 },
          size: { width: 240, height: 160 },
          file_path: 'notes/a.md',
        },
        {
          id: 'member-b',
          node_type: 'note',
          title: '材料 B',
          position: { x: 420, y: 140 },
          size: { width: 240, height: 160 },
          file_path: 'notes/b.md',
        },
        {
          id: 'summarize-fn',
          node_type: 'function',
          title: '摘要',
          position: { x: 860, y: 120 },
          size: { width: 280, height: 220 },
          meta: {
            ai_tool: 'summarize',
            param_values: {},
            fn_status: 'idle',
          },
        },
        {
          id: 'group-hub-1',
          node_type: 'group_hub',
          title: '旧节点组',
          position: { x: 0, y: 0 },
          size: { width: 120, height: 120 },
          meta: {
            hub_group_id: 'group-1',
            input_order: ['member-a', 'member-b'],
          },
        },
        {
          id: 'stale-hub',
          node_type: 'group_hub',
          title: '脏 hub',
          position: { x: 40, y: 40 },
          size: { width: 200, height: 140 },
          meta: {
            hub_group_id: 'ghost-group',
          },
        },
      ],
      edges: [
        {
          id: 'edge-member-a-hub',
          source: 'member-a',
          target: 'group-hub-1',
          edge_type: 'hub_member',
        },
        {
          id: 'edge-ghost-hub',
          source: 'ghost-member',
          target: 'group-hub-1',
          edge_type: 'hub_member',
        },
        {
          id: 'edge-stale-hub-function',
          source: 'stale-hub',
          target: 'summarize-fn',
          edge_type: 'data_flow',
        },
        {
          id: 'edge-group-hub-function',
          source: 'group-hub-1',
          target: 'summarize-fn',
          edge_type: 'data_flow',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        title: 'legacy-node-group',
        created_at: '2026-04-21T00:00:00.000Z',
        updated_at: '2026-04-21T00:00:00.000Z',
      },
      nodeGroups: [
        {
          id: 'group-1',
          name: '旧节点组',
          hubNodeId: 'group-hub-1',
          nodeIds: ['member-a', 'member-a', 'missing-node', 'group-hub-1', 'member-b'],
          bounds: { x: 0, y: 0, width: 120, height: 120 },
          collapsed: false,
        },
      ],
    };

    const { useCanvasStore } = await loadFreshCanvasStore();
    const bridge = await loadBridgeMock();

    useCanvasStore.getState().initCanvas(clone(legacyCanvas), '/tmp/research-space');
    const normalized = clone(useCanvasStore.getState().canvasFile);
    const group = normalized?.nodeGroups?.[0];
    const hubNode = normalized?.nodes.find(node => node.id === 'group-hub-1');

    expect(normalized?.nodeGroups).toHaveLength(1);
    expect(group).toMatchObject({
      id: 'group-1',
      name: '旧节点组',
      hubNodeId: 'group-hub-1',
      nodeIds: ['member-a', 'member-b'],
      bounds: { x: 70, y: 70, width: 620, height: 260 },
      collapsed: false,
    });
    expect(hubNode).toMatchObject({
      id: 'group-hub-1',
      node_type: 'group_hub',
      title: '旧节点组',
      position: { x: 70, y: 70 },
      size: { width: 620, height: 260 },
      meta: {
        hub_group_id: 'group-1',
        input_order: ['member-a', 'member-b'],
      },
    });
    expect(normalized?.nodes.some(node => node.id === 'stale-hub')).toBe(false);
    expect(listEdgesForNode(normalized?.edges ?? [], 'group-hub-1')).toEqual([
      { source: 'group-hub-1', target: 'summarize-fn', edge_type: 'data_flow', role: undefined },
      { source: 'member-a', target: 'group-hub-1', edge_type: 'hub_member', role: undefined },
      { source: 'member-b', target: 'group-hub-1', edge_type: 'hub_member', role: undefined },
    ]);
    expect((normalized?.edges ?? []).some(edge => edge.source === 'stale-hub' || edge.target === 'stale-hub')).toBe(false);
    expect(hasImmediateMigrationSave(
      vi.mocked(bridge.postMessage).mock.calls as Array<[message: { type?: string; data?: CanvasFile }]>,
      file => {
        const migratedGroup = file.nodeGroups?.[0];
        return !!migratedGroup &&
          migratedGroup.hubNodeId === 'group-hub-1' &&
          JSON.stringify(migratedGroup.nodeIds) === JSON.stringify(['member-a', 'member-b']) &&
          !file.nodes.some(node => node.id === 'stale-hub') &&
          !file.edges.some(edge => edge.source === 'stale-hub' || edge.target === 'stale-hub');
      },
    )).toBe(true);
  });
});
