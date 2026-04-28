import type { MindMapFile, MindMapIdFactory, MindMapImage, MindMapItem } from '../../../src/mindmap/mindmap-model';
import { normalizeMindMapFile } from '../../../src/mindmap/mindmap-model';

function cloneItem(item: MindMapItem): MindMapItem {
  return {
    ...item,
    images: item.images?.map(image => ({ ...image })),
    children: item.children.map(cloneItem),
  };
}

function normalizeImageSize(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) { return fallback; }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function defaultIdFactory(): string {
  return `mm-item-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

function withUpdatedRoot(file: MindMapFile, root: MindMapItem): MindMapFile {
  return normalizeMindMapFile({
    ...file,
    title: root.text || file.title,
    root,
    metadata: {
      ...file.metadata,
      updated_at: new Date().toISOString(),
    },
  });
}

function mapItem(item: MindMapItem, mapper: (item: MindMapItem) => MindMapItem): MindMapItem {
  const mapped = mapper({
    ...item,
    images: item.images?.map(image => ({ ...image })),
    children: item.children.map(child => mapItem(child, mapper)),
  });
  return mapped;
}

export function updateMindMapItemText(file: MindMapFile, itemId: string, text: string): MindMapFile {
  const nextRoot = mapItem(file.root, item => item.id === itemId ? { ...item, text } : item);
  return withUpdatedRoot(file, nextRoot);
}

export function toggleMindMapItemCollapsed(file: MindMapFile, itemId: string): MindMapFile {
  const nextRoot = mapItem(file.root, item => item.id === itemId ? { ...item, collapsed: !item.collapsed } : item);
  return withUpdatedRoot(file, nextRoot);
}

export function addMindMapChild(
  file: MindMapFile,
  parentId: string,
  text = '新分支',
  idFactory: MindMapIdFactory = defaultIdFactory,
): MindMapFile {
  const child: MindMapItem = { id: idFactory(), text, children: [] };
  const nextRoot = mapItem(file.root, item => item.id === parentId
    ? { ...item, collapsed: false, children: [...item.children, child] }
    : item);
  return withUpdatedRoot(file, nextRoot);
}

function addSiblingToChildren(
  children: MindMapItem[],
  targetId: string,
  sibling: MindMapItem,
): { children: MindMapItem[]; added: boolean } {
  const next: MindMapItem[] = [];
  let added = false;
  for (const child of children) {
    if (child.id === targetId) {
      next.push(cloneItem(child), sibling);
      added = true;
      continue;
    }
    const nested = addSiblingToChildren(child.children, targetId, sibling);
    next.push({ ...cloneItem(child), children: nested.children });
    added = added || nested.added;
  }
  return { children: next, added };
}

export function addMindMapSibling(
  file: MindMapFile,
  itemId: string,
  text = '新分支',
  idFactory: MindMapIdFactory = defaultIdFactory,
): MindMapFile {
  if (file.root.id === itemId) {
    return addMindMapChild(file, itemId, text, idFactory);
  }
  const sibling: MindMapItem = { id: idFactory(), text, children: [] };
  const result = addSiblingToChildren(file.root.children, itemId, sibling);
  if (!result.added) { return file; }
  return withUpdatedRoot(file, { ...cloneItem(file.root), children: result.children });
}

export function addMindMapImage(file: MindMapFile, itemId: string, image: MindMapImage): MindMapFile {
  const nextRoot = mapItem(file.root, item => item.id === itemId
    ? { ...item, images: [...(item.images ?? []), { width: 96, height: 72, ...image }] }
    : item);
  return withUpdatedRoot(file, nextRoot);
}

export function updateMindMapImageSize(
  file: MindMapFile,
  itemId: string,
  imageId: string,
  size: { width?: number; height?: number },
): MindMapFile {
  const nextRoot = mapItem(file.root, item => {
    if (item.id !== itemId || !item.images?.length) { return item; }
    return {
      ...item,
      images: item.images.map(image => image.id === imageId
        ? {
            ...image,
            width: normalizeImageSize(size.width, image.width ?? 96, 32, 360),
            height: normalizeImageSize(size.height, image.height ?? 72, 24, 260),
          }
        : image),
    };
  });
  return withUpdatedRoot(file, nextRoot);
}

function removeFromChildren(children: MindMapItem[], itemId: string): { children: MindMapItem[]; removed: boolean } {
  let removed = false;
  const next = children
    .filter(child => {
      if (child.id === itemId) {
        removed = true;
        return false;
      }
      return true;
    })
    .map(child => {
      const nested = removeFromChildren(child.children, itemId);
      removed = removed || nested.removed;
      return { ...cloneItem(child), children: nested.children };
    });
  return { children: next, removed };
}

export function removeMindMapItem(file: MindMapFile, itemId: string): MindMapFile {
  if (file.root.id === itemId) { return file; }
  const result = removeFromChildren(file.root.children, itemId);
  if (!result.removed) { return file; }
  return withUpdatedRoot(file, { ...cloneItem(file.root), children: result.children });
}

export function findMindMapItem(item: MindMapItem, itemId: string): MindMapItem | null {
  if (item.id === itemId) { return item; }
  for (const child of item.children) {
    const found = findMindMapItem(child, itemId);
    if (found) { return found; }
  }
  return null;
}
