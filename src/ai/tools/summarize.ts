import { AIToolDef } from './index';

export const summarizeTool: AIToolDef = {
  id: 'summarize',
  name: 'Summarize',
  description: 'Generate an academic summary of documents',
  icon: 'book',
  supportsImages: true,
  outputNodeType: 'ai_output',
  params: [
    {
      name: 'language',
      type: 'select',
      label: 'Language',
      options: ['zh', 'en'],
      default: 'zh',
    },
    {
      name: 'style',
      type: 'select',
      label: 'Style',
      options: ['academic', 'casual'],
      default: 'academic',
    },
    {
      name: 'maxLength',
      type: 'number',
      label: 'Max Length (words)',
      default: 500,
    },
  ],
  buildSystem(params) {
    const lang = params['language'] === 'en' ? 'English' : 'Chinese';
    const style = params['style'] === 'casual' ? 'casual' : 'academic';
    const maxLen = params['maxLength'] ?? 500;
    return (
      `You are an expert academic summarizer. ` +
      `Summarize the provided content in ${lang} with a ${style} writing style. ` +
      `Keep the summary under ${maxLen} words. ` +
      `For images, first describe the visual content, then summarize the key information. ` +
      `Output only the summary without meta-commentary.`
    );
  },
};
