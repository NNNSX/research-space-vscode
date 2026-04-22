import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConfiguration } = vi.hoisted(() => ({
  getConfiguration: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration,
  },
}));

import { OMLXProvider } from '../../../src/ai/omlx';

function createConfiguration(values: Record<string, string>) {
  return {
    get<T>(key: string, defaultValue?: T) {
      return (values[key] ?? defaultValue) as T;
    },
  };
}

describe('OMLXProvider', () => {
  const provider = new OMLXProvider();

  beforeEach(() => {
    getConfiguration.mockReturnValue(createConfiguration({
      omlxBaseUrl: 'http://localhost:11433/v1',
      omlxApiKey: '',
      omlxModel: 'qwen3-0.6b',
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns false from isAvailable when /v1/models fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(provider.isAvailable()).resolves.toBe(false);
  });

  it('lists models from the OpenAI-compatible /models endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'qwen3-0.6b' },
        { id: 'qwen3-8b' },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(provider.listModels()).resolves.toEqual([
      { id: 'qwen3-0.6b', name: 'qwen3-0.6b' },
      { id: 'qwen3-8b', name: 'qwen3-8b' },
    ]);
  });

  it('throws when no model is configured', async () => {
    getConfiguration.mockReturnValue(createConfiguration({
      omlxBaseUrl: 'http://localhost:11433/v1',
      omlxApiKey: '',
      omlxModel: '',
    }));

    const run = async () => {
      for await (const _ of provider.stream('', [{ type: 'text', title: 'prompt', text: 'hello' }])) {
        // no-op
      }
    };

    await expect(run()).rejects.toThrowError('oMLX: no model selected. Set a default model in Settings.');
  });

  it('streams chat completions from /v1/chat/completions', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"RS_"}}]}\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const chunks: string[] = [];
    for await (const chunk of provider.stream('', [{ type: 'text', title: 'prompt', text: 'hello' }], { maxTokens: 64 })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['RS_', 'OK']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11433/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen3-0.6b',
          stream: true,
          messages: [{ role: 'user', content: '[prompt]\nhello' }],
          max_tokens: 64,
        }),
      }),
    );
  });
});
