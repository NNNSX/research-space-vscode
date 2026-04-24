import * as path from 'path';
import type {
  ExplosionNodeDraft,
  ExplosionResult,
  ExplosionSourceFileType,
  ExplosionUnit,
} from './explosion-types';

const TEXT_TYPES = new Set([
  'text',
  'paragraph',
  'title',
  'subtitle',
  'caption',
  'table_caption',
  'figure_caption',
  'equation',
  'table',
  'reference',
  'list',
  'header',
  'footer',
]);

const IMAGE_TYPES = new Set([
  'image',
  'figure',
  'picture',
  'img',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function resolveContentList(manifest: unknown): unknown[] {
  if (Array.isArray(manifest)) {
    return manifest;
  }
  const record = asRecord(manifest);
  if (!record) {
    return [];
  }
  const candidates = [
    asArray(record.content_list),
    asArray(record.content_list_v2),
    asArray(record.items),
    asArray(asRecord(record.data)?.content_list),
    asArray(asRecord(record.data)?.content_list_v2),
  ];
  return candidates.find(candidate => candidate.length > 0) ?? [];
}

function normalizeBlockType(block: Record<string, unknown>): string {
  return (pickString(block, ['type', 'block_type', 'category', 'kind']) ?? 'unknown').toLowerCase();
}

function normalizePage(block: Record<string, unknown>): number | undefined {
  const raw = pickNumber(block, ['page', 'page_no', 'page_num', 'page_index', 'page_idx']);
  if (raw === undefined) {
    return undefined;
  }
  if ('page_idx' in block || 'page_index' in block) {
    return raw + 1;
  }
  return raw;
}

function extractText(block: Record<string, unknown>): string | undefined {
  const direct = pickString(block, ['text', 'content', 'md', 'markdown', 'latex', 'html']);
  if (direct) {
    return direct;
  }
  const nested = asRecord(block.detail);
  if (!nested) {
    return undefined;
  }
  return pickString(nested, ['text', 'content', 'md', 'markdown']);
}

function resolveRelativePath(filePath: string | undefined, manifestPath: string | undefined, outputDir: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  const baseDir = outputDir ?? (manifestPath ? path.dirname(manifestPath) : undefined);
  return baseDir ? path.resolve(baseDir, filePath) : path.normalize(filePath);
}

type PageBucket = {
  page?: number;
  order: number;
  textParts: string[];
  firstTextId?: string;
  imageBlocks: Array<{
    id?: string;
    imagePath: string;
    caption?: string;
    sourceType: string;
  }>;
};

type UnitLabelPreset = {
  containerLabel: string;
  textTitle: (index: number) => string;
  imageTitle: (index: number, imageIndex: number) => string;
  imageFirst: boolean;
};

function getUnitLabelPreset(sourceType: ExplosionSourceFileType | undefined): UnitLabelPreset {
  if (sourceType === 'pptx') {
    return {
      containerLabel: '张幻灯片',
      textTitle: index => `第 ${index} 张幻灯片文本`,
      imageTitle: (index, imageIndex) => `第 ${index} 张幻灯片图片 ${imageIndex}`,
      imageFirst: true,
    };
  }
  if (sourceType === 'docx') {
    return {
      containerLabel: '节',
      textTitle: index => `第 ${index} 节文本`,
      imageTitle: (index, imageIndex) => `第 ${index} 节图片 ${imageIndex}`,
      imageFirst: false,
    };
  }
  if (sourceType === 'xlsx') {
    return {
      containerLabel: '个工作表',
      textTitle: index => `第 ${index} 个工作表文本`,
      imageTitle: (index, imageIndex) => `第 ${index} 个工作表图片 ${imageIndex}`,
      imageFirst: false,
    };
  }
  return {
    containerLabel: '页',
    textTitle: index => `第 ${index} 页文本`,
    imageTitle: (index, imageIndex) => `第 ${index} 页图片 ${imageIndex}`,
    imageFirst: false,
  };
}

function getPageBucketKey(page: number | undefined): string {
  return page === undefined ? 'page:unknown' : `page:${page}`;
}

function getOrCreatePageBucket(
  buckets: Map<string, PageBucket>,
  page: number | undefined,
  order: number,
): PageBucket {
  const key = getPageBucketKey(page);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      page,
      order,
      textParts: [],
      imageBlocks: [],
    };
    buckets.set(key, bucket);
  }
  return bucket;
}

function buildPageUnits(
  buckets: Map<string, PageBucket>,
  sourceType: ExplosionSourceFileType | undefined,
  maxUnits?: number,
): { units: ExplosionUnit[]; warnings: string[] } {
  const warnings: string[] = [];
  const units: ExplosionUnit[] = [];
  const labels = getUnitLabelPreset(sourceType);
  const orderedBuckets = Array.from(buckets.values()).sort((a, b) => {
    if (a.page !== undefined && b.page !== undefined) {
      return a.page - b.page;
    }
    if (a.page !== undefined) { return -1; }
    if (b.page !== undefined) { return 1; }
    return a.order - b.order;
  });

  for (const bucket of orderedBuckets) {
    const appendTextUnit = () => {
      if (bucket.textParts.length === 0) {
        return false;
      }
      units.push({
        id: bucket.firstTextId ?? `page-${bucket.page ?? 'unknown'}-text`,
        kind: 'text',
        order: units.length,
        title: bucket.page ? labels.textTitle(bucket.page) : '未分页文本',
        page: bucket.page,
        text: bucket.textParts.join('\n\n'),
        sourceType: sourceType === 'pptx' ? 'slide_text' : 'page_text',
      });
      return true;
    };

    const appendImageUnits = () => {
      let appended = false;
      for (let imageIndex = 0; imageIndex < bucket.imageBlocks.length; imageIndex++) {
        const image = bucket.imageBlocks[imageIndex];
        units.push({
          id: image.id ?? `page-${bucket.page ?? 'unknown'}-image-${imageIndex + 1}`,
          kind: 'image',
          order: units.length,
          title: bucket.page
            ? labels.imageTitle(bucket.page, imageIndex + 1)
            : `图片 ${imageIndex + 1}`,
          page: bucket.page,
          imagePath: image.imagePath,
          caption: image.caption,
          sourceType: image.sourceType,
        });
        appended = true;
        if (maxUnits && maxUnits > 0 && units.length >= maxUnits) {
          warnings.push(`MinerU result truncated to ${maxUnits} units by configuration.`);
          return true;
        }
      }
      return appended;
    };

    if (labels.imageFirst) {
      if (appendImageUnits() && maxUnits && maxUnits > 0 && units.length >= maxUnits) {
        return { units, warnings };
      }
      if (appendTextUnit() && maxUnits && maxUnits > 0 && units.length >= maxUnits) {
        warnings.push(`MinerU result truncated to ${maxUnits} units by configuration.`);
        return { units, warnings };
      }
      continue;
    }

    if (appendTextUnit() && maxUnits && maxUnits > 0 && units.length >= maxUnits) {
      warnings.push(`MinerU result truncated to ${maxUnits} units by configuration.`);
      return { units, warnings };
    }
    if (appendImageUnits() && maxUnits && maxUnits > 0 && units.length >= maxUnits) {
      return { units, warnings };
    }
  }

  return { units, warnings };
}

function toNodeDraft(unit: ExplosionUnit): ExplosionNodeDraft {
  if (unit.kind === 'image') {
    return {
      id: unit.id,
      nodeType: 'image',
      title: unit.title,
      order: unit.order,
      page: unit.page,
      filePath: unit.imagePath,
      mimeType: unit.mimeType,
    };
  }
  return {
    id: unit.id,
    nodeType: 'note',
    title: unit.title,
    order: unit.order,
    page: unit.page,
    text: unit.text,
  };
}

export function normalizeMinerUManifest(
  manifest: unknown,
  opts?: {
    manifestPath?: string;
    outputDir?: string;
    maxUnits?: number;
    sourceType?: ExplosionSourceFileType;
  },
): ExplosionResult {
  const contentList = resolveContentList(manifest);
  const warnings: string[] = [];
  const pageBuckets = new Map<string, PageBucket>();

  for (const [index, blockValue] of contentList.entries()) {
    const block = asRecord(blockValue);
    if (!block) {
      continue;
    }
    const type = normalizeBlockType(block);
    const page = normalizePage(block);
    const bucket = getOrCreatePageBucket(pageBuckets, page, index);

    if (TEXT_TYPES.has(type) || (!IMAGE_TYPES.has(type) && extractText(block))) {
      const text = extractText(block);
      if (text) {
        bucket.textParts.push(text);
        bucket.firstTextId ??= pickString(block, ['id', 'uid']);
      }
      continue;
    }

    if (IMAGE_TYPES.has(type)) {
      const imagePath = resolveRelativePath(
        pickString(block, ['image_path', 'img_path', 'path', 'image', 'uri']),
        opts?.manifestPath,
        opts?.outputDir,
      );
      if (!imagePath) {
        continue;
      }
      bucket.imageBlocks.push({
        id: pickString(block, ['id', 'uid']),
        imagePath,
        caption: pickString(block, ['caption', 'text', 'content']),
        sourceType: type,
      });
    }
  }

  const { units, warnings: truncationWarnings } = buildPageUnits(pageBuckets, opts?.sourceType, opts?.maxUnits);
  warnings.push(...truncationWarnings);

  if (contentList.length === 0) {
    warnings.push('MinerU manifest does not contain a content_list payload.');
  }
  if (units.length === 0) {
    warnings.push('MinerU manifest produced no usable text/image units.');
  }

  return {
    provider: 'mineru',
    sourceType: opts?.sourceType ?? 'pdf',
    status: units.length > 0 ? 'success' : 'failed',
    outputDir: opts?.outputDir,
    manifestPath: opts?.manifestPath,
    units,
    nodeDrafts: units.map(toNodeDraft),
    warnings,
    raw: manifest,
  };
}
