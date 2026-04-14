import { AIToolDef } from './index';

export const translateTool: AIToolDef = {
  id: 'translate',
  name: 'Translate',
  description: 'Academic-quality translation with terminology notes',
  icon: 'globe',
  supportsImages: false,
  outputNodeType: 'ai_output',
  params: [
    {
      name: 'sourceLang',
      type: 'select',
      label: 'Source lang',
      options: ['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es'],
      default: 'auto',
    },
    {
      name: 'targetLang',
      type: 'select',
      label: 'Target lang',
      options: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es'],
      default: 'zh',
    },
    {
      name: 'domain',
      type: 'select',
      label: 'Domain',
      options: ['general', 'cs', 'bio', 'med', 'law', 'finance'],
      default: 'general',
    },
  ],
  buildSystem(params) {
    const src = params['sourceLang'] === 'auto' ? 'auto-detected' : params['sourceLang'];
    const tgt = params['targetLang'] ?? 'zh';
    const domain = params['domain'] ?? 'general';
    const domainDesc: Record<string, string> = {
      general: 'general academic',
      cs: 'computer science and software engineering',
      bio: 'biology and life sciences',
      med: 'medical and clinical',
      law: 'legal and regulatory',
      finance: 'financial and economic',
    };
    const targetLangFull: Record<string, string> = {
      zh: 'Chinese', en: 'English', ja: 'Japanese',
      ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish',
    };
    return (
      `You are an expert ${domainDesc[domain as string] ?? 'academic'} translator. ` +
      `Translate the provided content from ${src} to ${targetLangFull[tgt as string] ?? tgt}. ` +
      `Maintain academic terminology and style. ` +
      `After the translation, include a "## Key Terms" section with a table of important technical terms and their translations.`
    );
  },
};
