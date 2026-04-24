import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIContent, AIProvider } from '../../../src/ai/provider';

const {
  mockWriteFile,
  mockSuppressRevert,
  mockGetProvider,
  mockExtractContent,
} = vi.hoisted(() => ({
  mockWriteFile: vi.fn(),
  mockSuppressRevert: vi.fn(),
  mockGetProvider: vi.fn(),
  mockExtractContent: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_: string, defaultValue: unknown) => defaultValue),
    })),
    fs: {
      writeFile: mockWriteFile,
    },
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: `${base.fsPath}/${parts.join('/')}` }),
  },
}));

vi.mock('../../../src/ai/provider', () => ({
  getProvider: mockGetProvider,
}));

vi.mock('../../../src/core/content-extractor', () => ({
  extractContent: mockExtractContent,
}));

vi.mock('../../../src/core/storage', () => ({
  ensureAiOutputDir: vi.fn(async () => ({ fsPath: '/tmp/ai-output' })),
  writeCanvas: vi.fn(async () => undefined),
  toRelPath: vi.fn(() => 'ai-outputs/summarize_2026_0423_150600.md'),
  formatTimestamp: vi.fn(() => '2026_0423_150600'),
}));

vi.mock('../../../src/providers/CanvasEditorProvider', () => ({
  CanvasEditorProvider: {
    suppressRevert: mockSuppressRevert,
  },
}));

import type { CanvasFile, CanvasNode, JsonToolDef } from '../../../src/core/canvas-model';
import { runFunctionNode, setToolRegistry } from '../../../src/ai/function-runner';

function createProvider(onStream: (contents: AIContent[]) => void): AIProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    supportsImages: true,
    isAvailable: async () => true,
    listModels: async () => [],
    resolveModel: async () => 'mock-model',
    async *stream(_systemPrompt, contents) {
      onStream(contents);
      yield 'group hub ok';
    },
  };
}

describe('function-runner group hub consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes document relation note, page text, and page image to the provider in stable group order', async () => {
    const seenContents: AIContent[] = [];
    mockGetProvider.mockResolvedValue(createProvider(contents => {
      seenContents.push(...contents);
    }));
    mockExtractContent.mockImplementation(async (node: CanvasNode) => {
      if (node.node_type === 'image') {
        return {
          type: 'image',
          title: node.title,
          contextText: node.meta?.content_preview,
          localPath: `/tmp/${node.id}.png`,
          base64: 'aGVsbG8=',
          mediaType: 'image/png',
        } satisfies AIContent;
      }
      return {
        type: 'text',
        title: node.title,
        text: node.meta?.content_preview ?? node.title,
      } satisfies AIContent;
    });

    const toolDef: JsonToolDef = {
      id: 'summarize',
      name: '总结',
      description: '总结输入内容',
      icon: 'note',
      supportsImages: true,
      outputNodeType: 'ai_output',
      params: [],
      systemPromptTemplate: '',
      postProcessType: null,
      apiType: 'chat',
    };
    setToolRegistry({
      get: vi.fn(() => toolDef),
      buildSystem: vi.fn(() => 'system prompt'),
      postProcess: vi.fn((_: string, raw: string) => raw),
    } as any);

    const canvas: CanvasFile = {
      version: '1.0',
      nodes: [
        {
          id: 'group-hub-1',
          node_type: 'group_hub',
          title: '拆解组',
          position: { x: 0, y: 0 },
          size: { width: 420, height: 260 },
          meta: {
            hub_group_id: 'group-1',
            input_order: ['relation-note', 'page-note', 'page-image'],
            explode_provider: 'mineru',
          },
        },
        {
          id: 'relation-note',
          node_type: 'note',
          title: '文档关系索引',
          position: { x: 40, y: 40 },
          size: { width: 280, height: 160 },
          file_path: 'exploded/0000-document-relations.md',
          meta: {
            content_preview: '文本文件索引 + 图片文件索引',
            explode_kind: 'text',
            explode_order: -1,
          },
        },
        {
          id: 'page-note',
          node_type: 'note',
          title: '第 1 页文本',
          position: { x: 40, y: 240 },
          size: { width: 280, height: 160 },
          file_path: 'exploded/0001-page-1.md',
          meta: {
            content_preview: '第一页正文',
            explode_kind: 'text',
            explode_order: 0,
          },
        },
        {
          id: 'page-image',
          node_type: 'image',
          title: '第 1 页图片 1',
          position: { x: 360, y: 240 },
          size: { width: 240, height: 200 },
          file_path: 'exploded/figure-1.png',
          meta: {
            content_preview: '图像上下文：第 1 页图片 1',
            explode_kind: 'image',
            explode_order: 1,
          },
        },
        {
          id: 'fn-summary',
          node_type: 'function',
          title: '总结',
          position: { x: 680, y: 120 },
          size: { width: 280, height: 220 },
          meta: {
            ai_tool: 'summarize',
            param_values: {},
          },
        },
      ],
      edges: [
        { id: 'edge-1', source: 'relation-note', target: 'group-hub-1', edge_type: 'hub_member' },
        { id: 'edge-2', source: 'page-note', target: 'group-hub-1', edge_type: 'hub_member' },
        { id: 'edge-3', source: 'page-image', target: 'group-hub-1', edge_type: 'hub_member' },
        { id: 'edge-4', source: 'group-hub-1', target: 'fn-summary', edge_type: 'data_flow' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        title: 'group-hub-consumption',
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: '2026-04-23T00:00:00.000Z',
      },
      nodeGroups: [
        {
          id: 'group-1',
          name: '拆解组',
          hubNodeId: 'group-hub-1',
          sourceNodeId: 'paper-1',
          nodeIds: ['relation-note', 'page-note', 'page-image'],
          bounds: { x: 0, y: 0, width: 420, height: 260 },
          collapsed: false,
        },
      ],
      boards: [],
      stagingNodes: [],
    };

    const webview = { postMessage: vi.fn() } as any;
    const result = await runFunctionNode('fn-summary', canvas, { fsPath: '/tmp/research.rsws' } as any, webview);

    expect(result.success).toBe(true);
    expect(seenContents.map(content => content.title)).toEqual(['文档关系索引', '第 1 页文本', '第 1 页图片 1']);
    expect(seenContents.map(content => content.type)).toEqual(['text', 'text', 'image']);
    expect(mockExtractContent).toHaveBeenCalledTimes(3);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockSuppressRevert).toHaveBeenCalledWith('/tmp/research.rsws');
  });
});
