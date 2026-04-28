import type { MindMapFile, MindMapIdFactory, MindMapImage, MindMapItem } from '../../../src/mindmap/mindmap-model';
import { createDefaultMindMap, normalizeMindMapFile } from '../../../src/mindmap/mindmap-model';

function defaultIdFactory(): string {
  return `mm-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function itemKey(path: string[], text: string): string {
  return [...path, text.trim()].join(' / ');
}

function buildPreviousIndex(item: MindMapItem, path: string[], index: Map<string, MindMapItem>): void {
  const key = itemKey(path, item.text);
  if (!index.has(key)) {
    index.set(key, item);
  }
  item.children.forEach(child => buildPreviousIndex(child, [...path, item.text], index));
}

function leadingLevel(line: string): number {
  let spaces = 0;
  for (const char of line) {
    if (char === ' ') {
      spaces += 1;
    } else if (char === '\t') {
      spaces += 2;
    } else {
      break;
    }
  }
  return Math.floor(spaces / 2);
}

function normalizeLineText(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

function isImageLine(line: string): boolean {
  return /^\s*!\[[^\]]*]\([^)]+\)/.test(line.trim());
}

function parseImageLine(line: string, idFactory: MindMapIdFactory): MindMapImage | null {
  const trimmed = line.trim();
  const match = /^!\[([^\]]*)]\(([^)]+)\)\s*(?:\{([^}]*)})?$/.exec(trimmed);
  if (!match) { return null; }
  const attrs = match[3] ?? '';
  const width = /(?:^|\s)width=(\d+)/.exec(attrs)?.[1];
  const height = /(?:^|\s)height=(\d+)/.exec(attrs)?.[1];
  const image: MindMapImage = {
    id: idFactory(),
    caption: match[1].trim() || undefined,
    file_path: match[2].trim(),
  };
  if (width) { image.width = Number(width); }
  if (height) { image.height = Number(height); }
  return image;
}

function imageToOutlineLine(image: MindMapImage): string {
  const caption = image.caption?.trim() || image.file_path.split(/[\\/]/).pop() || '图片';
  const size = image.width || image.height
    ? ` {width=${Math.round(image.width ?? 96)} height=${Math.round(image.height ?? 72)}}`
    : '';
  return `![${caption}](${image.file_path})${size}`;
}

export function mindMapToOutlineText(file: MindMapFile): string {
  const normalized = normalizeMindMapFile(file);
  const lines = [`# ${normalized.root.text || normalized.title || '思维导图'}`];
  for (const image of normalized.root.images ?? []) {
    lines.push(imageToOutlineLine(image));
  }
  const visit = (item: MindMapItem, depth: number) => {
    lines.push(`${'  '.repeat(depth)}- ${item.text}`);
    for (const image of item.images ?? []) {
      lines.push(`${'  '.repeat(depth + 1)}${imageToOutlineLine(image)}`);
    }
    for (const child of item.children ?? []) {
      visit(child, depth + 1);
    }
  };
  for (const child of normalized.root.children ?? []) {
    visit(child, 0);
  }
  return lines.join('\n');
}

export function outlineTextToMindMap(
  outlineText: string,
  previous?: MindMapFile,
  idFactory: MindMapIdFactory = defaultIdFactory,
): MindMapFile {
  const previousNormalized = previous ? normalizeMindMapFile(previous) : createDefaultMindMap('思维导图', idFactory);
  const previousIndex = new Map<string, MindMapItem>();
  buildPreviousIndex(previousNormalized.root, [], previousIndex);

  const rawLines = outlineText.split(/\r?\n/).filter(line => line.trim().length > 0);
  const rootLineIndex = rawLines.findIndex(line => line.trim().startsWith('#'));
  const rootText = normalizeLineText(rootLineIndex >= 0 ? rawLines[rootLineIndex] : rawLines[0] ?? '') || previousNormalized.root.text || '思维导图';
  const rootPrevious = previousIndex.get(itemKey([], rootText));
  const root: MindMapItem = {
    id: rootPrevious?.id ?? previousNormalized.root.id ?? idFactory(),
    text: rootText,
    note: rootPrevious?.note,
    collapsed: rootPrevious?.collapsed,
    children: [],
  };

  const stack: Array<{ level: number; item: MindMapItem; path: string[] }> = [{ level: -1, item: root, path: [] }];
  rawLines.forEach((line, index) => {
    if (index === rootLineIndex) { return; }
    if (rootLineIndex < 0 && index === 0) { return; }
    if (isImageLine(line)) {
      const parent = stack[stack.length - 1]?.item;
      const image = parent ? parseImageLine(line, idFactory) : null;
      if (parent && image) {
        parent.images = [...(parent.images ?? []), image];
      }
      return;
    }
    const text = normalizeLineText(line);
    if (!text) { return; }
    let level = leadingLevel(line);
    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    if (level > stack[stack.length - 1].level + 1) {
      level = stack[stack.length - 1].level + 1;
    }
    const parent = stack[stack.length - 1];
    const path = [...parent.path, parent.item.text].filter(Boolean);
    const previousItem = previousIndex.get(itemKey(path, text));
    const item: MindMapItem = {
      id: previousItem?.id ?? idFactory(),
      text,
      note: previousItem?.note,
      collapsed: previousItem?.collapsed,
      children: [],
    };
    parent.item.children.push(item);
    stack.push({ level, item, path });
  });

  const now = new Date().toISOString();
  return normalizeMindMapFile({
    ...previousNormalized,
    title: root.text,
    root,
    metadata: {
      created_at: previousNormalized.metadata.created_at,
      updated_at: now,
    },
  }, idFactory);
}
