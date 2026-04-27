import { describe, expect, it } from 'vitest';

import { buildCitationCoverageDisplay } from '../../../webview/src/utils/citation-coverage';

import type { NodeMeta } from '../../../src/core/canvas-model';

describe('citation coverage display', () => {
  it('builds a compact badge and detailed hover text from AI output metadata', () => {
    const meta: NodeMeta = {
      ai_source_nodes: [
        { id: 'paper-a', label: '资料1', title: '论文 A', node_type: 'paper', file_path: 'papers/a.pdf' },
        { id: 'note-b', label: '资料2', title: '笔记 B', node_type: 'note' },
      ],
      ai_citation_coverage: {
        expectedLabels: ['资料1', '资料2'],
        citedLabels: ['资料1'],
        missingLabels: ['资料2'],
        unknownLabels: ['资料3'],
        citationCount: 2,
      },
      ai_citation_warning: '未看到 [资料2] 的正文引用；检测到未连接来源标签 [资料3]；请检查引用是否完整、准确。',
    };

    const display = buildCitationCoverageDisplay(meta);

    expect(display).toEqual(expect.objectContaining({
      badgeText: '1/2 来源',
      hasWarning: true,
    }));
    expect(display?.tooltip).toContain('文内引用覆盖：1/2 个来源');
    expect(display?.tooltip).toContain('[资料1] 论文 A · papers/a.pdf');
    expect(display?.tooltip).toContain('[资料2] 笔记 B');
    expect(display?.tooltip).toContain('未连接标签：');
    expect(display?.tooltip).toContain('[资料3]');
    expect(display?.tooltip).toContain('提醒：未看到 [资料2]');
  });

  it('returns null when there is no citation coverage metadata', () => {
    expect(buildCitationCoverageDisplay({})).toBeNull();
  });
});
