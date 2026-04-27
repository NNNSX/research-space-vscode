export type AiToolCostTone = 'info' | 'warning';

export interface AiToolCostNotice {
  tone: AiToolCostTone;
  text: string;
}

const HIGH_COST_API_TYPES = new Set(['image_generation', 'image_edit', 'video_generation']);

export function isHighCostAiTool(apiType: string | undefined): boolean {
  return !!apiType && HIGH_COST_API_TYPES.has(apiType);
}

export function getAiToolCostNotice(toolId: string, apiType: string | undefined): AiToolCostNotice | null {
  if (!apiType || apiType === 'chat' || apiType === 'explosion') {
    return null;
  }

  if (apiType === 'video_generation') {
    return {
      tone: 'warning',
      text: '高成本调用：视频生成会调用 AIHubMix 视频模型，耗时较长且可能产生明显费用；运行前请确认描述、时长和分辨率。',
    };
  }

  if (apiType === 'image_generation' || apiType === 'image_edit') {
    const noun = toolId === 'image-fusion'
      ? '多图融合'
      : toolId === 'image-group-output'
        ? '组图输出'
        : apiType === 'image_edit'
          ? '图像编辑'
          : '图像生成';
    return {
      tone: 'warning',
      text: `高成本调用：${noun}会调用 AIHubMix 图像模型，可能产生费用；重复运行会保留新结果，不会覆盖旧输出。`,
    };
  }

  if (apiType === 'tts') {
    return {
      tone: 'info',
      text: 'AIHubMix 调用：文字转语音会按输入文本生成新的音频文件，重复运行会保留新的音频输出。',
    };
  }

  if (apiType === 'stt') {
    return {
      tone: 'info',
      text: toolId === 'meeting-transcribe'
        ? 'AIHubMix 调用：会议转写会把会议录音转为带会议语义的 Markdown 记录，适合会议纪要后续整理。'
        : 'AIHubMix 调用：语音转文字会把音频转为普通转录文本，适合后续摘要、翻译或检索。',
    };
  }

  return null;
}

export function getRunButtonLabel(args: {
  isHighCost: boolean;
  countdown: number | null;
  isRunning: boolean;
}): string {
  if (args.countdown !== null) {
    return `确认中 ${args.countdown}s`;
  }
  if (args.isRunning) {
    return '运行中…';
  }
  return args.isHighCost ? '▶ 确认并运行' : '▶ 运行';
}

export function getCancelButtonLabel(countdown: number | null): string {
  return countdown !== null ? `取消确认 (${countdown}s)` : '⏹ 停止运行';
}
