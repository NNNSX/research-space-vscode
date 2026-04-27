import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import {
  asImageDataUrl,
  buildGeminiImageEndpoint,
  buildOpenAIImageGenerationRequestBody,
  formatAihubmixImageHttpError,
  formatAihubmixImageNetworkError,
  normalizeEnumParam,
  normalizeOpenAIImageCount,
} from '../../../src/ai/multimodal/image-execution';

describe('multimodal image execution helpers', () => {
  it('normalizes GPT Image count and enum params', () => {
    expect(normalizeOpenAIImageCount(undefined)).toBe(1);
    expect(normalizeOpenAIImageCount(0)).toBe(1);
    expect(normalizeOpenAIImageCount(3.8)).toBe(3);
    expect(normalizeOpenAIImageCount(99)).toBe(8);
    expect(normalizeEnumParam('HIGH', ['high', 'medium', 'low', 'auto'], 'auto')).toBe('high');
    expect(normalizeEnumParam('invalid', ['low', 'auto'], 'low')).toBe('low');
  });

  it('converts image content to data URL and rejects unavailable images', () => {
    expect(asImageDataUrl({
      type: 'image',
      title: 'ref',
      base64: 'aGVsbG8=',
      mediaType: 'image/png',
    })).toBe('data:image/png;base64,aGVsbG8=');
    expect(() => asImageDataUrl({ type: 'image', title: 'broken' })).toThrow('图像输入缺少可用的 base64 或 mediaType');
  });

  it('builds Gemini image endpoint with encoded model id', () => {
    expect(buildGeminiImageEndpoint('gemini-3.1-flash-image-preview')).toBe(
      'https://aihubmix.com/gemini/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    );
  });

  it('builds GPT Image generation body for the OpenAI images endpoint', () => {
    expect(buildOpenAIImageGenerationRequestBody({
      model: 'openai/gpt-image-2',
      prompt: 'A deer drinking in the lake',
      params: {
        size: '1024x1536',
        n: 2,
        quality: 'HIGH',
        moderation: 'low',
        background: 'auto',
        output_format: 'webp',
      },
    })).toEqual({
      model: 'gpt-image-2',
      prompt: 'A deer drinking in the lake',
      size: '1024x1536',
      n: 2,
      quality: 'high',
      moderation: 'low',
      background: 'auto',
      output_format: 'webp',
    });
  });

  it('formats AIHubMix image safety errors into concise user-facing messages', () => {
    const message = formatAihubmixImageHttpError({
      label: 'GPT Image',
      status: 400,
      responseText: JSON.stringify({
        error: {
          message: 'Your request was rejected by the safety system. If you believe this is an error, contact us and include the request ID 45b27b72-9127-4e8a-b1c7-341f546d091d. (tid: 2026042608162698916792579425354)',
          type: 'Aihubmix_api_error',
        },
        type: 'error',
      }),
    });

    expect(message).toBe('GPT Image 请求被安全系统拒绝：请调整图像描述或参考图，避免可能触发安全策略的内容后重试。（请求 ID：45b27b72-9127-4e8a-b1c7-341f546d091d；tid：2026042608162698916792579425354）');
  });

  it('keeps quota errors readable for AIHubMix image tools', () => {
    expect(formatAihubmixImageHttpError({
      label: 'GPT Image',
      status: 403,
      responseText: JSON.stringify({
        error: {
          code: 'insufficient_user_quota',
          message: 'quota exhausted',
        },
      }),
    })).toBe('AIHubMix 额度不足：当前 API token quota 已耗尽，请前往 AIHubMix 控制台检查配额或余额后重试。');
  });

  it('formats low-level fetch failures into actionable network messages', () => {
    const error = new TypeError('fetch failed');
    (error as any).cause = { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout Error' };

    expect(formatAihubmixImageNetworkError('GPT Image', error)).toBe(
      'GPT Image 网络请求失败：已连接网络也可能发生该问题，常见原因是 AIHubMix / 上游模型服务连接超时、DNS / 代理 / TLS 连接被中断，或图像生成耗时较长导致连接被重置。请稍后重试，或切换 Gemini / Doubao 模型验证服务是否可用。（UND_ERR_CONNECT_TIMEOUT：Connect Timeout Error）',
    );
  });
});
