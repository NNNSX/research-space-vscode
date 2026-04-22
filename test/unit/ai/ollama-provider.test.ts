import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConfiguration } = vi.hoisted(() => ({
  getConfiguration: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration,
  },
}));

import { OllamaProvider } from '../../../src/ai/ollama';

function createConfiguration(values: Record<string, string>) {
  return {
    get<T>(key: string, defaultValue?: T) {
      return (values[key] ?? defaultValue) as T;
    },
  };
}

describe('OllamaProvider', () => {
  const provider = new OllamaProvider();

  beforeEach(() => {
    getConfiguration.mockReturnValue(createConfiguration({
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'qwen3.5:0.8b',
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns false from isAvailable when /api/tags fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(provider.isAvailable()).resolves.toBe(false);
  });

  it('returns an empty model list when /api/tags is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(provider.listModels()).resolves.toEqual([]);
  });

  it('parses model capabilities from /api/show model_info and parameters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model_info: {
        'llama.context_length': 262144,
      },
      parameters: 'num_predict 8192\nnum_ctx 131072',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(provider.getModelCapabilities()).resolves.toEqual({
      modelId: 'qwen3.5:0.8b',
      maxOutputTokens: 8192,
      contextWindowTokens: 262144,
      source: 'Ollama /api/show',
    });
  });

  it('returns null capabilities when /api/show is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(provider.getModelCapabilities()).resolves.toBeNull();
  });

  it('throws the Ollama JSON error body when chat completion fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'model "qwen3.5:0.8b" not found',
    }), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'application/json' },
    })));

    const run = async () => {
      for await (const _ of provider.stream('', [{ type: 'text', title: 'prompt', text: 'hello' }])) {
        // no-op
      }
    };

    await expect(run()).rejects.toThrowError('Ollama error: model "qwen3.5:0.8b" not found');
  });

  it('streams visible content and ignores malformed lines until done', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"message":{"content":"RS_"}}\nnot-json\n{"message":{"content":"OK"},"done":true}\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const chunks: string[] = [];
    for await (const chunk of provider.stream('', [{ type: 'text', title: 'prompt', text: 'hello' }])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['RS_', 'OK']);
  });
});
