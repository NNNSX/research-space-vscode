import { describe, expect, it } from 'vitest';
import type { CanvasFile, CanvasNode } from '../../../src/core/canvas-model';
import { extractPetPerception, inferPetPhase, inferPetScene } from '../../../src/pet/pet-perception';
import { extractCanvasContext, formatContextForAI } from '../../../src/pet/pet-context';

function node(id: string, node_type: CanvasNode['node_type'], title: string, x = 0, y = 0, meta: CanvasNode['meta'] = {}): CanvasNode {
  return {
    id,
    node_type,
    title,
    position: { x, y },
    size: { width: 100, height: 80 },
    meta,
  };
}

function canvas(nodes: CanvasNode[]): CanvasFile {
  return {
    version: '1.0',
    nodes,
    edges: [{ id: 'e1', source: 'p1', target: 'fn1', edge_type: 'data_flow' }],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title: '论文画布',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    boards: [{ id: 'b1', name: '资料区', color: 'rgba(0,0,0,0.1)', borderColor: '#999', bounds: { x: -10, y: -10, width: 260, height: 160 } }],
    nodeGroups: [{ id: 'g1', name: '输入材料', hubNodeId: 'hub1', nodeIds: ['p1'], bounds: { x: 0, y: 0, width: 100, height: 80 }, collapsed: false }],
  };
}

describe('pet perception', () => {
  it('extracts scene, phase, structure and friction signals from canvas', () => {
    const file = canvas([
      node('p1', 'paper', '核心论文', 0, 0),
      node('fn1', 'function', '摘要工具', 150, 0, { fn_status: 'done' }),
      node('out1', 'ai_output', '摘要输出', 320, 0, { content_preview: '这是一段论文摘要输出。' }),
      node('mm1', 'mindmap', '论文结构导图', 0, 180, { mindmap_summary: { rootTitle: '论文结构', firstLevelCount: 3, firstLevelTitles: ['问题', '方法', '材料'], totalItems: 6, imageCount: 0, outlinePreview: '- 问题' } }),
      node('free1', 'note', '孤立笔记', 480, 0),
      node('free2', 'note', '孤立笔记 2', 580, 0),
      node('free3', 'note', '孤立笔记 3', 680, 0),
      node('free4', 'note', '孤立笔记 4', 780, 0),
      node('free5', 'note', '孤立笔记 5', 880, 0),
    ]);

    const snapshot = extractPetPerception(file);

    expect(snapshot.scene).toBe('paper');
    expect(snapshot.phase).toBe('organizing');
    expect(snapshot.nodeStats.paper).toBe(1);
    expect(snapshot.boards[0]).toMatchObject({ name: '资料区', nodeCount: 2 });
    expect(snapshot.nodeGroupCount).toBe(1);
    expect(snapshot.mindmaps[0]).toMatchObject({ title: '论文结构导图', firstLevelCount: 3, totalItems: 6 });
    expect(snapshot.recentOutputPreviews[0]).toContain('论文摘要');
    expect(snapshot.frictionSignals.some(signal => signal.type === 'many_isolated_nodes')).toBe(true);
  });

  it('detects mixed writing scenes from canvas text', () => {
    const file = canvas([
      node('n1', 'note', '项目书 风险分析'),
      node('n2', 'note', '专利 权利要求'),
    ]);

    expect(inferPetScene(file)).toBe('mixed');
  });

  it('formats richer canvas context for pet AI', () => {
    const file = canvas([
      node('p1', 'paper', '文献 A'),
      node('fn1', 'function', '文献综述', 150, 0, { fn_status: 'running' }),
    ]);

    const ctx = extractCanvasContext(file);
    const text = formatContextForAI(ctx);

    expect(inferPetPhase(file, ctx.nodeStats)).toBe('processing');
    expect(text).toContain('场景判断: paper');
    expect(text).toContain('阶段判断: processing');
    expect(text).toContain('画板: 资料区');
  });
});
