import { describe, expect, it } from 'vitest';
import { normalizeMindMapFile } from '../../../src/mindmap/mindmap-model';
import { mindMapToMarkdown } from '../../../src/mindmap/mindmap-markdown';

describe('mindmap markdown export', () => {
  it('renders a mindmap as a markdown outline', () => {
    const file = normalizeMindMapFile({
      title: '论文',
      root: {
        text: '论文',
        children: [
          {
            text: '方法',
            note: '需要补实验设置',
            children: [
              { text: '模型' },
            ],
          },
          {
            text: '结果',
            images: [{ file_path: 'figures/result.png', caption: '结果图', width: 120, height: 80 }],
          },
        ],
      },
    });

    const markdown = mindMapToMarkdown(file);
    expect(markdown).toContain('# 论文');
    expect(markdown).toContain('- 方法');
    expect(markdown).toContain('  - 模型');
    expect(markdown).toContain('![结果图](figures/result.png) {width=120 height=80}');
  });

  it('keeps image references and marks missing images when requested', () => {
    const file = normalizeMindMapFile({
      title: '图片导图',
      root: {
        text: '图片导图',
        children: [
          {
            text: '图像证据',
            images: [{ file_path: 'figures/missing.png', caption: '缺失图' }],
          },
        ],
      },
    });

    const markdown = mindMapToMarkdown(file, { missingImagePaths: new Set(['figures/missing.png']) });
    expect(markdown).toContain('![缺失图](figures/missing.png)');
    expect(markdown).toContain('图片文件可能缺失：figures/missing.png');
  });
});
