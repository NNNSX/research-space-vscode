import React from '../../../webview/node_modules/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from '../../../webview/node_modules/react-dom/server';
import type { CanvasFile, CanvasNode } from '../../../src/core/canvas-model';

let mockCanvasState: any;

const previewNodeSize = vi.fn();
const updateNodeSize = vi.fn();
const openPreview = vi.fn();
const selectExclusiveNode = vi.fn();

vi.mock('@xyflow/react', () => {
  return {
    Handle: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    NodeResizer: () => null,
    useUpdateNodeInternals: () => vi.fn(),
  };
});

vi.mock('../../../webview/node_modules/@xyflow/react/dist/esm/index.mjs', () => {
  return {
    Handle: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    NodeResizer: () => null,
    useUpdateNodeInternals: () => vi.fn(),
  };
});

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?raw', () => ({
  default: '',
}));

vi.mock('../../../webview/src/stores/canvas-store', () => ({
  useCanvasStore: (selector: (state: any) => unknown) => selector(mockCanvasState),
}));

vi.mock('../../../webview/src/bridge', () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(() => () => {}),
  saveState: vi.fn(),
  getState: vi.fn(() => null),
}));

vi.mock('../../../webview/src/components/nodes/NodeContextMenu', () => ({
  NodeContextMenu: () => null,
}));

vi.mock('../../../webview/src/components/nodes/ExperimentLogBody', () => ({
  ExperimentLogBody: () => null,
}));

vi.mock('../../../webview/src/components/nodes/TaskBody', () => ({
  TaskBody: () => null,
}));

vi.mock('../../../webview/src/components/nodes/AiReadabilityBadge', () => ({
  AiReadabilityBadge: () => null,
}));

function createCanvas(nodes: CanvasNode[]): CanvasFile {
  return {
    version: '1.0',
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title: 'placeholder-copy-tests',
      created_at: '2026-04-21T00:00:00.000Z',
      updated_at: '2026-04-21T00:00:00.000Z',
    },
  };
}

function buildMockState(nodes: CanvasNode[], edges: any[] = []) {
  mockCanvasState = {
    canvasFile: createCanvas(nodes),
    edges,
    imageUriMap: {},
    nodeDefs: [],
    previewNodeSize,
    updateNodeSize,
    openPreview,
    fullContentCache: {},
    selectExclusiveNode,
    pipelineState: {
      isRunning: false,
      nodeIssues: {},
      nodeStatuses: {},
    },
  };
}

async function renderNode(node: CanvasNode): Promise<string> {
  if (!globalThis.URL.createObjectURL) {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-worker');
  }
  const { DataNode } = await import('../../../webview/src/components/nodes/DataNode');
  return renderToStaticMarkup(React.createElement(DataNode, { data: node, selected: false }));
}

describe('DataNode blueprint placeholder copy', () => {
  beforeEach(() => {
    previewNodeSize.mockReset();
    updateNodeSize.mockReset();
    openPreview.mockReset();
    selectExclusiveNode.mockReset();
  });

  it('keeps input placeholder details concise without repeating footer descriptions', async () => {
    const upstreamNode: CanvasNode = {
      id: 'note-source',
      node_type: 'note',
      title: '研究问题笔记',
      position: { x: 80, y: 120 },
      size: { width: 280, height: 160 },
      meta: {},
    };
    const inputPlaceholder: CanvasNode = {
      id: 'input-placeholder',
      node_type: 'ai_output',
      title: '输入占位',
      position: { x: 420, y: 120 },
      size: { width: 240, height: 160 },
      meta: {
        blueprint_instance_id: 'inst-copy-test',
        blueprint_color: '#2f7d68',
        blueprint_placeholder_kind: 'input',
        blueprint_placeholder_slot_id: 'slot-question',
        blueprint_placeholder_title: '研究问题',
        blueprint_placeholder_accepts: ['note'],
        blueprint_placeholder_required: true,
        blueprint_placeholder_allow_multiple: false,
        blueprint_placeholder_hint: '请接入研究问题对应的笔记节点。',
      },
    };

    buildMockState(
      [upstreamNode, inputPlaceholder],
      [
        {
          id: 'edge-note-to-placeholder',
          source: 'note-source',
          target: 'input-placeholder',
          data: { edge_type: 'data_flow' },
        },
      ],
    );

    const html = await renderNode(inputPlaceholder);

    expect(html).toContain('当前输入：研究问题笔记');
    expect(html).toContain('输入槽位：研究问题');
    expect(html).toContain('接受 笔记文本');
    expect(html).not.toContain('接受类型：');
    expect(html).not.toContain('当前绑定：');
    expect((html.match(/定位输入节点/g) ?? [])).toHaveLength(1);
  });

  it('keeps output placeholder details concise without repeating current output text in the footer', async () => {
    const containerNode: CanvasNode = {
      id: 'bp-container',
      node_type: 'blueprint',
      title: '输出蓝图',
      position: { x: 120, y: 80 },
      size: { width: 760, height: 420 },
      meta: {
        blueprint_instance_id: 'inst-output-copy',
        blueprint_color: '#2f7d68',
        blueprint_output_slot_defs: [
          {
            id: 'slot-summary',
            kind: 'output',
            title: '最终摘要',
            required: false,
            allow_multiple: false,
            accepts: ['ai_output'],
            source_function_node_id: 'fn-summary',
            placeholder_style: 'output_placeholder',
            replacement_mode: 'attach_by_edge',
            rect: { x: 500, y: 130, width: 240, height: 136 },
          },
        ],
      },
    };
    const outputPlaceholder: CanvasNode = {
      id: 'output-placeholder',
      node_type: 'ai_output',
      title: '输出占位',
      position: { x: 620, y: 250 },
      size: { width: 240, height: 160 },
      meta: {
        blueprint_instance_id: 'inst-output-copy',
        blueprint_color: '#2f7d68',
        blueprint_placeholder_kind: 'output',
        blueprint_placeholder_slot_id: 'slot-summary',
        blueprint_placeholder_title: '最终摘要',
      },
    };
    const boundOutput: CanvasNode = {
      id: 'bound-output',
      node_type: 'ai_output',
      title: '摘要结果',
      position: { x: 932, y: 250 },
      size: { width: 240, height: 160 },
      file_path: 'outputs/summary.md',
      meta: {
        blueprint_bound_instance_id: 'inst-output-copy',
        blueprint_bound_slot_id: 'slot-summary',
        blueprint_bound_slot_title: '最终摘要',
        blueprint_bound_slot_kind: 'output',
      },
    };

    buildMockState([containerNode, outputPlaceholder, boundOutput]);

    const html = await renderNode(outputPlaceholder);

    expect(html).toContain('当前输出：摘要结果');
    expect(html).toContain('输出槽位：最终摘要');
    expect(html).toContain('单输出');
    expect(html).toContain('已回填结果');
    expect(html).toContain('累计 1 个结果');
    expect(html).not.toContain('槽位类型：');
    expect(html).not.toContain('当前回填：');
    expect((html.match(/摘要结果/g) ?? [])).toHaveLength(1);
  });
});
