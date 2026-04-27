import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasFile, CanvasNode, JsonToolDef } from '../../../src/core/canvas-model';

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

function toolDef(id: string, name: string): JsonToolDef {
  return {
    id,
    name,
    description: name,
    icon: 'sparkle',
    supportsImages: false,
    outputNodeType: 'ai_output',
    params: [
      {
        name: 'language',
        type: 'select',
        label: '语言',
        options: ['zh', 'en'],
        default: 'zh',
      },
    ],
    systemPromptTemplate: '',
    postProcessType: null,
  };
}

function canvasWithSources(): CanvasFile {
  const nodes: CanvasNode[] = [
    {
      id: 'note-1',
      node_type: 'note',
      title: '资料 A',
      position: { x: 100, y: 100 },
      size: { width: 240, height: 160 },
      file_path: 'notes/a.md',
    },
    {
      id: 'paper-1',
      node_type: 'paper',
      title: '论文 B',
      position: { x: 120, y: 320 },
      size: { width: 240, height: 160 },
      file_path: 'papers/b.pdf',
    },
  ];

  return {
    version: '1.0',
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title: 'next-step',
      created_at: '2026-04-26T00:00:00.000Z',
      updated_at: '2026-04-26T00:00:00.000Z',
    },
    nodeGroups: [],
    boards: [],
    stagingNodes: [],
  };
}

describe('canvas-store next step suggestions integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates one function node and connects selected data nodes without running it', async () => {
    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().setToolDefs([toolDef('summarize', '内容摘要')]);
    useCanvasStore.getState().initCanvas(clone(canvasWithSources()), '/tmp/research-space');
    useCanvasStore.getState().createFunctionNodeFromSelection(
      'summarize',
      ['note-1', 'paper-1'],
      { x: 480, y: 100 },
    );

    const state = useCanvasStore.getState();
    const canvas = state.canvasFile;
    const functionNode = canvas?.nodes.find(node => node.node_type === 'function');

    expect(functionNode).toMatchObject({
      title: '内容摘要',
      position: { x: 480, y: 100 },
      meta: {
        ai_tool: 'summarize',
        fn_status: 'idle',
        param_values: {
          _provider: 'copilot',
          _model: 'gpt-4.1',
          language: 'zh',
        },
      },
    });
    expect(canvas?.edges.map(edge => ({
      source: edge.source,
      target: edge.target,
      edge_type: edge.edge_type,
    }))).toEqual([
      { source: 'note-1', target: functionNode?.id, edge_type: 'data_flow' },
      { source: 'paper-1', target: functionNode?.id, edge_type: 'data_flow' },
    ]);
    expect(state.selectedNodeIds).toEqual([functionNode?.id]);
  });
});
