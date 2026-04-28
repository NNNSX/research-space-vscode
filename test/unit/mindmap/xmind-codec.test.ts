import { describe, expect, it } from 'vitest';
import { normalizeMindMapFile } from '../../../src/mindmap/mindmap-model';
import { mindMapToXMindBuffer, xmindBufferToMindMap } from '../../../src/mindmap/xmind-codec';

describe('xmind codec', () => {
  it('exports and imports a mindmap as xmind', () => {
    const file = normalizeMindMapFile({
      id: 'map-1',
      title: '项目书',
      root: {
        id: 'root',
        text: '项目书',
        children: [
          {
            id: 'background',
            text: '研究背景',
            note: '保留说明',
            children: [
              { id: 'gap', text: '现有不足' },
            ],
          },
          { id: 'plan', text: '技术路线' },
        ],
      },
    }, () => 'fixed-id');

    const buffer = mindMapToXMindBuffer(file);
    const imported = xmindBufferToMindMap(buffer, () => 'imported-id');

    expect(imported.root.text).toBe('项目书');
    expect(imported.root.children.map(child => child.text)).toEqual(['研究背景', '技术路线']);
    expect(imported.root.children[0].note).toBe('保留说明');
    expect(imported.root.children[0].children[0].text).toBe('现有不足');
  });
});
