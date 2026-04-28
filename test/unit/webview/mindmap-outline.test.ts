import { describe, expect, it } from 'vitest';
import { createDefaultMindMap } from '../../../src/mindmap/mindmap-model';
import { mindMapToOutlineText, outlineTextToMindMap } from '../../../webview/src/utils/mindmap-outline';

function idFactory() {
  let i = 0;
  return () => `outline-${++i}`;
}

describe('mindmap outline utils', () => {
  it('parses indented outline text into a tree', () => {
    const file = outlineTextToMindMap([
      '# 论文结构',
      '- 引言',
      '  - 研究背景',
      '  - 研究问题',
      '- 方法',
    ].join('\n'), undefined, idFactory());

    expect(file.root.text).toBe('论文结构');
    expect(file.root.children).toHaveLength(2);
    expect(file.root.children[0].children.map(child => child.text)).toEqual(['研究背景', '研究问题']);
  });

  it('roundtrips mindmap tree to outline text', () => {
    const file = createDefaultMindMap('项目书', idFactory());
    const outline = mindMapToOutlineText(file);
    const parsed = outlineTextToMindMap(outline, file, idFactory());

    expect(parsed.root.text).toBe('项目书');
    expect(parsed.root.children.map(child => child.text)).toEqual(file.root.children.map(child => child.text));
    expect(parsed.root.id).toBe(file.root.id);
  });

  it('keeps image references at their outline position with size metadata', () => {
    const ids = idFactory();
    const file = outlineTextToMindMap([
      '# 图文结构',
      '- 证据链',
      '  ![实验图](figures/exp.png) {width=132 height=88}',
      '  - 观察结果',
    ].join('\n'), undefined, ids);

    expect(file.root.children[0].images?.[0]).toMatchObject({
      caption: '实验图',
      file_path: 'figures/exp.png',
      width: 132,
      height: 88,
    });

    const outline = mindMapToOutlineText(file);
    expect(outline).toContain('  ![实验图](figures/exp.png) {width=132 height=88}');
    expect(outline.indexOf('![实验图]')).toBeLessThan(outline.indexOf('观察结果'));
  });
});
