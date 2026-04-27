export type AihubmixImageModelKind = 'openai' | 'gemini' | 'doubao' | 'unknown';

export interface AihubmixImageModelCapability {
  id: string;
  kind: AihubmixImageModelKind;
  supportsTextToImage: boolean;
  supportsImageEdit: boolean;
  supportsMultiImageFusion: boolean;
  supportsGroupOutput: boolean;
  visibleParams: {
    imageGen: string[];
    imageEdit: string[];
  };
}

const OPENAI_IMAGE_PARAMS = ['prompt', 'size', 'quality', 'moderation', 'background', 'output_format', 'n'];
const OPENAI_IMAGE_EDIT_PARAMS = ['instruction', 'size', 'quality', 'moderation', 'background', 'output_format'];
const GEMINI_IMAGE_PARAMS = ['prompt', 'aspect_ratio'];
const GEMINI_IMAGE_EDIT_PARAMS = ['instruction', 'aspect_ratio'];
const DOUBAO_IMAGE_PARAMS = ['prompt', 'size', 'web_search', 'watermark'];
const DOUBAO_IMAGE_EDIT_PARAMS = ['instruction', 'size', 'watermark'];

export function normalizeOpenAIImageModel(model: string): string {
  return model.replace(/^openai\//i, '').trim();
}

export function isOpenAIImageModel(model: string): boolean {
  return /^gpt-image-/i.test(normalizeOpenAIImageModel(model));
}

export function isGeminiImageModel(model: string): boolean {
  return /^gemini-/i.test(model);
}

export function isDoubaoSeedreamModel(model: string): boolean {
  return /^doubao-seedream-/i.test(model);
}

export function resolveAihubmixImageModelKind(model: string): AihubmixImageModelKind {
  if (isOpenAIImageModel(model)) { return 'openai'; }
  if (isGeminiImageModel(model)) { return 'gemini'; }
  if (isDoubaoSeedreamModel(model)) { return 'doubao'; }
  return 'unknown';
}

export function buildOpenAIImagesEndpoint(mode: 'generations' | 'edits'): string {
  return `https://aihubmix.com/v1/images/${mode}`;
}

export function buildOpenAIImagePredictionsEndpoint(model: string): string {
  return `https://aihubmix.com/v1/models/openai/${encodeURIComponent(normalizeOpenAIImageModel(model))}/predictions`;
}

export function buildDoubaoPredictionsEndpoint(model = 'doubao-seedream-5.0-lite'): string {
  return `https://aihubmix.com/v1/models/doubao/${encodeURIComponent(model)}/predictions`;
}

export function normalizeOpenAIImageSize(size: string | undefined): string {
  const raw = (size ?? '').trim().toLowerCase();
  if (raw === 'auto') { return 'auto'; }
  if (raw === '1024x1024' || raw === '1024x1536' || raw === '1536x1024') {
    return raw;
  }
  return '1024x1024';
}

export function normalizeDoubaoSize(size: string | undefined): string {
  const raw = (size ?? '').trim();
  if (!raw) { return '2k'; }
  const lower = raw.toLowerCase();
  if (lower === '2k' || lower === '3k') { return lower; }
  if (lower === '1k') { return '2k'; }
  if (/^\d+x\d+$/.test(lower)) { return lower; }
  return '2k';
}

export function resolveAihubmixImageModelCapability(model: string): AihubmixImageModelCapability {
  const kind = resolveAihubmixImageModelKind(model);
  if (kind === 'openai') {
    return {
      id: normalizeOpenAIImageModel(model),
      kind,
      supportsTextToImage: true,
      supportsImageEdit: true,
      supportsMultiImageFusion: false,
      supportsGroupOutput: false,
      visibleParams: {
        imageGen: OPENAI_IMAGE_PARAMS,
        imageEdit: OPENAI_IMAGE_EDIT_PARAMS,
      },
    };
  }
  if (kind === 'doubao') {
    return {
      id: model,
      kind,
      supportsTextToImage: true,
      supportsImageEdit: true,
      supportsMultiImageFusion: true,
      supportsGroupOutput: true,
      visibleParams: {
        imageGen: DOUBAO_IMAGE_PARAMS,
        imageEdit: DOUBAO_IMAGE_EDIT_PARAMS,
      },
    };
  }
  if (kind === 'gemini') {
    return {
      id: model,
      kind,
      supportsTextToImage: true,
      supportsImageEdit: true,
      supportsMultiImageFusion: false,
      supportsGroupOutput: false,
      visibleParams: {
        imageGen: GEMINI_IMAGE_PARAMS,
        imageEdit: GEMINI_IMAGE_EDIT_PARAMS,
      },
    };
  }
  return {
    id: model,
    kind: 'unknown',
    supportsTextToImage: true,
    supportsImageEdit: true,
    supportsMultiImageFusion: false,
    supportsGroupOutput: false,
    visibleParams: {
      imageGen: GEMINI_IMAGE_PARAMS,
      imageEdit: GEMINI_IMAGE_EDIT_PARAMS,
    },
  };
}

export function getVisibleAihubmixImageParamNames(
  toolId: 'image-gen' | 'image-edit',
  model: string,
): Set<string> {
  const capability = resolveAihubmixImageModelCapability(model);
  const modelSpecificParams = toolId === 'image-gen'
    ? capability.visibleParams.imageGen
    : capability.visibleParams.imageEdit;
  return new Set(['model', ...modelSpecificParams]);
}
