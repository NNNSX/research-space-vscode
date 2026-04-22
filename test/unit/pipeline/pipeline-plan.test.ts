import { describe, expect, it } from 'vitest';
import { buildPipelinePlanForNodeSet } from '../../../src/pipeline/pipeline-engine';
import { loadCanvasFixture } from '../helpers/load-canvas-fixture';

describe('pipeline-plan', () => {
  it('builds layered execution order for a simple pipeline chain', () => {
    const canvas = loadCanvasFixture('pipeline-basic.rsws');
    const plan = buildPipelinePlanForNodeSet(['fn-1', 'fn-2'], canvas.nodes, canvas.edges, canvas.nodeGroups);

    if ('error' in plan) {
      throw new Error(plan.error);
    }

    expect(plan.layers).toHaveLength(2);
    expect(plan.layers[0].nodeIds).toEqual(['fn-1']);
    expect(plan.layers[1].nodeIds).toEqual(['fn-2']);
    expect(plan.dependencyNodeIdsByNode['fn-1']).toEqual([]);
    expect(plan.dependencyNodeIdsByNode['fn-2']).toEqual(['fn-1']);
    expect(plan.pipelineEdges).toEqual([
      expect.objectContaining({ source: 'fn-1', target: 'fn-2', edge_type: 'pipeline_flow' }),
    ]);
  });
});
