import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasFile } from '../../../src/core/canvas-model';
import type { PipelinePlan } from '../../../src/pipeline/pipeline-engine';
import type { AIContent } from '../../../src/ai/provider';

const buildPipelinePlanForNodeSetMock = vi.fn();
const runPipelinePlanMock = vi.fn();
const extractContentMock = vi.fn();

vi.mock('../../../src/pipeline/pipeline-engine', () => ({
  buildPipelinePlanForNodeSet: buildPipelinePlanForNodeSetMock,
}));

vi.mock('../../../src/pipeline/pipeline-runner', () => ({
  runPipelinePlan: runPipelinePlanMock,
}));

vi.mock('../../../src/core/content-extractor', () => ({
  extractContent: extractContentMock,
}));

function createResumeCanvas(): CanvasFile {
  return {
    version: '1.0',
    nodes: [
      {
        id: 'bp-container',
        node_type: 'blueprint',
        title: '失败恢复蓝图',
        position: { x: 120, y: 100 },
        size: { width: 900, height: 520 },
        meta: {
          blueprint_instance_id: 'inst-resume-output',
          blueprint_def_id: 'bp-def-resume-output',
          blueprint_color: '#2f7d68',
          blueprint_last_run_status: 'failed',
          blueprint_last_issue_node_id: 'fn-downstream',
          blueprint_last_issue_node_title: '下游步骤',
          blueprint_input_slot_defs: [],
          blueprint_output_slot_defs: [
            {
              id: 'output_slot_summary',
              kind: 'output',
              title: '输出结果 · 摘要节点',
              required: false,
              allow_multiple: false,
              accepts: ['ai_output'],
              source_function_node_id: 'fn-downstream',
              placeholder_style: 'output_placeholder',
              replacement_mode: 'attach_by_edge',
              rect: { x: 500, y: 150, width: 240, height: 136 },
            },
          ],
        },
      },
      {
        id: 'fn-upstream',
        node_type: 'function',
        title: '上游步骤',
        position: { x: 220, y: 180 },
        size: { width: 280, height: 220 },
        meta: {
          blueprint_instance_id: 'inst-resume-output',
          blueprint_def_id: 'bp-def-resume-output',
          blueprint_color: '#2f7d68',
          ai_tool: 'summarize',
          param_values: {},
          fn_status: 'done',
        },
      },
      {
        id: 'fn-downstream',
        node_type: 'function',
        title: '下游步骤',
        position: { x: 640, y: 180 },
        size: { width: 280, height: 220 },
        meta: {
          blueprint_instance_id: 'inst-resume-output',
          blueprint_def_id: 'bp-def-resume-output',
          blueprint_color: '#2f7d68',
          ai_tool: 'review',
          param_values: {},
          fn_status: 'error',
        },
      },
      {
        id: 'output-upstream',
        node_type: 'ai_output',
        title: '上游输出',
        position: { x: 540, y: 210 },
        size: { width: 240, height: 160 },
        file_path: 'outputs/upstream_20260421_1.md',
      },
      {
        id: 'bound-output-old',
        node_type: 'ai_output',
        title: '旧最终输出',
        position: { x: 900, y: 250 },
        size: { width: 240, height: 160 },
        file_path: 'outputs/final_20260421_1.md',
        meta: {
          blueprint_def_id: 'bp-def-resume-output',
          blueprint_color: '#2f7d68',
          blueprint_bound_instance_id: 'inst-resume-output',
          blueprint_bound_slot_id: 'output_slot_summary',
          blueprint_bound_slot_title: '输出结果 · 摘要节点',
          blueprint_bound_slot_kind: 'output',
        },
      },
    ],
    edges: [
      {
        id: 'edge-upstream-pipeline',
        source: 'fn-upstream',
        target: 'fn-downstream',
        edge_type: 'pipeline_flow',
      },
      {
        id: 'edge-upstream-output',
        source: 'fn-upstream',
        target: 'output-upstream',
        edge_type: 'ai_generated',
      },
      {
        id: 'edge-downstream-old-final',
        source: 'fn-downstream',
        target: 'bound-output-old',
        edge_type: 'ai_generated',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title: '蓝图失败恢复输出历史',
      created_at: '2026-04-21T00:00:00.000Z',
      updated_at: '2026-04-21T00:00:00.000Z',
    },
  };
}

describe('blueprint-runner resume regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resumes from the failed blueprint node while reusing successful upstream outputs and leaving old final history as history', async () => {
    const { runBlueprintInstance } = await import('../../../src/blueprint/blueprint-runner');
    const canvas = createResumeCanvas();
    const plan: PipelinePlan = {
      layers: [
        { nodeIds: ['fn-upstream'] },
        { nodeIds: ['fn-downstream'] },
      ],
      pipelineNodeIds: ['fn-upstream', 'fn-downstream'],
      pipelineEdges: [
        {
          id: 'edge-upstream-pipeline',
          source: 'fn-upstream',
          target: 'fn-downstream',
          edge_type: 'pipeline_flow',
        },
      ],
      nodeExecutionPlans: {
        'fn-upstream': {
          targetNodeId: 'fn-upstream',
          targetNodeTitle: '上游步骤',
          directDataSourceIds: [],
          directPipelineSourceIds: [],
          nodeGroupHubIds: [],
          expansionNodeIds: [],
          executionNodeIds: [],
          inputContents: [],
        },
        'fn-downstream': {
          targetNodeId: 'fn-downstream',
          targetNodeTitle: '下游步骤',
          directDataSourceIds: ['output-upstream'],
          directPipelineSourceIds: ['fn-upstream'],
          nodeGroupHubIds: [],
          expansionNodeIds: [],
          executionNodeIds: [],
          inputContents: [],
        },
      },
      dependencyNodeIdsByNode: {
        'fn-upstream': [],
        'fn-downstream': ['fn-upstream'],
      },
    };
    const upstreamContent: AIContent = {
      type: 'text',
      title: '上游步骤',
      text: 'cached upstream content',
    };
    const webview = { postMessage: vi.fn() } as any;
    const canvasUri = { fsPath: '/tmp/research-space/blueprint-resume.rsws' } as any;

    buildPipelinePlanForNodeSetMock.mockReturnValue(plan);
    extractContentMock.mockResolvedValue(upstreamContent);
    runPipelinePlanMock.mockResolvedValue(undefined);

    await runBlueprintInstance('bp-container', canvas, canvasUri, webview, { resumeFromFailure: true });

    expect(extractContentMock).toHaveBeenCalledTimes(1);
    expect(extractContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'output-upstream' }),
      canvasUri,
    );
    expect(runPipelinePlanMock).toHaveBeenCalledTimes(1);

    const [, , , , , options] = runPipelinePlanMock.mock.calls[0] as [string, PipelinePlan, CanvasFile, unknown, unknown, {
      initialNodeStatuses?: Map<string, string>;
      initialOutputContents?: Map<string, AIContent>;
      initialOutputNodes?: Map<string, unknown>;
      runMode?: 'full' | 'resume';
      reusedCachedNodeCount?: number;
    }];

    expect(options.runMode).toBe('resume');
    expect(options.reusedCachedNodeCount).toBe(1);
    expect(options.initialNodeStatuses?.get('fn-upstream')).toBe('done');
    expect(options.initialNodeStatuses?.get('fn-downstream')).toBe('waiting');
    expect(options.initialOutputContents?.get('fn-upstream')).toEqual(upstreamContent);
    expect(options.initialOutputNodes?.get('fn-upstream')).toEqual(expect.objectContaining({ id: 'output-upstream' }));
    expect(options.initialOutputNodes?.has('fn-downstream')).toBe(false);
  });

  it('rejects blueprint resume when the last run was not failed', async () => {
    const { runBlueprintInstance } = await import('../../../src/blueprint/blueprint-runner');
    const canvas = createResumeCanvas();
    const webview = { postMessage: vi.fn() } as any;
    const canvasUri = { fsPath: '/tmp/research-space/blueprint-resume.rsws' } as any;

    const container = canvas.nodes.find(node => node.id === 'bp-container');
    if (!container) {
      throw new Error('missing blueprint container');
    }
    container.meta = {
      ...(container.meta ?? {}),
      blueprint_last_run_status: 'succeeded',
    };

    buildPipelinePlanForNodeSetMock.mockReturnValue({
      layers: [{ nodeIds: ['fn-upstream', 'fn-downstream'] }],
      pipelineNodeIds: ['fn-upstream', 'fn-downstream'],
      pipelineEdges: [],
      nodeExecutionPlans: {},
      dependencyNodeIdsByNode: {
        'fn-upstream': [],
        'fn-downstream': ['fn-upstream'],
      },
    } satisfies PipelinePlan);

    await runBlueprintInstance('bp-container', canvas, canvasUri, webview, { resumeFromFailure: true });

    expect(runPipelinePlanMock).not.toHaveBeenCalled();
    expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'blueprintRunRejected',
      containerNodeId: 'bp-container',
      runMode: 'resume',
    }));
  });
});
