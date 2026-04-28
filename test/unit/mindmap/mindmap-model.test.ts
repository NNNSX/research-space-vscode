import { describe, expect, it } from 'vitest';
import { createDefaultMindMap, mindMapSummaryToPreview, normalizeMindMapFile, summarizeMindMap } from '../../../src/mindmap/mindmap-model';

function idFactory() {
  let i = 0;
  return () => `id-${++i}`;
}

describe('mindmap model', () => {
  it('creates a default mindmap with stable required fields', () => {
    const file = createDefaultMindMap('论文结构', idFactory());
    expect(file.version).toBe('1.0');
    expect(file.title).toBe('论文结构');
    expect(file.root.text).toBe('论文结构');
    expect(file.root.children.length).toBeGreaterThan(0);
  });

  it('normalizes missing fields without dropping child structure', () => {
    const file = normalizeMindMapFile({
      title: '项目书',
      root: {
        text: '项目书',
        children: [
          { text: '背景' },
          { text: '目标', children: [{ text: '指标' }] },
        ],
      },
    }, idFactory());

    expect(file.version).toBe('1.0');
    expect(file.root.children[0].children).toEqual([]);
    expect(file.root.children[1].children[0].text).toBe('指标');
  });

  it('summarizes item and image counts for node previews', () => {
    const file = normalizeMindMapFile({
      title: '专利',
      root: {
        text: '专利',
        children: [
          {
            text: '创新点',
            images: [{ file_path: 'figures/a.png' }],
            children: [{ text: '实施例' }],
          },
        ],
      },
      metadata: { created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
    }, idFactory());

    const summary = summarizeMindMap(file);
    expect(summary.rootTitle).toBe('专利');
    expect(summary.firstLevelCount).toBe(1);
    expect(summary.firstLevelTitles).toEqual(['创新点']);
    expect(summary.totalItems).toBe(3);
    expect(summary.imageCount).toBe(1);
    expect(mindMapSummaryToPreview(summary)).toContain('一级分支：1');
  });

  it('keeps first-level titles even when nested items consume outline preview slots', () => {
    const file = normalizeMindMapFile({
      title: '结构',
      root: {
        text: '结构',
        children: [
          { text: '核心问题', children: [{ text: '子问题 A' }, { text: '子问题 B' }] },
          { text: '关键思路', children: [{ text: '方法 A' }] },
          { text: '支撑材料', children: [] },
        ],
      },
    }, idFactory());

    const summary = summarizeMindMap(file);

    expect(summary.firstLevelCount).toBe(3);
    expect(summary.firstLevelTitles).toEqual(['核心问题', '关键思路', '支撑材料']);
  });

  it('normalizes optional image size metadata', () => {
    const file = normalizeMindMapFile({
      title: '图片尺寸',
      root: {
        text: '图片尺寸',
        children: [
          {
            text: '图片',
            images: [{ file_path: 'figures/a.png', width: 145.6, height: 92.2 }],
          },
        ],
      },
    }, idFactory());

    expect(file.root.children[0].images?.[0]).toMatchObject({
      width: 146,
      height: 92,
    });
  });

  it('deduplicates repeated item and image ids on load', () => {
    const file = normalizeMindMapFile({
      id: 'file-1',
      title: '重复 ID',
      root: {
        id: 'same',
        text: '重复 ID',
        children: [
          { id: 'branch', text: '分支 1', images: [{ id: 'image', file_path: 'a.png' }] },
          { id: 'branch', text: '分支 2', images: [{ id: 'image', file_path: 'b.png' }] },
          { id: 'branch', text: '分支 3' },
        ],
      },
    }, idFactory());

    const ids = [file.root.id, ...file.root.children.map(child => child.id)];
    const imageIds = file.root.children.flatMap(child => child.images?.map(image => image.id) ?? []);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(imageIds).size).toBe(imageIds.length);
    expect(file.root.children.map(child => child.text)).toEqual(['分支 1', '分支 2', '分支 3']);
  });
});
