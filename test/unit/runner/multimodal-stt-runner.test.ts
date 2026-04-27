import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockReadFile,
  mockWriteFile,
  mockWriteCanvas,
  mockSuppressRevert,
  mockGetProvider,
  mockExtractContent,
  mockActiveDocuments,
  mockFetch,
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockWriteCanvas: vi.fn(),
  mockSuppressRevert: vi.fn(),
  mockGetProvider: vi.fn(),
  mockExtractContent: vi.fn(),
  mockActiveDocuments: new Map<string, any>(),
  mockFetch: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue: unknown) => key === 'aiHubMixApiKey' ? 'test-key' : defaultValue),
    })),
    fs: {
      readFile: mockReadFile,
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
  writeCanvas: mockWriteCanvas,
  toAbsPath: vi.fn((filePath: string) => `/tmp/workspace/${filePath}`),
  toRelPath: vi.fn(() => 'ai-outputs/stt_2026_0426_180000.md'),
  formatTimestamp: vi.fn(() => '2026_0426_180000'),
}));

vi.mock('../../../src/providers/CanvasEditorProvider', () => ({
  CanvasEditorProvider: {
    activeDocuments: mockActiveDocuments,
    suppressRevert: mockSuppressRevert,
  },
}));

import type { CanvasFile, JsonToolDef } from '../../../src/core/canvas-model';
import { runFunctionNode, setToolRegistry } from '../../../src/ai/function-runner';

describe('multimodal STT runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveDocuments.clear();
    mockReadFile.mockResolvedValue(Buffer.from('fake-audio'));
    mockWriteCanvas.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockExtractContent.mockResolvedValue({ type: 'text', title: 'audio', text: '' });
    mockGetProvider.mockResolvedValue({
      id: 'mock',
      name: 'Mock Provider',
      supportsImages: true,
      isAvailable: async () => true,
      listModels: async () => [],
      resolveModel: async () => 'mock-model',
      stream: async function* () { yield ''; },
    });
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => 'hello transcript',
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  it('persists exactly one transcript output node and one generated edge', async () => {
    const toolDef: JsonToolDef = {
      id: 'stt',
      name: '语音转文字',
      description: '将音频文件转录为文本',
      icon: 'mic',
      supportsImages: false,
      outputNodeType: 'ai_output',
      params: [
        { name: 'model', type: 'select', label: '模型', options: ['whisper-large-v3-turbo'], default: '' },
        { name: 'response_format', type: 'select', label: '输出格式', options: ['text'], default: 'text' },
      ],
      systemPromptTemplate: '',
      postProcessType: null,
      apiType: 'stt',
    };
    setToolRegistry({
      get: vi.fn(() => toolDef),
      buildSystem: vi.fn(() => ''),
      postProcess: vi.fn((_: string, raw: string) => raw),
    } as any);

    const canvas: CanvasFile = {
      version: '1.0',
      nodes: [
        {
          id: 'audio-1',
          node_type: 'audio',
          title: '录音',
          position: { x: 0, y: 0 },
          size: { width: 240, height: 120 },
          file_path: 'inputs/meeting.mp3',
          meta: {},
        },
        {
          id: 'fn-stt',
          node_type: 'function',
          title: '语音转文字',
          position: { x: 360, y: 0 },
          size: { width: 280, height: 220 },
          meta: {
            ai_tool: 'stt',
            param_values: { response_format: 'text' },
          },
        },
      ],
      edges: [
        { id: 'edge-audio-stt', source: 'audio-1', target: 'fn-stt', edge_type: 'data_flow' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        title: 'stt-test',
        created_at: '2026-04-26T00:00:00.000Z',
        updated_at: '2026-04-26T00:00:00.000Z',
      },
    };
    mockActiveDocuments.set('/tmp/workspace/test.rsws', { data: canvas });

    const webview = { postMessage: vi.fn() } as any;
    const result = await runFunctionNode('fn-stt', canvas, { fsPath: '/tmp/workspace/test.rsws' } as any, webview);

    expect(result.success).toBe(true);
    const transcriptNodes = canvas.nodes.filter(node => node.node_type === 'ai_output' && node.title.startsWith('Transcript '));
    expect(transcriptNodes).toHaveLength(1);
    expect(canvas.edges.filter(edge => edge.edge_type === 'ai_generated' && edge.source === 'fn-stt')).toHaveLength(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteCanvas).toHaveBeenCalledTimes(1);
    expect(mockSuppressRevert).toHaveBeenCalledWith('/tmp/workspace/test.rsws');
  });

  it('persists meeting transcribe output with meeting-specific markdown semantics', async () => {
    const toolDef: JsonToolDef = {
      id: 'meeting-transcribe',
      name: '会议转写',
      description: '将会议录音转录为文字',
      icon: 'record',
      supportsImages: false,
      outputNodeType: 'ai_output',
      params: [
        { name: 'model', type: 'select', label: '模型', options: ['whisper-large-v3-turbo'], default: '' },
        { name: 'response_format', type: 'select', label: '输出格式', options: ['text'], default: 'text' },
      ],
      systemPromptTemplate: '',
      postProcessType: null,
      apiType: 'stt',
    };
    setToolRegistry({
      get: vi.fn(() => toolDef),
      buildSystem: vi.fn(() => ''),
      postProcess: vi.fn((_: string, raw: string) => raw),
    } as any);

    const canvas: CanvasFile = {
      version: '1.0',
      nodes: [
        {
          id: 'audio-1',
          node_type: 'audio',
          title: '周会录音',
          position: { x: 0, y: 0 },
          size: { width: 240, height: 120 },
          file_path: 'inputs/meeting.mp3',
          meta: {},
        },
        {
          id: 'fn-meeting',
          node_type: 'function',
          title: '会议转写',
          position: { x: 360, y: 0 },
          size: { width: 280, height: 220 },
          meta: {
            ai_tool: 'meeting-transcribe',
            param_values: { response_format: 'text', language: 'zh' },
          },
        },
      ],
      edges: [
        { id: 'edge-audio-meeting', source: 'audio-1', target: 'fn-meeting', edge_type: 'data_flow' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        title: 'meeting-test',
        created_at: '2026-04-26T00:00:00.000Z',
        updated_at: '2026-04-26T00:00:00.000Z',
      },
    };
    mockActiveDocuments.set('/tmp/workspace/test.rsws', { data: canvas });

    const webview = { postMessage: vi.fn() } as any;
    const result = await runFunctionNode('fn-meeting', canvas, { fsPath: '/tmp/workspace/test.rsws' } as any, webview);

    expect(result.success).toBe(true);
    const transcriptNode = canvas.nodes.find(node => node.node_type === 'ai_output' && node.title.startsWith('Meeting Transcript '));
    expect(transcriptNode).toBeTruthy();
    const persistedBytes = mockWriteFile.mock.calls[0][1] as Buffer;
    const persistedText = persistedBytes.toString('utf-8');
    expect(persistedText).toContain('# 会议转写');
    expect(persistedText).toContain('- 来源音频：周会录音');
    expect(persistedText).toContain('- 语言：zh');
    expect(persistedText).toContain('hello transcript');
  });
});
