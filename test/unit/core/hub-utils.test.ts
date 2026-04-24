import { describe, expect, it } from 'vitest';
import { collectExpandedInputs } from '../../../src/core/hub-utils';
import type { CanvasFile } from '../../../src/core/canvas-model';

describe('collectExpandedInputs', () => {
  it('expands group hub inputs in node-group order so AI can read relation note, text, and image together', () => {
    const canvas: CanvasFile = {
      version: '1.0',
      nodes: [
        {
          id: 'group-hub-1',
          node_type: 'group_hub',
          title: '拆解组',
          position: { x: 0, y: 0 },
          size: { width: 400, height: 240 },
          meta: {
            hub_group_id: 'group-1',
            input_order: ['relation-note', 'page-note', 'page-image'],
          },
        },
        {
          id: 'relation-note',
          node_type: 'note',
          title: '文档关系索引',
          position: { x: 0, y: 0 },
          size: { width: 280, height: 160 },
          file_path: 'exploded/0000-document-relations.md',
          meta: {
            explode_order: -1,
            explode_kind: 'text',
          },
        },
        {
          id: 'page-note',
          node_type: 'note',
          title: '第 1 页文本',
          position: { x: 0, y: 0 },
          size: { width: 280, height: 160 },
          file_path: 'exploded/0001-page-1.md',
          meta: {
            explode_order: 0,
            explode_kind: 'text',
          },
        },
        {
          id: 'page-image',
          node_type: 'image',
          title: '第 1 页图片 1',
          position: { x: 0, y: 0 },
          size: { width: 240, height: 200 },
          file_path: 'exploded/figure-1.png',
          meta: {
            explode_order: 1,
            explode_kind: 'image',
          },
        },
        {
          id: 'ai-node',
          node_type: 'function',
          title: '总结',
          position: { x: 800, y: 0 },
          size: { width: 280, height: 220 },
          meta: {
            ai_tool: 'summarize',
          },
        },
      ],
      edges: [
        {
          id: 'e-1',
          source: 'relation-note',
          target: 'group-hub-1',
          edge_type: 'hub_member',
        },
        {
          id: 'e-2',
          source: 'page-note',
          target: 'group-hub-1',
          edge_type: 'hub_member',
        },
        {
          id: 'e-3',
          source: 'page-image',
          target: 'group-hub-1',
          edge_type: 'hub_member',
        },
        {
          id: 'e-4',
          source: 'group-hub-1',
          target: 'ai-node',
          edge_type: 'data_flow',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        title: 'hub-utils-test',
        created_at: '2026-04-23T00:00:00.000Z',
        updated_at: '2026-04-23T00:00:00.000Z',
      },
      nodeGroups: [
        {
          id: 'group-1',
          name: '拆解组',
          hubNodeId: 'group-hub-1',
          sourceNodeId: 'paper-1',
          nodeIds: ['relation-note', 'page-note', 'page-image'],
          bounds: { x: 0, y: 0, width: 400, height: 240 },
          collapsed: false,
        },
      ],
      boards: [],
      stagingNodes: [],
    };

    const expanded = collectExpandedInputs('ai-node', canvas);

    expect(expanded.map(item => item.node.id)).toEqual(['relation-note', 'page-note', 'page-image']);
    expect(expanded.map(item => item.viaHubId)).toEqual(['group-hub-1', 'group-hub-1', 'group-hub-1']);
  });
});
