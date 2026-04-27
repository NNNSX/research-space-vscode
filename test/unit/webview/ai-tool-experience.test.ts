import { describe, expect, it } from 'vitest';

import {
  getAiToolCostNotice,
  getCancelButtonLabel,
  getRunButtonLabel,
  isHighCostAiTool,
} from '../../../webview/src/utils/ai-tool-experience';

describe('AI tool experience helpers', () => {
  it('marks image and video tools as high cost', () => {
    expect(isHighCostAiTool('image_generation')).toBe(true);
    expect(isHighCostAiTool('image_edit')).toBe(true);
    expect(isHighCostAiTool('video_generation')).toBe(true);
    expect(isHighCostAiTool('tts')).toBe(false);
    expect(isHighCostAiTool('stt')).toBe(false);
  });

  it('returns clear cost notices for multimodal tools', () => {
    expect(getAiToolCostNotice('video-gen', 'video_generation')).toMatchObject({
      tone: 'warning',
      text: expect.stringContaining('高成本调用'),
    });
    expect(getAiToolCostNotice('image-gen', 'image_generation')?.text).toContain('重复运行会保留新结果');
    expect(getAiToolCostNotice('meeting-transcribe', 'stt')?.text).toContain('会议语义');
    expect(getAiToolCostNotice('stt', 'stt')?.text).toContain('普通转录文本');
    expect(getAiToolCostNotice('summarize', 'chat')).toBeNull();
  });

  it('keeps run and cancel labels consistent', () => {
    expect(getRunButtonLabel({ isHighCost: true, countdown: null, isRunning: false })).toBe('▶ 确认并运行');
    expect(getRunButtonLabel({ isHighCost: false, countdown: null, isRunning: false })).toBe('▶ 运行');
    expect(getRunButtonLabel({ isHighCost: false, countdown: null, isRunning: true })).toBe('运行中…');
    expect(getCancelButtonLabel(2)).toBe('取消确认 (2s)');
    expect(getCancelButtonLabel(null)).toBe('⏹ 停止运行');
  });
});
