import { describe, expect, it } from 'vitest';

import type { CanvasNode } from '../../../src/core/canvas-model';
import {
  buildAiOutputProvenance,
  hasInlineCitationLabels,
  labelAiContentsForInlineCitations,
  withInlineCitationInstruction,
} from '../../../src/ai/output-provenance';

describe('AI output provenance', () => {
  it('builds inline citation instructions and meta-friendly source refs from connected nodes', () => {
    const sourceNodes: CanvasNode[] = [
      {
        id: 'paper-1',
        node_type: 'paper',
        title: '论文 A',
        position: { x: 0, y: 0 },
        size: { width: 240, height: 160 },
        file_path: 'papers/a.pdf',
        meta: {},
      },
      {
        id: 'note-1',
        node_type: 'note',
        title: '实验记录',
        position: { x: 0, y: 200 },
        size: { width: 240, height: 160 },
        file_path: 'notes/exp.md',
        meta: {},
      },
    ];

    const provenance = buildAiOutputProvenance({
      sourceNodes,
      toolName: '摘要',
    });

    expect(provenance.sourceNodes).toEqual([
      { id: 'paper-1', label: '资料1', title: '论文 A', node_type: 'paper', file_path: 'papers/a.pdf' },
      { id: 'note-1', label: '资料2', title: '实验记录', node_type: 'note', file_path: 'notes/exp.md' },
    ]);
    expect(provenance.citationInstruction).toContain('【文内引用要求】');
    expect(provenance.citationInstruction).toContain('本次工具：摘要');
    expect(provenance.citationInstruction).toContain('[资料1] 论文 A（paper，文件：papers/a.pdf）');
    expect(provenance.citationInstruction).toContain('不要在输出末尾额外添加“依据说明”');
    expect(withInlineCitationInstruction('system', provenance)).toContain('system\n\n【文内引用要求】');
  });

  it('keeps no-input chat outputs explicit instead of pretending there are sources', () => {
    const provenance = buildAiOutputProvenance({
      sourceNodes: [],
      toolName: '自由对话',
    });

    expect(provenance.sourceSummary).toBe('未连接外部输入节点，仅使用用户在功能节点中填写的指令或问题。');
    expect(provenance.citationInstruction).toBe('');
  });

  it('labels input content titles so models can cite stable source labels', () => {
    const contents = [{ title: '论文 A' }, { title: '实验记录' }];
    const sourceNodes = [
      {
        id: 'paper-1',
        node_type: 'paper',
        title: '论文 A',
        position: { x: 0, y: 0 },
        size: { width: 240, height: 160 },
      },
      {
        id: 'note-1',
        node_type: 'note',
        title: '实验记录',
        position: { x: 0, y: 200 },
        size: { width: 240, height: 160 },
      },
    ] satisfies CanvasNode[];

    labelAiContentsForInlineCitations(contents, sourceNodes);

    expect(contents.map(content => content.title)).toEqual(['资料1 · 论文 A', '资料2 · 实验记录']);
  });

  it('detects inline citation labels in generated text', () => {
    expect(hasInlineCitationLabels('该结论来自实验记录 [资料2]。')).toBe(true);
    expect(hasInlineCitationLabels('该结论来自实验记录。')).toBe(false);
  });
});
