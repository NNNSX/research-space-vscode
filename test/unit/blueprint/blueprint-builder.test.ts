import { describe, expect, it } from 'vitest';
import { buildBlueprintDraftFromInstance, buildBlueprintDraftFromSelection } from '../../../src/blueprint/blueprint-builder';
import { loadCanvasFixture } from '../helpers/load-canvas-fixture';

describe('blueprint-builder', () => {
  it('builds a selection draft with stable input/output slots', () => {
    const canvas = loadCanvasFixture('selection-basic.rsws');

    const draft = buildBlueprintDraftFromSelection([
      'input-note',
      'summarize-fn',
      'summary-output',
    ], canvas);

    expect(draft.function_nodes).toHaveLength(1);
    expect(draft.input_slots).toHaveLength(1);
    expect(draft.output_slots).toHaveLength(1);
    expect(draft.data_nodes).toHaveLength(0);
    expect(draft.issues).toHaveLength(0);
    expect(draft.input_slots[0]).toMatchObject({
      kind: 'input',
      title: '输入笔记',
      placeholder_style: 'input_placeholder',
    });
    expect(draft.output_slots[0]).toMatchObject({
      kind: 'output',
      title: '输出结果 · 摘要',
      placeholder_style: 'output_placeholder',
      source_function_node_id: 'summarize-fn',
    });
    expect(draft.edges).toEqual([
      expect.objectContaining({ edge_type: 'data_flow', role: undefined }),
      expect.objectContaining({ edge_type: 'data_flow' }),
    ]);
  });

  it('builds instance drafts with synthetic terminal output slots', () => {
    const canvas = loadCanvasFixture('blueprint-instance-synthetic-output.rsws');

    const draft = buildBlueprintDraftFromInstance('bp-container', canvas);

    expect(draft.function_nodes).toHaveLength(1);
    expect(draft.output_slots).toHaveLength(1);
    expect(draft.output_slots[0]).toMatchObject({
      kind: 'output',
      title: '输出结果 · 摘要节点',
      source_function_node_id: 'fn-1',
      placeholder_style: 'output_placeholder',
    });
    expect(draft.edges).toContainEqual(expect.objectContaining({
      edge_type: 'data_flow',
      source: expect.objectContaining({ kind: 'function_node', id: 'fn-1' }),
      target: expect.objectContaining({ kind: 'output_slot', id: draft.output_slots[0].id }),
    }));
  });
});
