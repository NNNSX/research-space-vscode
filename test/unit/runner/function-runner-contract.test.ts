import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import type { CanvasFile, CanvasNode } from '../../../src/core/canvas-model';
import {
  calcOutputPosition,
  cancelRunByNodeId,
  reserveFunctionNodeRun,
  runFunctionNode,
  setToolRegistry,
} from '../../../src/ai/function-runner';

function createCanvas(nodes: CanvasNode[]): CanvasFile {
  return {
    version: '1.0',
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title: 'function-runner contract',
      created_at: '2026-04-21T00:00:00.000Z',
      updated_at: '2026-04-21T00:00:00.000Z',
    },
  };
}

describe('function-runner contract', () => {
  beforeEach(() => {
    setToolRegistry({
      get: vi.fn(() => undefined),
      buildSystem: vi.fn(() => ''),
      postProcess: vi.fn((_: string, raw: string) => raw),
    } as any);
  });

  it('returns a stable missing_config payload when ai_tool is missing', async () => {
    const webview = { postMessage: vi.fn() } as any;
    const canvas = createCanvas([
      {
        id: 'fn-missing-tool',
        node_type: 'function',
        title: '坏节点',
        position: { x: 0, y: 0 },
        size: { width: 280, height: 220 },
        meta: {},
      },
    ]);

    const result = await runFunctionNode('fn-missing-tool', canvas, {} as any, webview);

    expect(result).toMatchObject({
      success: false,
      errorMessage: '找不到功能节点或 ai_tool 配置',
    });
    expect(result.runId).toEqual(expect.any(String));
    expect(result.outputNode).toBeUndefined();
    expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'aiError',
      nodeId: 'fn-missing-tool',
      issueKind: 'missing_config',
    }));
  });

  it('rejects duplicate runs while the same function node is already running', () => {
    const webview = { postMessage: vi.fn() } as any;
    expect(reserveFunctionNodeRun('fn-image', 'run-1', webview)).toBeNull();

    const duplicate = reserveFunctionNodeRun('fn-image', 'run-2', webview);
    expect(duplicate).toMatchObject({
      success: false,
      runId: 'run-1',
      errorMessage: '该功能节点已有任务正在运行，请等待完成或先停止后再运行。',
    });
    expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'aiError',
      nodeId: 'fn-image',
      message: '该功能节点已有任务正在运行，请等待完成或先停止后再运行。',
    }));

    cancelRunByNodeId('fn-image');
  });

  it('returns a stable missing_config payload when the tool registry cannot resolve the tool', async () => {
    const webview = { postMessage: vi.fn() } as any;
    const canvas = createCanvas([
      {
        id: 'fn-unknown-tool',
        node_type: 'function',
        title: '未知工具节点',
        position: { x: 0, y: 0 },
        size: { width: 280, height: 220 },
        meta: {
          ai_tool: 'summarize',
          param_values: {},
        },
      },
    ]);

    const result = await runFunctionNode('fn-unknown-tool', canvas, {} as any, webview);

    expect(result).toMatchObject({
      success: false,
      errorMessage: 'Unknown tool: summarize',
    });
    expect(result.runId).toEqual(expect.any(String));
    expect(result.outputNode).toBeUndefined();
    expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'aiError',
      nodeId: 'fn-unknown-tool',
      issueKind: 'missing_config',
      message: 'Unknown tool: summarize',
    }));
  });

  it('stacks repeated normal outputs beside the source function using blueprint-style offset', () => {
    const fnNode: CanvasNode = {
      id: 'fn-summary',
      node_type: 'function',
      title: '摘要节点',
      position: { x: 120, y: 160 },
      size: { width: 280, height: 220 },
      meta: {
        ai_tool: 'summarize',
        param_values: {},
      },
    };
    const canvas = createCanvas([
      fnNode,
      {
        id: 'out-1',
        node_type: 'ai_output',
        title: '摘要结果 1',
        position: { x: 472, y: 190 },
        size: { width: 280, height: 160 },
        file_path: 'outputs/summary_0421_120000.md',
        meta: {},
      },
      {
        id: 'out-2',
        node_type: 'ai_output',
        title: '摘要结果 2',
        position: { x: 472, y: 226 },
        size: { width: 280, height: 160 },
        file_path: 'outputs/summary_0421_120100.md',
        meta: {},
      },
    ]);
    canvas.edges = [
      {
        id: 'edge-1',
        source: 'fn-summary',
        target: 'out-1',
        edge_type: 'ai_generated',
      },
      {
        id: 'edge-2',
        source: 'fn-summary',
        target: 'out-2',
        edge_type: 'ai_generated',
      },
    ];

    expect(calcOutputPosition('fn-summary', fnNode, { width: 280, height: 160 }, canvas)).toEqual({
      x: 472,
      y: 262,
    });
  });

});
