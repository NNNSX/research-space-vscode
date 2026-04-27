import { describe, expect, it } from 'vitest';
import {
  buildDoubaoPredictionsEndpoint,
  buildOpenAIImagesEndpoint,
  buildOpenAIImagePredictionsEndpoint,
  getVisibleAihubmixImageParamNames,
  isOpenAIImageModel,
  normalizeDoubaoSize,
  normalizeOpenAIImageSize,
  resolveAihubmixImageModelCapability,
} from '../../../src/core/aihubmix-image-models';

describe('AIHubMix image model capabilities', () => {
  it('identifies GPT Image models and exposes OpenAI image endpoints', () => {
    expect(isOpenAIImageModel('gpt-image-2')).toBe(true);
    expect(isOpenAIImageModel('openai/gpt-image-2')).toBe(true);
    expect(buildOpenAIImagesEndpoint('generations')).toBe('https://aihubmix.com/v1/images/generations');
    expect(buildOpenAIImagesEndpoint('edits')).toBe('https://aihubmix.com/v1/images/edits');
    expect(buildOpenAIImagePredictionsEndpoint('openai/gpt-image-2')).toBe(
      'https://aihubmix.com/v1/models/openai/gpt-image-2/predictions',
    );
  });

  it('normalizes model-specific image sizes', () => {
    expect(normalizeOpenAIImageSize('1024x1536')).toBe('1024x1536');
    expect(normalizeOpenAIImageSize('2k')).toBe('1024x1024');
    expect(normalizeOpenAIImageSize(undefined)).toBe('1024x1024');
    expect(normalizeDoubaoSize('1k')).toBe('2k');
    expect(normalizeDoubaoSize('3k')).toBe('3k');
  });

  it('describes visible params by provider family', () => {
    expect([...getVisibleAihubmixImageParamNames('image-gen', 'gpt-image-2')]).toEqual([
      'model', 'prompt', 'size', 'quality', 'moderation', 'background', 'output_format', 'n',
    ]);
    expect([...getVisibleAihubmixImageParamNames('image-edit', 'gemini-3.1-flash-image-preview')]).toEqual([
      'model', 'instruction', 'aspect_ratio',
    ]);
    expect([...getVisibleAihubmixImageParamNames('image-gen', 'doubao-seedream-5.0-lite')]).toEqual([
      'model', 'prompt', 'size', 'web_search', 'watermark',
    ]);
  });

  it('keeps Doubao route defaults for group/fusion tools', () => {
    expect(buildDoubaoPredictionsEndpoint()).toBe('https://aihubmix.com/v1/models/doubao/doubao-seedream-5.0-lite/predictions');
    expect(resolveAihubmixImageModelCapability('doubao-seedream-5.0-lite')).toMatchObject({
      kind: 'doubao',
      supportsMultiImageFusion: true,
      supportsGroupOutput: true,
    });
  });
});
