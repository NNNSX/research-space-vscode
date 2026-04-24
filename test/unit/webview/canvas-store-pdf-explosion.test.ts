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

describe('canvas-store pdf explosion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a semantic node group from exploded PDF units and requests image previews', async () => {
    const sourcePdfNode: CanvasNode = {
      id: 'paper-1',
      node_type: 'paper',
      title: 'Research PDF',
      position: { x: 120, y: 160 },
      size: { width: 280, height: 160 },
      file_path: 'papers/research.pdf',
      meta: {
        content_preview: 'Paper preview',
      },
    };

    const functionNode: CanvasNode = {
      id: 'fn-explode-1',
      node_type: 'function',
      title: '文件转换',
      position: { x: 460, y: 160 },
      size: { width: 280, height: 220 },
      meta: {
        ai_tool: 'explode-document',
        fn_status: 'idle',
      },
    };

    const canvas: CanvasFile = {
      version: '1.0',
      nodes: [sourcePdfNode, functionNode],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        title: 'pdf-explosion',
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: '2026-04-23T00:00:00.000Z',
      },
      nodeGroups: [],
      boards: [],
      stagingNodes: [],
    };

    const { useCanvasStore } = await loadFreshCanvasStore();
    const bridge = await loadBridgeMock();

    useCanvasStore.getState().initCanvas(clone(canvas), '/tmp/research-space');
    vi.mocked(bridge.postMessage).mockClear();

    useCanvasStore.getState().applyPdfExplosion('paper-1', 'fn-explode-1', 'Research PDF · 拆解组', [
      {
        id: 'exploded-note-1',
        node_type: 'note',
        title: '第 1 页文本 1',
        position: { x: 0, y: 0 },
        size: { width: 280, height: 160 },
        meta: {
          content_preview: 'Hello MinerU',
          explode_session_id: 'session-1',
          explode_provider: 'mineru',
          explode_source_file_path: 'papers/research.pdf',
          explode_source_node_id: 'paper-1',
          explode_status: 'ready',
          explode_source_type: 'pdf',
          exploded_from_node_id: 'paper-1',
          explode_unit_type: 'page',
          explode_unit_index: 1,
          explode_kind: 'text',
          explode_order: 0,
        },
      },
      {
        id: 'exploded-image-1',
        node_type: 'image',
        title: '第 1 页图片 2',
        position: { x: 0, y: 0 },
        size: { width: 240, height: 200 },
        file_path: '../.research-space/explosions/job-1/image-1.png',
        meta: {
          display_mode: 'file',
          content_preview: 'Figure 1',
          explode_session_id: 'session-1',
          explode_provider: 'mineru',
          explode_source_file_path: 'papers/research.pdf',
          explode_source_node_id: 'paper-1',
          explode_status: 'ready',
          explode_source_type: 'pdf',
          exploded_from_node_id: 'paper-1',
          explode_unit_type: 'page',
          explode_unit_index: 1,
          explode_kind: 'image',
          explode_order: 1,
        },
      },
    ]);

    const nextCanvas = clone(useCanvasStore.getState().canvasFile);
    expect(nextCanvas?.nodeGroups).toHaveLength(1);
    expect(nextCanvas?.nodeGroups?.[0]).toMatchObject({
      name: 'Research PDF · 拆解组',
      sourceNodeId: 'paper-1',
      nodeIds: ['exploded-note-1', 'exploded-image-1'],
      collapsed: false,
    });

    const explodedNote = nextCanvas?.nodes.find(node => node.id === 'exploded-note-1');
    const explodedImage = nextCanvas?.nodes.find(node => node.id === 'exploded-image-1');
    const hubNode = nextCanvas?.nodes.find(node => node.node_type === 'group_hub');

    expect(explodedNote?.meta).toMatchObject({
      explode_session_id: 'session-1',
      explode_provider: 'mineru',
      explode_source_file_path: 'papers/research.pdf',
      explode_source_node_id: 'paper-1',
      explode_kind: 'text',
      explode_order: 0,
    });
    expect(explodedImage?.meta).toMatchObject({
      explode_session_id: 'session-1',
      explode_provider: 'mineru',
      explode_source_file_path: 'papers/research.pdf',
      explode_source_node_id: 'paper-1',
      explode_kind: 'image',
      explode_order: 1,
    });
    expect(hubNode?.meta).toMatchObject({
      hub_group_id: nextCanvas?.nodeGroups?.[0]?.id,
      explode_session_id: 'session-1',
      explode_provider: 'mineru',
      explode_source_file_path: 'papers/research.pdf',
      explode_source_node_id: 'paper-1',
      explode_status: 'ready',
      explode_source_type: 'pdf',
    });

    expect(nextCanvas?.edges.filter(edge => edge.edge_type === 'hub_member')).toHaveLength(2);
    expect(nextCanvas?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'fn-explode-1',
        target: hubNode?.id,
        edge_type: 'ai_generated',
      }),
    ]));

    expect(vi.mocked(bridge.postMessage).mock.calls).toEqual(expect.arrayContaining([
      [{ type: 'requestImageUri', filePath: '../.research-space/explosions/job-1/image-1.png' }],
      [expect.objectContaining({ type: 'canvasStateSync' })],
      [expect.objectContaining({ type: 'canvasChanged' })],
    ]));
  });
  it('keeps previous explosion groups for the same source pdf and appends a new group below them', async () => {
    const sourcePdfNode: CanvasNode = {
      id: 'paper-1',
      node_type: 'paper',
      title: 'Research PDF',
      position: { x: 120, y: 160 },
      size: { width: 280, height: 160 },
      file_path: 'papers/research.pdf',
      meta: { content_preview: 'Paper preview' },
    };

    const oldMember: CanvasNode = {
      id: 'old-note',
      node_type: 'note',
      title: '旧结果',
      position: { x: 560, y: 160 },
      size: { width: 280, height: 160 },
      file_path: 'notes/old-result.md',
      meta: { content_preview: 'old' },
    };

    const oldHub: CanvasNode = {
      id: 'old-hub',
      node_type: 'group_hub',
      title: '旧拆解组',
      position: { x: 520, y: 120 },
      size: { width: 360, height: 220 },
      meta: { hub_group_id: 'group-old', input_order: ['old-note'] },
    };

    const canvas: CanvasFile = {
      version: '1.0',
      nodes: [sourcePdfNode, oldMember, oldHub],
      edges: [
        { id: 'old-member-edge', source: 'old-note', target: 'old-hub', edge_type: 'hub_member' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        title: 'pdf-explosion',
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: '2026-04-23T00:00:00.000Z',
      },
      nodeGroups: [
        {
          id: 'group-old',
          name: '旧拆解组',
          hubNodeId: 'old-hub',
          sourceNodeId: 'paper-1',
          nodeIds: ['old-note'],
          bounds: { x: 520, y: 120, width: 360, height: 220 },
          collapsed: false,
        },
      ],
      boards: [],
      stagingNodes: [],
    };

    const { useCanvasStore } = await loadFreshCanvasStore();
    useCanvasStore.getState().initCanvas(clone(canvas), '/tmp/research-space');

    useCanvasStore.getState().applyPdfExplosion('paper-1', undefined, 'Research PDF · 拆解组', [
      {
        id: 'new-note',
        node_type: 'note',
        title: '新结果',
        position: { x: 0, y: 0 },
        size: { width: 280, height: 160 },
        file_path: 'notes/new-result.md',
        meta: { content_preview: 'new' },
      },
    ]);

    const nextCanvas = clone(useCanvasStore.getState().canvasFile);
    expect(nextCanvas?.nodeGroups).toHaveLength(2);
    expect(nextCanvas?.nodeGroups?.find(group => group.id === 'group-old')?.nodeIds).toEqual(['old-note']);
    const newGroup = nextCanvas?.nodeGroups?.find(group => group.id !== 'group-old');
    expect(newGroup?.nodeIds).toEqual(['new-note']);
    expect(nextCanvas?.nodes.some(node => node.id === 'old-note')).toBe(true);
    expect(nextCanvas?.nodes.some(node => node.id === 'old-hub')).toBe(true);
    expect(nextCanvas?.nodes.some(node => node.id === 'new-note')).toBe(true);
    const oldHubNode = nextCanvas?.nodes.find(node => node.id === 'old-hub');
    const newNoteNode = nextCanvas?.nodes.find(node => node.id === 'new-note');
    expect(newNoteNode?.position.y).toBeGreaterThan((oldHubNode?.position.y ?? 0) + (oldHubNode?.size.height ?? 0));
  });

  it('stacks new explosion groups against the collapsed hub height instead of the old expanded bounds', async () => {
    const sourcePdfNode: CanvasNode = {
      id: 'paper-1',
      node_type: 'paper',
      title: 'Research PDF',
      position: { x: 120, y: 160 },
      size: { width: 280, height: 160 },
      file_path: 'papers/research.pdf',
      meta: { content_preview: 'Paper preview' },
    };

    const oldMember: CanvasNode = {
      id: 'old-note',
      node_type: 'note',
      title: '旧结果',
      position: { x: 560, y: 160 },
      size: { width: 280, height: 160 },
      file_path: 'notes/old-result.md',
      meta: { content_preview: 'old' },
    };

    const oldHub: CanvasNode = {
      id: 'old-hub',
      node_type: 'group_hub',
      title: '旧拆解组',
      position: { x: 520, y: 120 },
      size: { width: 220, height: 72 },
      meta: { hub_group_id: 'group-old', input_order: ['old-note'] },
    };

    const canvas: CanvasFile = {
      version: '1.0',
      nodes: [sourcePdfNode, oldMember, oldHub],
      edges: [
        { id: 'old-member-edge', source: 'old-note', target: 'old-hub', edge_type: 'hub_member' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        title: 'pdf-explosion',
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: '2026-04-23T00:00:00.000Z',
      },
      nodeGroups: [
        {
          id: 'group-old',
          name: '旧拆解组',
          hubNodeId: 'old-hub',
          sourceNodeId: 'paper-1',
          nodeIds: ['old-note'],
          bounds: { x: 520, y: 120, width: 360, height: 220 },
          collapsed: true,
        },
      ],
      boards: [],
      stagingNodes: [],
    };

    const { useCanvasStore } = await loadFreshCanvasStore();
    useCanvasStore.getState().initCanvas(clone(canvas), '/tmp/research-space');

    useCanvasStore.getState().applyPdfExplosion('paper-1', undefined, 'Research PDF · 拆解组', [
      {
        id: 'new-note',
        node_type: 'note',
        title: '新结果',
        position: { x: 0, y: 0 },
        size: { width: 280, height: 160 },
        file_path: 'notes/new-result.md',
        meta: { content_preview: 'new' },
      },
    ]);

    const nextCanvas = clone(useCanvasStore.getState().canvasFile);
    const oldHubNode = nextCanvas?.nodes.find(node => node.id === 'old-hub');
    const newNote = nextCanvas?.nodes.find(node => node.id === 'new-note');
    expect(newNote?.position.x).toBeGreaterThanOrEqual(oldHubNode?.position.x ?? 0);
    expect(newNote?.position.y).toBeGreaterThan((oldHubNode?.position.y ?? 0) + (oldHubNode?.size.height ?? 0));
    expect(newNote?.position.y).toBeLessThan(340);
  });

});
