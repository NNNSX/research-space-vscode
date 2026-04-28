import { describe, expect, it } from 'vitest';
import { createDefaultMindMap } from '../../../src/mindmap/mindmap-model';
import {
  addMindMapChild,
  addMindMapImage,
  addMindMapSibling,
  findMindMapItem,
  removeMindMapItem,
  toggleMindMapItemCollapsed,
  updateMindMapImageSize,
  updateMindMapItemText,
} from '../../../webview/src/utils/mindmap-graph';

function idFactory() {
  let i = 0;
  return () => `graph-${++i}`;
}

describe('mindmap graph utils', () => {
  it('updates text and adds child/sibling without mutating the original file', () => {
    const ids = idFactory();
    const file = createDefaultMindMap('导图', ids);
    const first = file.root.children[0];
    const renamed = updateMindMapItemText(file, first.id, '新问题');
    const withChild = addMindMapChild(renamed, first.id, '子问题', ids);
    const withSibling = addMindMapSibling(withChild, first.id, '同级问题', ids);

    expect(file.root.children[0].text).toBe('核心问题');
    expect(withSibling.root.children[0].text).toBe('新问题');
    expect(withSibling.root.children[0].children[0].text).toBe('子问题');
    expect(withSibling.root.children[1].text).toBe('同级问题');
  });

  it('toggles collapsed, adds image references, and removes non-root items', () => {
    const ids = idFactory();
    const file = createDefaultMindMap('导图', ids);
    const first = file.root.children[0];
    const collapsed = toggleMindMapItemCollapsed(file, first.id);
    const withImage = addMindMapImage(collapsed, first.id, {
      id: 'image-1',
      file_path: 'figures/a.png',
      caption: 'a.png',
    });
    const removed = removeMindMapItem(withImage, first.id);

    expect(findMindMapItem(withImage.root, first.id)?.collapsed).toBe(true);
    expect(findMindMapItem(withImage.root, first.id)?.images?.[0].file_path).toBe('figures/a.png');
    expect(findMindMapItem(removed.root, first.id)).toBeNull();
    expect(removeMindMapItem(removed, removed.root.id).root.id).toBe(removed.root.id);
  });

  it('updates image size without mutating the original file', () => {
    const ids = idFactory();
    const file = createDefaultMindMap('导图', ids);
    const first = file.root.children[0];
    const withImage = addMindMapImage(file, first.id, {
      id: 'image-1',
      file_path: 'figures/a.png',
      caption: 'a.png',
    });
    const resized = updateMindMapImageSize(withImage, first.id, 'image-1', { width: 144, height: 96 });

    expect(findMindMapItem(withImage.root, first.id)?.images?.[0].width).toBe(96);
    expect(findMindMapItem(resized.root, first.id)?.images?.[0]).toMatchObject({
      width: 144,
      height: 96,
    });
  });
});
