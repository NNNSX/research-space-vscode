export interface MindMapImage {
  id: string;
  file_path: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface MindMapItem {
  id: string;
  text: string;
  note?: string;
  images?: MindMapImage[];
  children: MindMapItem[];
  collapsed?: boolean;
}

export interface MindMapFile {
  version: '1.0';
  id: string;
  title: string;
  root: MindMapItem;
  metadata: {
    created_at: string;
    updated_at: string;
  };
}

export interface MindMapSummary {
  rootTitle: string;
  firstLevelCount: number;
  firstLevelTitles?: string[];
  totalItems: number;
  imageCount: number;
  outlinePreview: string;
  updatedAt?: string;
}

export type MindMapIdFactory = () => string;

const DEFAULT_TITLE = '思维导图';

function defaultIdFactory(): string {
  return `mindmap-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') { return fallback; }
  const text = value.trim();
  return text || fallback;
}

function uniqueId(rawId: unknown, fallbackPrefix: string, idFactory: MindMapIdFactory, usedIds: Set<string>): string {
  const first = normalizeText(rawId, '');
  const candidates = first ? [first] : [];
  for (let i = 0; i < 12; i++) {
    candidates.push(idFactory());
  }
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate, '');
    if (normalized && !usedIds.has(normalized)) {
      usedIds.add(normalized);
      return normalized;
    }
  }
  const prefix = first || fallbackPrefix;
  let suffix = usedIds.size + 1;
  while (usedIds.has(`${prefix}-${suffix}`)) {
    suffix += 1;
  }
  const id = `${prefix}-${suffix}`;
  usedIds.add(id);
  return id;
}

function normalizeImage(input: unknown, idFactory: MindMapIdFactory, usedImageIds: Set<string>): MindMapImage | null {
  if (!isRecord(input)) { return null; }
  const filePath = normalizeText(input.file_path, '');
  if (!filePath) { return null; }
  const image: MindMapImage = {
    id: uniqueId(input.id, 'mindmap-image', idFactory, usedImageIds),
    file_path: filePath,
  };
  if (typeof input.caption === 'string' && input.caption.trim()) {
    image.caption = input.caption.trim();
  }
  if (typeof input.width === 'number' && Number.isFinite(input.width) && input.width > 0) {
    image.width = Math.min(360, Math.max(32, Math.round(input.width)));
  }
  if (typeof input.height === 'number' && Number.isFinite(input.height) && input.height > 0) {
    image.height = Math.min(260, Math.max(24, Math.round(input.height)));
  }
  return image;
}

function normalizeItem(
  input: unknown,
  fallbackText: string,
  idFactory: MindMapIdFactory,
  usedItemIds: Set<string>,
  usedImageIds: Set<string>,
): MindMapItem {
  const record = isRecord(input) ? input : {};
  const childrenInput = Array.isArray(record.children) ? record.children : [];
  const imagesInput = Array.isArray(record.images) ? record.images : [];
  const item: MindMapItem = {
    id: uniqueId(record.id, 'mindmap-item', idFactory, usedItemIds),
    text: normalizeText(record.text, fallbackText),
    children: childrenInput.map((child, index) => normalizeItem(child, `条目 ${index + 1}`, idFactory, usedItemIds, usedImageIds)),
  };
  const images = imagesInput
    .map(image => normalizeImage(image, idFactory, usedImageIds))
    .filter((image): image is MindMapImage => !!image);
  if (images.length > 0) {
    item.images = images;
  }
  if (typeof record.note === 'string' && record.note.trim()) {
    item.note = record.note.trim();
  }
  if (typeof record.collapsed === 'boolean') {
    item.collapsed = record.collapsed;
  }
  return item;
}

export function createDefaultMindMap(title: string, idFactory: MindMapIdFactory = defaultIdFactory): MindMapFile {
  const safeTitle = normalizeText(title, DEFAULT_TITLE);
  const now = new Date().toISOString();
  return {
    version: '1.0',
    id: idFactory(),
    title: safeTitle,
    root: {
      id: idFactory(),
      text: safeTitle,
      children: [
        { id: idFactory(), text: '核心问题', children: [] },
        { id: idFactory(), text: '关键思路', children: [] },
        { id: idFactory(), text: '支撑材料', children: [] },
      ],
    },
    metadata: {
      created_at: now,
      updated_at: now,
    },
  };
}

export function normalizeMindMapFile(input: unknown, idFactory: MindMapIdFactory = defaultIdFactory): MindMapFile {
  const record = isRecord(input) ? input : {};
  const now = new Date().toISOString();
  const title = normalizeText(record.title, DEFAULT_TITLE);
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  const createdAt = typeof metadata.created_at === 'string' && metadata.created_at
    ? metadata.created_at
    : now;
  const updatedAt = typeof metadata.updated_at === 'string' && metadata.updated_at
    ? metadata.updated_at
    : createdAt;
  const root = normalizeItem(record.root, title, idFactory, new Set(), new Set());
  if (!root.text.trim()) {
    root.text = title;
  }
  return {
    version: '1.0',
    id: normalizeText(record.id, idFactory()),
    title: title || root.text || DEFAULT_TITLE,
    root,
    metadata: {
      created_at: createdAt,
      updated_at: updatedAt,
    },
  };
}

function collectSummary(item: MindMapItem, depth: number, lines: string[], acc: { total: number; images: number }): void {
  acc.total += 1;
  acc.images += item.images?.length ?? 0;
  if (depth > 0 && lines.length < 4) {
    lines.push(`${'  '.repeat(Math.max(0, depth - 1))}- ${item.text}`);
  }
  for (const child of item.children ?? []) {
    collectSummary(child, depth + 1, lines, acc);
  }
}

export function summarizeMindMap(file: MindMapFile): MindMapSummary {
  const lines: string[] = [];
  const acc = { total: 0, images: 0 };
  collectSummary(file.root, 0, lines, acc);
  return {
    rootTitle: file.root.text || file.title || DEFAULT_TITLE,
    firstLevelCount: file.root.children?.length ?? 0,
    firstLevelTitles: (file.root.children ?? []).map(child => child.text).filter(Boolean).slice(0, 12),
    totalItems: acc.total,
    imageCount: acc.images,
    outlinePreview: lines.join('\n'),
    updatedAt: file.metadata.updated_at,
  };
}

export function mindMapSummaryToPreview(summary: MindMapSummary): string {
  const parts = [
    `# ${summary.rootTitle}`,
    '',
    `- 一级分支：${summary.firstLevelCount}`,
    `- 总条目：${summary.totalItems}`,
  ];
  if (summary.imageCount > 0) {
    parts.push(`- 图片：${summary.imageCount}`);
  }
  if (summary.outlinePreview) {
    parts.push('', summary.outlinePreview);
  }
  return parts.join('\n');
}
