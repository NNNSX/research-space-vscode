import { AIToolDef } from './index';

export const polishTool: AIToolDef = {
  id: 'polish',
  name: 'Polish',
  description: 'Improve writing quality and clarity',
  icon: 'edit',
  supportsImages: false,
  outputNodeType: 'ai_output',
  params: [
    {
      name: 'intensity',
      type: 'select',
      label: 'Intensity',
      options: ['light', 'medium', 'heavy'],
      default: 'medium',
    },
    {
      name: 'language',
      type: 'select',
      label: 'Output language',
      options: ['auto', 'zh', 'en'],
      default: 'auto',
    },
  ],
  buildSystem(params) {
    const intensity = params['intensity'] ?? 'medium';
    const lang = params['language'] ?? 'auto';
    const intensityDesc =
      intensity === 'light'
        ? 'minimal changes — fix grammar and typos only'
        : intensity === 'heavy'
        ? 'comprehensive rewrite — improve structure, clarity, and style significantly'
        : 'moderate — improve clarity, flow, and word choice while preserving the author\'s voice';
    const langInstruction = lang === 'zh'
      ? ' Output your response in Chinese.'
      : lang === 'en'
      ? ' Output your response in English.'
      : ' Match the output language to the input text language.';
    return (
      `You are an expert writing editor. Polish the provided text with ${intensityDesc}.${langInstruction} ` +
      `Structure your response as:\n` +
      `## Changes Made\n[Brief explanation of main changes]\n\n` +
      `## Polished Text\n[The full polished content]`
    );
  },
};
