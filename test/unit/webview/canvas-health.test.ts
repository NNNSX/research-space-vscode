import { describe, expect, it } from 'vitest';
import type { CanvasFile, CanvasNode } from '../../../src/core/canvas-model';
import { applyLowRiskCanvasHealthRepairs, buildCanvasHealthReport } from '../../../webview/src/utils/canvas-health';

function node(id: string, nodeType: CanvasNode['node_type'] = 'note'): CanvasNode {
  return {
    id,
    node_type: nodeType,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 280, height: 160 },
    meta: {},
  };
}

function baseCanvas(): CanvasFile {
  return {
    version: '1.0',
    nodes: [node('a'), node('b'), node('hub', 'group_hub')],
    edges: [
      { id: 'valid-edge', source: 'a', target: 'b', edge_type: 'data_flow' },
      { id: 'valid-hub-edge', source: 'a', target: 'hub', edge_type: 'hub_member' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title: 'health',
      created_at: '2026-04-25T00:00:00.000Z',
      updated_at: '2026-04-25T00:00:00.000Z',
    },
    boards: [],
    nodeGroups: [
      {
        id: 'group-1',
        name: '组 1',
        hubNodeId: 'hub',
        nodeIds: ['a', 'b'],
        bounds: { x: 0, y: 0, width: 400, height: 240 },
        collapsed: false,
      },
    ],
    stagingNodes: [],
  };
}

describe('canvas health diagnostics', () => {
  it('reports hanging edges and creates low-risk repair plans', () => {
    const canvas = baseCanvas();
    canvas.edges.push(
      { id: 'missing-source', source: 'ghost', target: 'a', edge_type: 'data_flow' },
      { id: 'missing-target', source: 'a', target: 'ghost', edge_type: 'data_flow' },
    );

    const report = buildCanvasHealthReport(canvas);

    expect(report.summary.error).toBe(2);
    expect(report.issues.map(issue => issue.id)).toContain('edge-missing-source-missing-source');
    expect(report.issues.map(issue => issue.id)).toContain('edge-missing-target-missing-target');
    expect(report.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId: 'edge-missing-source-missing-source', risk: 'low' }),
      expect.objectContaining({ issueId: 'edge-missing-target-missing-target', risk: 'low' }),
    ]));
  });

  it('applies only low-risk repairs for hanging edges and group member references', () => {
    const canvas = baseCanvas();
    canvas.edges.push(
      { id: 'missing-source', source: 'ghost', target: 'a', edge_type: 'data_flow' },
      { id: 'missing-target', source: 'a', target: 'ghost', edge_type: 'data_flow' },
    );
    canvas.nodeGroups![0].nodeIds = ['a', 'ghost-member', 'b', 'b'];

    const result = applyLowRiskCanvasHealthRepairs(canvas);

    expect(result.changed).toBe(true);
    expect(result.appliedCount).toBe(4);
    expect(result.canvas.edges.map(edge => edge.id)).toEqual(['valid-edge', 'valid-hub-edge']);
    expect(result.canvas.nodeGroups?.[0].nodeIds).toEqual(['a', 'b']);
    expect(result.canvas.nodes.map(existingNode => existingNode.id)).toEqual(['a', 'b', 'hub']);
  });

  it('does not execute medium-risk repairs', () => {
    const canvas = baseCanvas();
    canvas.nodes.push(node('orphan-hub', 'group_hub'));
    canvas.nodeGroups![0].hubNodeId = 'missing-hub';

    const report = buildCanvasHealthReport(canvas);
    expect(report.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId: 'group-missing-hub-group-1', risk: 'medium' }),
      expect.objectContaining({ issueId: 'orphan-hub-hub', risk: 'medium' }),
      expect.objectContaining({ issueId: 'orphan-hub-orphan-hub', risk: 'medium' }),
    ]));

    const result = applyLowRiskCanvasHealthRepairs(canvas);
    expect(result.changed).toBe(false);
    expect(result.appliedCount).toBe(0);
    expect(result.canvas.nodes.some(existingNode => existingNode.id === 'orphan-hub')).toBe(true);
    expect(result.canvas.nodeGroups?.[0].hubNodeId).toBe('missing-hub');
  });

  it('keeps a clean canvas unchanged', () => {
    const canvas = baseCanvas();
    const result = applyLowRiskCanvasHealthRepairs(canvas);

    expect(result.changed).toBe(false);
    expect(result.appliedCount).toBe(0);
    expect(result.canvas).toBe(canvas);
    expect(buildCanvasHealthReport(canvas).summary.error).toBe(0);
  });
});
