import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasFile, CanvasNode } from '../../../src/core/canvas-model';
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

function snapshotOverlapPersistence(canvas: CanvasFile | null | undefined) {
  const nodes = canvas?.nodes ?? [];
  const edges = canvas?.edges ?? [];
  return {
    boards: canvas?.boards,
    nodeGroups: canvas?.nodeGroups,
    nodes: nodes
      .filter(node => ['group-hub-1', 'bp-container', 'fn-summary', 'output-placeholder', 'bound-output'].includes(node.id))
      .map(node => ({
        id: node.id,
        position: node.position,
        size: node.size,
        meta: {
          blueprint_instance_id: node.meta?.blueprint_instance_id,
          blueprint_bound_instance_id: node.meta?.blueprint_bound_instance_id,
          blueprint_placeholder_kind: node.meta?.blueprint_placeholder_kind,
          blueprint_placeholder_slot_id: node.meta?.blueprint_placeholder_slot_id,
          hub_group_id: node.meta?.hub_group_id,
        },
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map(edge => ({
        source: edge.source,
        target: edge.target,
        edge_type: edge.edge_type,
        role: edge.role,
      }))
      .sort((a, b) => `${a.source}:${a.target}:${a.edge_type}:${a.role ?? ''}`.localeCompare(`${b.source}:${b.target}:${b.edge_type}:${b.role ?? ''}`)),
  };
}

function buildBoardGroupBlueprintCanvas(): CanvasFile {
  const blueprintCanvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));

  const groupNodes: CanvasNode[] = [
    {
      id: 'group-note-a',
      node_type: 'note',
      title: '资料 A',
      position: { x: 120, y: 150 },
      size: { width: 240, height: 160 },
      file_path: 'notes/group-a.md',
    },
    {
      id: 'group-note-b',
      node_type: 'note',
      title: '资料 B',
      position: { x: 420, y: 180 },
      size: { width: 240, height: 160 },
      file_path: 'notes/group-b.md',
    },
    {
      id: 'group-hub-1',
      node_type: 'group_hub',
      title: '资料组',
      position: { x: 90, y: 120 },
      size: { width: 600, height: 250 },
      meta: {
        hub_group_id: 'group-1',
        input_order: ['group-note-a', 'group-note-b'],
      },
    },
  ];

  return {
    ...blueprintCanvas,
    nodes: [...groupNodes, ...blueprintCanvas.nodes],
    edges: [
      {
        id: 'edge-group-a-hub',
        source: 'group-note-a',
        target: 'group-hub-1',
        edge_type: 'hub_member',
      },
      {
        id: 'edge-group-b-hub',
        source: 'group-note-b',
        target: 'group-hub-1',
        edge_type: 'hub_member',
      },
      {
        id: 'edge-group-hub-fn',
        source: 'group-hub-1',
        target: 'fn-summary',
        edge_type: 'data_flow',
      },
      ...blueprintCanvas.edges,
    ],
    boards: [
      {
        id: 'board-main',
        name: '综合区域',
        color: 'rgba(79,195,247,0.12)',
        borderColor: '#4fc3f7',
        bounds: { x: 40, y: 80, width: 980, height: 500 },
      },
    ],
    nodeGroups: [
      {
        id: 'group-1',
        name: '资料组',
        hubNodeId: 'group-hub-1',
        nodeIds: ['group-note-a', 'group-note-b'],
        bounds: { x: 90, y: 120, width: 600, height: 250 },
        collapsed: false,
      },
    ],
  };
}

describe('canvas-store overlap persistence regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps board + nodeGroup + blueprint structure stable after moving the board and reopening', async () => {
    const canvas = buildBoardGroupBlueprintCanvas();
    const { useCanvasStore, startBoardDrag, endBoardDrag } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(clone(canvas), '/tmp/research-space');
    const initialState = useCanvasStore.getState();

    startBoardDrag('board-main', initialState.nodes, initialState.boards);
    useCanvasStore.getState().moveBoard('board-main', 160, 90);
    endBoardDrag();

    const movedCanvas = clone(useCanvasStore.getState().canvasFile);

    useCanvasStore.getState().initCanvas(clone(movedCanvas!), '/tmp/research-space');
    const reopenedCanvas = clone(useCanvasStore.getState().canvasFile);

    expect(snapshotOverlapPersistence(reopenedCanvas)).toEqual(snapshotOverlapPersistence(movedCanvas));
  });
});
