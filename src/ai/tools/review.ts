import { AIToolDef } from './index';

export const reviewTool: AIToolDef = {
  id: 'review',
  name: 'Review',
  description: 'Peer-review style critique for academic papers',
  icon: 'comment-discussion',
  supportsImages: false,
  outputNodeType: 'ai_output',
  params: [
    {
      name: 'level',
      type: 'select',
      label: 'Reviewer level',
      options: ['gentle', 'standard', 'strict'],
      default: 'standard',
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
    const level = params['level'] ?? 'standard';
    const lang = params['language'] ?? 'auto';
    const levelDesc =
      level === 'gentle'
        ? 'encouraging and constructive'
        : level === 'strict'
        ? 'rigorous and critical, holding to high academic standards'
        : 'balanced and professional';
    const langInstruction = lang === 'zh'
      ? ' Write the entire review in Chinese.'
      : lang === 'en'
      ? ' Write the entire review in English.'
      : ' Write the review in the same language as the paper.';
    return (
      `You are an expert academic peer reviewer with a ${levelDesc} tone.${langInstruction} ` +
      `Provide a structured review with:\n` +
      `## Overall Score: [X/10]\n\n` +
      `## Dimension Scores\n- Novelty: X/10\n- Methodology: X/10\n- Clarity: X/10\n- Impact: X/10\n\n` +
      `## Major Comments\n[Numbered list of major issues]\n\n` +
      `## Minor Comments\n[Numbered list of minor issues]\n\n` +
      `## Summary\n[2-3 sentence overall assessment and recommendation]`
    );
  },
};
