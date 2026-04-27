import { describe, expect, it } from 'vitest';

import { buildImageEditPrompt, buildImageGenerationPrompt } from '../../../src/ai/multimodal/image-prompts';

describe('multimodal image prompt builders', () => {
  it('builds image generation prompts from direct prompt, connected text and style', () => {
    expect(buildImageGenerationPrompt(
      { prompt: '一只湖边喝水的鹿', style_hint: '电影感光线' },
      [{ type: 'text', title: 'note', text: '樱花飘落' }],
    )).toBe('一只湖边喝水的鹿\n\n樱花飘落\n\nStyle: 电影感光线');
  });

  it('does not treat style hint alone as an image subject', () => {
    expect(buildImageGenerationPrompt(
      { style_hint: '电影感光线' },
      [],
    )).toBe('');
  });

  it('builds image edit prompts from direct instruction and connected text', () => {
    expect(buildImageEditPrompt(
      { instruction: '保留人物主体' },
      [{ type: 'text', title: 'note', text: '背景改为夜景霓虹街道' }],
    )).toBe('保留人物主体\n\n背景改为夜景霓虹街道');
  });
});
