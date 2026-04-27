import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';

import {
  buildSpeechToTextFormData,
  buildTextToSpeechRequestBody,
  formatAihubmixAudioHttpError,
  formatAihubmixAudioNetworkError,
  requestSpeechToText,
  requestTextToSpeech,
} from '../../../src/ai/multimodal/audio-execution';

describe('multimodal audio execution helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds TTS request body and returns audio bytes', async () => {
    const audioBytes = Buffer.from('fake-mp3');
    const mockFetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => audioBytes.buffer.slice(
        audioBytes.byteOffset,
        audioBytes.byteOffset + audioBytes.byteLength,
      ),
    }));
    vi.stubGlobal('fetch', mockFetch);

    expect(buildTextToSpeechRequestBody({
      inputText: 'hello',
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
      responseFormat: 'mp3',
    })).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'hello',
      voice: 'coral',
      response_format: 'mp3',
    });

    const result = await requestTextToSpeech({
      apiKey: 'test-key',
      inputText: 'hello',
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
      responseFormat: 'mp3',
    });

    expect(result.audioBytes.equals(audioBytes)).toBe(true);
    expect(result.model).toBe('gpt-4o-mini-tts');
    expect(result.responseFormat).toBe('mp3');
    expect(mockFetch).toHaveBeenCalledWith('https://aihubmix.com/v1/audio/speech', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-key',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: 'hello',
        voice: 'coral',
        response_format: 'mp3',
      }),
    }));
  });

  it('builds STT multipart form and returns text response', async () => {
    const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const file = form.get('file') as File;
      expect(file.name).toBe('meeting.mp3');
      expect(form.get('model')).toBe('whisper-large-v3-turbo');
      expect(form.get('response_format')).toBe('text');
      expect(form.get('language')).toBe('zh');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
      expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
      return {
        ok: true,
        text: async () => '会议转写结果',
      };
    });
    vi.stubGlobal('fetch', mockFetch);

    const form = buildSpeechToTextFormData({
      audioBytes: Buffer.from('audio'),
      filename: '/tmp/workspace/meeting.mp3',
      model: 'whisper-large-v3-turbo',
      responseFormat: 'text',
      language: 'zh',
    });
    expect((form.get('file') as File).name).toBe('meeting.mp3');

    const result = await requestSpeechToText({
      apiKey: 'test-key',
      audioBytes: Buffer.from('audio'),
      filename: '/tmp/workspace/meeting.mp3',
      model: 'whisper-large-v3-turbo',
      responseFormat: 'text',
      language: 'zh',
    });

    expect(result).toEqual({
      text: '会议转写结果',
      model: 'whisper-large-v3-turbo',
      responseFormat: 'text',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('parses STT json response format', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: 'json transcript' }),
    })));

    await expect(requestSpeechToText({
      apiKey: 'test-key',
      audioBytes: Buffer.from('audio'),
      filename: 'meeting.mp3',
      model: 'whisper-large-v3-turbo',
      responseFormat: 'json',
    })).resolves.toMatchObject({ text: 'json transcript' });
  });

  it('formats AIHubMix audio HTTP errors into user-facing messages', () => {
    expect(formatAihubmixAudioHttpError({
      label: 'STT',
      status: 403,
      responseText: JSON.stringify({
        error: {
          code: 'insufficient_user_quota',
          message: 'quota exhausted',
        },
      }),
    })).toBe('AIHubMix 额度不足：当前 API token quota 已耗尽，请前往 AIHubMix 控制台检查配额或余额后重试。');

    expect(formatAihubmixAudioHttpError({
      label: 'TTS',
      status: 401,
      responseText: JSON.stringify({
        error: {
          message: 'invalid api key, request ID 45b27b72-9127-4e8a-b1c7-341f546d091d. (tid: 2026042608162698916792579425354)',
        },
      }),
    })).toBe('TTS 鉴权失败：请检查 AIHubMix API Key 是否正确、是否仍有效。（请求 ID：45b27b72-9127-4e8a-b1c7-341f546d091d；tid：2026042608162698916792579425354）');
  });

  it('formats low-level fetch failures into actionable network messages', () => {
    const error = new TypeError('fetch failed');
    (error as any).cause = { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout Error' };

    expect(formatAihubmixAudioNetworkError('STT', error)).toBe(
      'STT 网络请求失败：已连接网络也可能发生该问题，常见原因是 AIHubMix / 上游音频模型服务连接超时、DNS / 代理 / TLS 连接被中断，或音频文件较大导致请求超时。请稍后重试，或换用更短音频片段验证服务是否可用。（UND_ERR_CONNECT_TIMEOUT：Connect Timeout Error）',
    );
  });
});
