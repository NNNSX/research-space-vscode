import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';

import {
  buildImageToVideoFormData,
  buildTextToVideoRequestBody,
  formatAihubmixVideoHttpError,
  formatAihubmixVideoNetworkError,
  requestVideoGeneration,
} from '../../../src/ai/multimodal/video-execution';

function arrayBufferFrom(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

describe('multimodal video execution helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds text-to-video request body and completes submit/poll/download flow', async () => {
    const videoBytes = Buffer.from('fake-video');
    const mockFetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === 'https://aihubmix.com/v1/videos' && init.method === 'POST') {
        expect(init.headers).toEqual({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key',
        });
        expect(init.body).toBe(JSON.stringify({
          model: 'doubao-seedance-2-0-260128',
          prompt: '生成一段研究室镜头',
          size: '1080p',
          seconds: '5',
        }));
        return {
          ok: true,
          json: async () => ({ id: 'job-1' }),
        };
      }

      if (url === 'https://aihubmix.com/v1/videos/job-1') {
        expect(init.headers).toEqual({ 'Authorization': 'Bearer test-key' });
        return {
          ok: true,
          json: async () => ({ status: 'succeeded' }),
        };
      }

      if (url === 'https://aihubmix.com/v1/videos/job-1/content') {
        return {
          ok: true,
          arrayBuffer: async () => arrayBufferFrom(videoBytes),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    expect(buildTextToVideoRequestBody({
      model: 'doubao-seedance-2-0-260128',
      prompt: '生成一段研究室镜头',
      size: '1080p',
      seconds: '5',
    })).toEqual({
      model: 'doubao-seedance-2-0-260128',
      prompt: '生成一段研究室镜头',
      size: '1080p',
      seconds: '5',
    });

    const onProgress = vi.fn();
    const result = await requestVideoGeneration({
      apiKey: 'test-key',
      model: 'doubao-seedance-2-0-260128',
      prompt: '生成一段研究室镜头',
      size: '1080p',
      seconds: '5',
      pollIntervalMs: 0,
      sleep: vi.fn(async () => undefined),
      now: vi.fn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(30000),
      onProgress,
    });

    expect(result.jobId).toBe('job-1');
    expect(result.model).toBe('doubao-seedance-2-0-260128');
    expect(result.videoBytes.equals(videoBytes)).toBe(true);
    expect(onProgress).toHaveBeenCalledWith({ phase: 'polling', elapsedSeconds: 30, status: 'succeeded' });
    expect(onProgress).toHaveBeenCalledWith({ phase: 'downloading' });
  });

  it('builds image-to-video multipart form without forcing Content-Type', async () => {
    const imageContent = {
      type: 'image' as const,
      title: 'ref',
      base64: Buffer.from('png').toString('base64'),
      mediaType: 'image/png',
      localPath: '/tmp/reference.png',
    };
    const form = buildImageToVideoFormData({
      model: 'doubao-seedance-2-0-260128',
      prompt: '让画面缓慢推进',
      size: '720p',
      seconds: '5',
      imageContent,
    });
    expect(form.get('model')).toBe('doubao-seedance-2-0-260128');
    expect(form.get('prompt')).toBe('让画面缓慢推进');
    expect(form.get('size')).toBe('720p');
    expect(form.get('seconds')).toBe('5');
    expect((form.get('input_reference') as File).name).toBe('reference.png');

    const mockFetch = vi.fn(async (_url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        expect(init.body).toBeInstanceOf(FormData);
        expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
        expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
        return { ok: true, json: async () => ({ task_id: 'job-2' }) };
      }
      if (String(_url).endsWith('/job-2')) {
        return { ok: true, json: async () => ({ status: 'completed' }) };
      }
      return { ok: true, arrayBuffer: async () => arrayBufferFrom(Buffer.from('video')) };
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(requestVideoGeneration({
      apiKey: 'test-key',
      model: 'doubao-seedance-2-0-260128',
      prompt: '让画面缓慢推进',
      size: '720p',
      seconds: '5',
      imageContent,
      pollIntervalMs: 0,
      sleep: vi.fn(async () => undefined),
      now: vi.fn(() => 0),
    })).resolves.toMatchObject({ jobId: 'job-2' });
  });

  it('surfaces video task failure reason from polling response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://aihubmix.com/v1/videos') {
        return { ok: true, json: async () => ({ id: 'job-failed' }) };
      }
      return {
        ok: true,
        json: async () => ({ status: 'failed', error: { message: 'content rejected' } }),
      };
    }));

    await expect(requestVideoGeneration({
      apiKey: 'test-key',
      model: 'doubao-seedance-2-0-260128',
      prompt: 'test',
      size: '1080p',
      seconds: '5',
      pollIntervalMs: 0,
      sleep: vi.fn(async () => undefined),
    })).rejects.toThrow('视频生成任务失败：content rejected');
  });

  it('formats AIHubMix video HTTP errors into user-facing messages', () => {
    expect(formatAihubmixVideoHttpError({
      label: '视频提交',
      status: 403,
      responseText: JSON.stringify({
        error: {
          code: 'insufficient_user_quota',
          message: 'quota exhausted',
        },
      }),
    })).toBe('AIHubMix 额度不足：当前 API token quota 已耗尽，请前往 AIHubMix 控制台检查配额或余额后重试。');

    expect(formatAihubmixVideoHttpError({
      label: '视频下载',
      status: 401,
      responseText: JSON.stringify({
        error: {
          message: 'invalid api key, request ID 45b27b72-9127-4e8a-b1c7-341f546d091d. (tid: 2026042608162698916792579425354)',
        },
      }),
    })).toBe('视频下载 鉴权失败：请检查 AIHubMix API Key 是否正确、是否仍有效。（请求 ID：45b27b72-9127-4e8a-b1c7-341f546d091d；tid：2026042608162698916792579425354）');
  });

  it('formats low-level video fetch failures into actionable network messages', () => {
    const error = new TypeError('fetch failed');
    (error as any).cause = { code: 'UND_ERR_SOCKET', message: 'other side closed' };

    expect(formatAihubmixVideoNetworkError('视频下载', error)).toBe(
      '视频下载 网络请求失败：已连接网络也可能发生该问题，常见原因是 AIHubMix / 上游视频模型服务连接超时、DNS / 代理 / TLS 连接被中断，或视频生成 / 下载耗时较长导致连接被重置。请稍后重试，或降低时长 / 分辨率后验证服务是否可用。（UND_ERR_SOCKET：other side closed）',
    );
  });
});
