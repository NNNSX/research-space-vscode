import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../src/core/canvas-model';
import { buildSelectedNodesMarkdown } from '../../../src/export/selected-markdown';

function node(patch: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'node_type' | 'title'>): CanvasNode {
  return {
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    ...patch,
  };
}

describe('selected markdown export builder', () => {
  it('exports selected nodes by canvas position with file path and content', () => {
    const markdown = buildSelectedNodesMarkdown({
      canvasTitle: '论文项目',
      exportedAt: '2026-04-26T00:00:00.000Z',
      nodes: [
        node({
          id: 'note-b',
          node_type: 'note',
          title: '后面的笔记',
          position: { x: 400, y: 300 },
          file_path: 'notes/b.md',
        }),
        node({
          id: 'note-a',
          node_type: 'note',
          title: '前面的笔记',
          position: { x: 100, y: 100 },
          file_path: 'notes/a.md',
        }),
      ],
      contents: [
        { nodeId: 'note-a', content: '# A\n正文 A' },
        { nodeId: 'note-b', content: '# B\n正文 B' },
      ],
    });

    expect(markdown).toContain('# 论文项目 - 选中节点导出');
    expect(markdown.indexOf('## 1. 前面的笔记')).toBeLessThan(markdown.indexOf('## 2. 后面的笔记'));
    expect(markdown).toContain('- 文件：notes/a.md');
    expect(markdown).toContain('# A\n正文 A');
  });

  it('includes AI provenance metadata when exporting generated outputs', () => {
    const markdown = buildSelectedNodesMarkdown({
      canvasTitle: '综述',
      exportedAt: '2026-04-26T00:00:00.000Z',
      nodes: [
        node({
          id: 'out-1',
          node_type: 'ai_output',
          title: '摘要结果',
          file_path: 'outputs/summary.md',
          meta: {
            ai_source_summary: '论文 A（paper，文件：papers/a.pdf）',
            ai_source_nodes: [
              {
                id: 'paper-a',
                label: '资料1',
                title: '论文 A',
                node_type: 'paper',
                file_path: 'papers/a.pdf',
              },
              {
                id: 'note-b',
                label: '资料2',
                title: '笔记 B',
                node_type: 'note',
              },
            ],
            ai_citation_coverage: {
              expectedLabels: ['资料1', '资料2'],
              citedLabels: ['资料1'],
              missingLabels: ['资料2'],
              unknownLabels: [],
              citationCount: 1,
            },
            ai_citation_warning: '未看到 [资料2] 的正文引用；请检查引用是否完整、准确。',
          },
        }),
      ],
      contents: [{ nodeId: 'out-1', content: '摘要正文' }],
    });

    expect(markdown).toContain('- 依据摘要：论文 A（paper，文件：papers/a.pdf）');
    expect(markdown).toContain('- 文内引用：1/2 个来源已在正文中出现，检测到 1 处来源标签。');
    expect(markdown).toContain('- 未出现来源：[资料2]');
    expect(markdown).toContain('- 引用提醒：未看到 [资料2] 的正文引用；请检查引用是否完整、准确。');
    expect(markdown).toContain('### 来源节点');
    expect(markdown).toContain('- [资料1] 论文 A（文献，文件：papers/a.pdf）');
    expect(markdown).toContain('- [资料2] 笔记 B（笔记）');
    expect(markdown).toContain('摘要正文');
  });

  it('falls back to task items and preview content', () => {
    const markdown = buildSelectedNodesMarkdown({
      canvasTitle: '任务',
      exportedAt: '2026-04-26T00:00:00.000Z',
      nodes: [
        node({
          id: 'task-1',
          node_type: 'task',
          title: '待办',
          meta: {
            task_items: [
              { id: 'a', label: '整理材料', done: true },
              { id: 'b', label: '撰写初稿', done: false },
            ],
          },
        }),
      ],
    });

    expect(markdown).toContain('- [x] 整理材料');
    expect(markdown).toContain('- [ ] 撰写初稿');
  });

  it('describes group hub containers clearly when exported', () => {
    const markdown = buildSelectedNodesMarkdown({
      canvasTitle: '分组',
      exportedAt: '2026-04-26T00:00:00.000Z',
      nodes: [
        node({
          id: 'hub-1',
          node_type: 'group_hub',
          title: '材料组',
        }),
      ],
    });

    expect(markdown).toContain('- 类型：节点组');
    expect(markdown).toContain('成员节点会在导出文件中按画布位置一并展开');
  });
});
