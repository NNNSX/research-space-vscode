import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasEdge, CanvasFile, CanvasNode } from '../../../src/core/canvas-model';
import { BLUEPRINT_DEF_VERSION, type BlueprintDefinition } from '../../../src/blueprint/blueprint-types';
import { loadCanvasFixture } from '../helpers/load-canvas-fixture';

vi.mock('../../../webview/src/bridge', () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(() => () => {}),
  saveState: vi.fn(),
  getState: vi.fn(() => null),
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function loadFreshCanvasStore() {
  vi.resetModules();
  return import('../../../webview/src/stores/canvas-store');
}

async function loadBridgeMock() {
  return import('../../../webview/src/bridge');
}

function snapshotOutputChain(nodes: CanvasNode[], edges: CanvasEdge[]) {
  const placeholder = nodes.find(node => node.id === 'output-placeholder');
  const boundOutput = nodes.find(node => node.id === 'bound-output');
  return {
    placeholder: placeholder ? {
      position: placeholder.position,
      size: placeholder.size,
      slotId: placeholder.meta?.blueprint_placeholder_slot_id,
      kind: placeholder.meta?.blueprint_placeholder_kind,
    } : null,
    boundOutput: boundOutput ? {
      position: boundOutput.position,
      size: boundOutput.size,
      slotId: boundOutput.meta?.blueprint_bound_slot_id,
      kind: boundOutput.meta?.blueprint_bound_slot_kind,
    } : null,
    edges: edges
      .filter(edge =>
        (edge.source === 'fn-summary' && edge.target === 'output-placeholder') ||
        (edge.source === 'output-placeholder' && edge.target === 'bound-output')
      )
      .map(edge => ({
        source: edge.source,
        target: edge.target,
        edge_type: edge.edge_type,
        role: edge.role,
      }))
      .sort((a, b) => `${a.source}:${a.target}:${a.edge_type}:${a.role ?? ''}`.localeCompare(`${b.source}:${b.target}:${b.edge_type}:${b.role ?? ''}`)),
  };
}

describe('canvas-store migration regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('migrates legacy summaryGroups into boards and keeps the result stable across reopen', async () => {
    const legacyCanvas: CanvasFile = {
      version: '1.0',
      nodes: [],
      edges: [],
      viewport: { x: 12, y: 34, zoom: 1.25 },
      metadata: {
        title: 'legacy-summary-groups',
        created_at: '2026-04-21T00:00:00.000Z',
        updated_at: '2026-04-21T00:00:00.000Z',
      },
      boards: [
        {
          id: 'board-modern',
          name: '现有画板',
          color: 'rgba(79,195,247,0.12)',
          borderColor: '#4fc3f7',
          bounds: { x: 0, y: 0, width: 640, height: 360 },
        },
      ],
      summaryGroups: [
        {
          id: 'board-legacy',
          name: '旧分组',
          color: '#ff8800',
          nodeIds: [],
          bounds: { x: 100, y: 120, width: 520, height: 280 },
        },
      ],
    };

    const { useCanvasStore } = await loadFreshCanvasStore();
    const bridge = await loadBridgeMock();

    useCanvasStore.getState().initCanvas(clone(legacyCanvas), '/tmp/research-space');
    const firstCanvas = clone(useCanvasStore.getState().canvasFile);

    expect(firstCanvas?.summaryGroups).toBeUndefined();
    expect(firstCanvas?.boards).toEqual([
      {
        id: 'board-modern',
        name: '现有画板',
        color: 'rgba(79,195,247,0.12)',
        borderColor: '#4fc3f7',
        bounds: { x: 0, y: 0, width: 640, height: 360 },
      },
      {
        id: 'board-legacy',
        name: '旧分组',
        color: 'rgba(255,136,0,0.12)',
        borderColor: '#ff8800',
        bounds: { x: 100, y: 120, width: 520, height: 280 },
      },
    ]);
    expect(vi.mocked(bridge.postMessage).mock.calls.some(([message]) =>
      message?.type === 'canvasChanged' &&
      Array.isArray(message.data?.boards) &&
      message.data.boards.length === 2 &&
      message.data.summaryGroups === undefined
    )).toBe(true);

    useCanvasStore.getState().initCanvas(clone(firstCanvas!), '/tmp/research-space');
    const secondCanvas = clone(useCanvasStore.getState().canvasFile);

    expect(secondCanvas).toEqual(firstCanvas);
  });

  it('synthesizes implicit blueprint output slots from legacy canvas structure and keeps them stable across reopen', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-instance-synthetic-output.rsws'));
    const { useCanvasStore } = await loadFreshCanvasStore();
    const bridge = await loadBridgeMock();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    const firstCanvas = clone(useCanvasStore.getState().canvasFile);
    const container = firstCanvas?.nodes.find(node => node.id === 'bp-container');

    expect(container?.meta?.blueprint_output_slots).toBe(1);
    expect(container?.meta?.blueprint_output_slot_defs).toHaveLength(1);
    expect(container?.meta?.blueprint_output_slot_defs?.[0]).toMatchObject({
      id: 'output_fn-1',
      kind: 'output',
      title: '输出结果 · 摘要节点',
      source_function_node_id: 'fn-1',
      placeholder_style: 'output_placeholder',
      replacement_mode: 'attach_by_edge',
    });
    expect(firstCanvas?.nodes.some(node => node.meta?.blueprint_placeholder_kind === 'output')).toBe(false);
    expect(vi.mocked(bridge.postMessage).mock.calls.some(([message]) =>
      message?.type === 'canvasChanged' &&
      Array.isArray(message.data?.nodes) &&
      message.data.nodes.some((node: CanvasNode) =>
        node.id === 'bp-container' &&
        node.meta?.blueprint_output_slots === 1 &&
        Array.isArray(node.meta?.blueprint_output_slot_defs) &&
        node.meta.blueprint_output_slot_defs.length === 1
      )
    )).toBe(true);

    useCanvasStore.getState().initCanvas(clone(firstCanvas!), '/tmp/research-space');
    const secondCanvas = clone(useCanvasStore.getState().canvasFile);

    expect(secondCanvas).toEqual(firstCanvas);
  });

  it('keeps bound blueprint outputs stable when matching definitions arrive later', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));
    const blueprintFilePath = '/tmp/research-space/blueprints/stable-output.blueprint.json';
    const container = canvas.nodes.find(node => node.id === 'bp-container');
    if (!container) {
      throw new Error('missing blueprint container fixture');
    }
    container.meta = {
      ...(container.meta ?? {}),
      blueprint_file_path: blueprintFilePath,
    };

    const definition: BlueprintDefinition = {
      version: BLUEPRINT_DEF_VERSION,
      id: 'bp-def-stable-output',
      title: '稳定输出蓝图',
      color: '#2f7d68',
      input_slots: [],
      intermediate_slots: [],
      output_slots: [
        {
          id: 'output_slot_summary',
          kind: 'output',
          title: '输出结果 · 摘要节点',
          required: false,
          allow_multiple: false,
          accepts: ['ai_output'],
          source_function_node_id: 'fn_def_summary',
          placeholder_style: 'output_placeholder',
          replacement_mode: 'attach_by_edge',
          binding_hint: '蓝图运行完成后，最终输出会优先回填到该占位位置。',
          rect: { x: 500, y: 150, width: 240, height: 136 },
        },
      ],
      data_nodes: [],
      function_nodes: [
        {
          id: 'fn_def_summary',
          title: '摘要节点',
          tool_id: 'summarize',
          rect: { x: 130, y: 120, width: 280, height: 220 },
        },
      ],
      edges: [
        {
          id: 'edge-def-summary-output',
          edge_type: 'data_flow',
          source: { kind: 'function_node', id: 'fn_def_summary' },
          target: { kind: 'output_slot', id: 'output_slot_summary' },
        },
      ],
      metadata: {
        created_at: '2026-04-21T00:00:00.000Z',
        source_canvas_title: '蓝图输出稳定性回归',
      },
    };

    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    const baselineCanvas = clone(useCanvasStore.getState().canvasFile);
    const baselineSnapshot = snapshotOutputChain(baselineCanvas?.nodes ?? [], baselineCanvas?.edges ?? []);

    useCanvasStore.getState().migrateBlueprintDefinitions([{ filePath: blueprintFilePath, definition }]);
    const firstCanvas = clone(useCanvasStore.getState().canvasFile);
    const firstSnapshot = snapshotOutputChain(firstCanvas?.nodes ?? [], firstCanvas?.edges ?? []);

    useCanvasStore.getState().migrateBlueprintDefinitions([{ filePath: blueprintFilePath, definition }]);
    const secondCanvas = clone(useCanvasStore.getState().canvasFile);
    const secondSnapshot = snapshotOutputChain(secondCanvas?.nodes ?? [], secondCanvas?.edges ?? []);

    const placeholder = secondCanvas?.nodes.find(node => node.id === 'output-placeholder');
    const boundOutput = secondCanvas?.nodes.find(node => node.id === 'bound-output');

    expect(firstSnapshot).toEqual(baselineSnapshot);
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(placeholder).toBeTruthy();
    expect(boundOutput).toBeTruthy();
    expect(boundOutput?.position.x).toBe((placeholder?.position.x ?? 0) + (placeholder?.size.width ?? 0) + 72);
    expect(secondCanvas?.edges.filter(edge =>
      edge.source === 'fn-summary' &&
      edge.target === 'output-placeholder' &&
      edge.edge_type === 'ai_generated'
    )).toHaveLength(1);
    expect(secondCanvas?.edges.filter(edge =>
      edge.source === 'output-placeholder' &&
      edge.target === 'bound-output' &&
      edge.edge_type === 'data_flow' &&
      edge.role === 'output_slot_summary'
    )).toHaveLength(1);
  });

  it('rebinds legacy implicit blueprint output history to explicit definition slots when definitions arrive later', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));
    const blueprintFilePath = '/tmp/research-space/blueprints/stable-output.blueprint.json';
    const container = canvas.nodes.find(node => node.id === 'bp-container');
    const boundOutput = canvas.nodes.find(node => node.id === 'bound-output');
    if (!container || !boundOutput) {
      throw new Error('missing blueprint output fixture nodes');
    }

    canvas.nodes = canvas.nodes.filter(node => node.id !== 'output-placeholder');
    canvas.edges = canvas.edges.filter(edge => edge.source !== 'output-placeholder' && edge.target !== 'output-placeholder');
    container.meta = {
      ...(container.meta ?? {}),
      blueprint_file_path: blueprintFilePath,
      blueprint_output_slots: 0,
      blueprint_output_slot_defs: [],
    };
    boundOutput.meta = {
      ...(boundOutput.meta ?? {}),
      blueprint_bound_slot_id: 'output_fn_def_summary',
      blueprint_bound_slot_title: '输出结果 · 摘要节点',
      blueprint_bound_slot_kind: 'output',
    };
    canvas.nodes.push({
      id: 'bound-output-2',
      node_type: 'ai_output',
      title: '摘要结果（历史）',
      position: { x: 620, y: 310 },
      size: { width: 240, height: 160 },
      file_path: 'outputs/summary_legacy_2.md',
      meta: {
        ai_provider: 'copilot',
        ai_model: 'gpt-4.1',
        blueprint_def_id: 'bp-def-stable-output',
        blueprint_color: '#2f7d68',
        blueprint_bound_instance_id: 'inst-stable-output',
        blueprint_bound_slot_id: 'output_fn_def_summary',
        blueprint_bound_slot_title: '输出结果 · 摘要节点',
        blueprint_bound_slot_kind: 'output',
      },
    });

    const definition: BlueprintDefinition = {
      version: BLUEPRINT_DEF_VERSION,
      id: 'bp-def-stable-output',
      title: '稳定输出蓝图',
      color: '#2f7d68',
      input_slots: [],
      intermediate_slots: [],
      output_slots: [
        {
          id: 'output_slot_summary',
          kind: 'output',
          title: '输出结果 · 摘要节点',
          required: false,
          allow_multiple: false,
          accepts: ['ai_output'],
          source_function_node_id: 'fn_def_summary',
          placeholder_style: 'output_placeholder',
          replacement_mode: 'attach_by_edge',
          binding_hint: '蓝图运行完成后，最终输出会优先回填到该占位位置。',
          rect: { x: 500, y: 150, width: 240, height: 136 },
        },
      ],
      data_nodes: [],
      function_nodes: [
        {
          id: 'fn_def_summary',
          title: '摘要节点',
          tool_id: 'summarize',
          rect: { x: 130, y: 120, width: 280, height: 220 },
        },
      ],
      edges: [
        {
          id: 'edge-def-summary-output',
          edge_type: 'data_flow',
          source: { kind: 'function_node', id: 'fn_def_summary' },
          target: { kind: 'output_slot', id: 'output_slot_summary' },
        },
      ],
      metadata: {
        created_at: '2026-04-21T00:00:00.000Z',
        source_canvas_title: '蓝图输出稳定性回归',
      },
    };

    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    useCanvasStore.getState().migrateBlueprintDefinitions([{ filePath: blueprintFilePath, definition }]);
    const migratedCanvas = clone(useCanvasStore.getState().canvasFile);

    const placeholder = migratedCanvas?.nodes.find(node =>
      node.meta?.blueprint_placeholder_kind === 'output' &&
      node.meta?.blueprint_placeholder_slot_id === 'output_slot_summary'
    );
    const reboundOutputs = migratedCanvas?.nodes.filter(node =>
      node.meta?.blueprint_bound_instance_id === 'inst-stable-output' &&
      node.meta?.blueprint_bound_slot_kind === 'output'
    ) ?? [];

    expect(migratedCanvas?.nodes.some(node =>
      node.meta?.blueprint_placeholder_kind === 'output' &&
      node.meta?.blueprint_placeholder_slot_id === 'output_fn_def_summary'
    )).toBe(false);
    expect(placeholder).toBeTruthy();
    expect(reboundOutputs).toHaveLength(2);
    expect(reboundOutputs.every(node => node.meta?.blueprint_bound_slot_id === 'output_slot_summary')).toBe(true);
    expect(migratedCanvas?.edges.filter(edge =>
      edge.source === placeholder?.id &&
      edge.edge_type === 'data_flow' &&
      edge.role === 'output_slot_summary'
    )).toHaveLength(2);
  });

  it('keeps manually placed legacy blueprint output history stable after definition rebind and rerun', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));
    const blueprintFilePath = '/tmp/research-space/blueprints/stable-output.blueprint.json';
    const container = canvas.nodes.find(node => node.id === 'bp-container');
    const boundOutput = canvas.nodes.find(node => node.id === 'bound-output');
    if (!container || !boundOutput) {
      throw new Error('missing blueprint output fixture nodes');
    }

    canvas.nodes = canvas.nodes.filter(node => node.id !== 'output-placeholder');
    canvas.edges = canvas.edges.filter(edge => edge.source !== 'output-placeholder' && edge.target !== 'output-placeholder');
    container.meta = {
      ...(container.meta ?? {}),
      blueprint_file_path: blueprintFilePath,
      blueprint_output_slots: 0,
      blueprint_output_slot_defs: [],
    };
    boundOutput.position = { x: 1120, y: 420 };
    boundOutput.meta = {
      ...(boundOutput.meta ?? {}),
      blueprint_bound_slot_id: 'output_fn_def_summary',
      blueprint_bound_slot_title: '输出结果 · 摘要节点',
      blueprint_bound_slot_kind: 'output',
      blueprint_output_position_manual: true,
    };
    canvas.nodes.push({
      id: 'bound-output-2',
      node_type: 'ai_output',
      title: '摘要结果（历史）',
      position: { x: 1280, y: 520 },
      size: { width: 240, height: 160 },
      file_path: 'outputs/summary_manual_2.md',
      meta: {
        ai_provider: 'copilot',
        ai_model: 'gpt-4.1',
        blueprint_def_id: 'bp-def-stable-output',
        blueprint_color: '#2f7d68',
        blueprint_bound_instance_id: 'inst-stable-output',
        blueprint_bound_slot_id: 'output_fn_def_summary',
        blueprint_bound_slot_title: '输出结果 · 摘要节点',
        blueprint_bound_slot_kind: 'output',
        blueprint_output_position_manual: true,
      },
    });

    const definition: BlueprintDefinition = {
      version: BLUEPRINT_DEF_VERSION,
      id: 'bp-def-stable-output',
      title: '稳定输出蓝图',
      color: '#2f7d68',
      input_slots: [],
      intermediate_slots: [],
      output_slots: [
        {
          id: 'output_slot_summary',
          kind: 'output',
          title: '输出结果 · 摘要节点',
          required: false,
          allow_multiple: false,
          accepts: ['ai_output'],
          source_function_node_id: 'fn_def_summary',
          placeholder_style: 'output_placeholder',
          replacement_mode: 'attach_by_edge',
          binding_hint: '蓝图运行完成后，最终输出会优先回填到该占位位置。',
          rect: { x: 500, y: 150, width: 240, height: 136 },
        },
      ],
      data_nodes: [],
      function_nodes: [
        {
          id: 'fn_def_summary',
          title: '摘要节点',
          tool_id: 'summarize',
          rect: { x: 130, y: 120, width: 280, height: 220 },
        },
      ],
      edges: [
        {
          id: 'edge-def-summary-output',
          edge_type: 'data_flow',
          source: { kind: 'function_node', id: 'fn_def_summary' },
          target: { kind: 'output_slot', id: 'output_slot_summary' },
        },
      ],
      metadata: {
        created_at: '2026-04-21T00:00:00.000Z',
        source_canvas_title: '蓝图输出稳定性回归',
      },
    };

    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    useCanvasStore.getState().migrateBlueprintDefinitions([{ filePath: blueprintFilePath, definition }]);

    const reboundCanvas = clone(useCanvasStore.getState().canvasFile);
    const placeholder = reboundCanvas?.nodes.find(node =>
      node.meta?.blueprint_placeholder_kind === 'output' &&
      node.meta?.blueprint_placeholder_slot_id === 'output_slot_summary'
    );
    const reboundOutput1 = reboundCanvas?.nodes.find(node => node.id === 'bound-output');
    const reboundOutput2 = reboundCanvas?.nodes.find(node => node.id === 'bound-output-2');

    expect(placeholder).toBeTruthy();
    expect(reboundOutput1?.position).toEqual({ x: 1120, y: 420 });
    expect(reboundOutput2?.position).toEqual({ x: 1280, y: 520 });
    expect(reboundOutput1?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');
    expect(reboundOutput2?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');

    useCanvasStore.getState().finishAiRun(
      'run-history-3',
      {
        id: 'bound-output-3',
        node_type: 'ai_output',
        title: '摘要结果（第三次）',
        position: { x: 0, y: 0 },
        size: { width: 240, height: 160 },
        file_path: 'outputs/summary_0421_223000.md',
        meta: {
          ai_provider: 'copilot',
          ai_model: 'gpt-4.1',
        },
      },
      {
        id: 'edge-fn-to-output-3',
        source: 'fn-summary',
        target: 'bound-output-3',
        edge_type: 'ai_generated',
      },
    );

    const rerunCanvas = clone(useCanvasStore.getState().canvasFile);
    const rerunOutput1 = rerunCanvas?.nodes.find(node => node.id === 'bound-output');
    const rerunOutput2 = rerunCanvas?.nodes.find(node => node.id === 'bound-output-2');
    const rerunOutput3 = rerunCanvas?.nodes.find(node => node.id === 'bound-output-3');

    expect(rerunOutput1?.position).toEqual({ x: 1120, y: 420 });
    expect(rerunOutput2?.position).toEqual({ x: 1280, y: 520 });
    expect(rerunOutput3?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');
    expect(rerunOutput3?.position.x).toBe((placeholder?.position.x ?? 0) + (placeholder?.size.width ?? 0) + 72);
    expect(rerunOutput3?.position.y).toBe((placeholder?.position.y ?? 0) + Math.max(((placeholder?.size.height ?? 0) - (rerunOutput3?.size.height ?? 0)) / 2, 0) + (2 * 36));
    expect(rerunCanvas?.edges.filter(edge =>
      edge.source === placeholder?.id &&
      edge.edge_type === 'data_flow' &&
      edge.role === 'output_slot_summary'
    )).toHaveLength(3);
  });

  it('keeps mixed manual and auto-positioned legacy blueprint output history stable after definition rebind and rerun', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));
    const blueprintFilePath = '/tmp/research-space/blueprints/stable-output.blueprint.json';
    const container = canvas.nodes.find(node => node.id === 'bp-container');
    const boundOutput = canvas.nodes.find(node => node.id === 'bound-output');
    if (!container || !boundOutput) {
      throw new Error('missing blueprint output fixture nodes');
    }

    canvas.nodes = canvas.nodes.filter(node => node.id !== 'output-placeholder');
    canvas.edges = canvas.edges.filter(edge => edge.source !== 'output-placeholder' && edge.target !== 'output-placeholder');
    container.meta = {
      ...(container.meta ?? {}),
      blueprint_file_path: blueprintFilePath,
      blueprint_output_slots: 0,
      blueprint_output_slot_defs: [],
    };
    boundOutput.position = { x: 540, y: 250 };
    boundOutput.meta = {
      ...(boundOutput.meta ?? {}),
      blueprint_bound_slot_id: 'output_fn_def_summary',
      blueprint_bound_slot_title: '输出结果 · 摘要节点',
      blueprint_bound_slot_kind: 'output',
    };
    canvas.nodes.push({
      id: 'bound-output-2',
      node_type: 'ai_output',
      title: '摘要结果（手动历史）',
      position: { x: 1280, y: 520 },
      size: { width: 240, height: 160 },
      file_path: 'outputs/summary_manual_mixed_2.md',
      meta: {
        ai_provider: 'copilot',
        ai_model: 'gpt-4.1',
        blueprint_def_id: 'bp-def-stable-output',
        blueprint_color: '#2f7d68',
        blueprint_bound_instance_id: 'inst-stable-output',
        blueprint_bound_slot_id: 'output_fn_def_summary',
        blueprint_bound_slot_title: '输出结果 · 摘要节点',
        blueprint_bound_slot_kind: 'output',
        blueprint_output_position_manual: true,
      },
    });

    const definition: BlueprintDefinition = {
      version: BLUEPRINT_DEF_VERSION,
      id: 'bp-def-stable-output',
      title: '稳定输出蓝图',
      color: '#2f7d68',
      input_slots: [],
      intermediate_slots: [],
      output_slots: [
        {
          id: 'output_slot_summary',
          kind: 'output',
          title: '输出结果 · 摘要节点',
          required: false,
          allow_multiple: false,
          accepts: ['ai_output'],
          source_function_node_id: 'fn_def_summary',
          placeholder_style: 'output_placeholder',
          replacement_mode: 'attach_by_edge',
          binding_hint: '蓝图运行完成后，最终输出会优先回填到该占位位置。',
          rect: { x: 500, y: 150, width: 240, height: 136 },
        },
      ],
      data_nodes: [],
      function_nodes: [
        {
          id: 'fn_def_summary',
          title: '摘要节点',
          tool_id: 'summarize',
          rect: { x: 130, y: 120, width: 280, height: 220 },
        },
      ],
      edges: [
        {
          id: 'edge-def-summary-output',
          edge_type: 'data_flow',
          source: { kind: 'function_node', id: 'fn_def_summary' },
          target: { kind: 'output_slot', id: 'output_slot_summary' },
        },
      ],
      metadata: {
        created_at: '2026-04-21T00:00:00.000Z',
        source_canvas_title: '蓝图输出稳定性回归',
      },
    };

    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    useCanvasStore.getState().migrateBlueprintDefinitions([{ filePath: blueprintFilePath, definition }]);

    const reboundCanvas = clone(useCanvasStore.getState().canvasFile);
    const placeholder = reboundCanvas?.nodes.find(node =>
      node.meta?.blueprint_placeholder_kind === 'output' &&
      node.meta?.blueprint_placeholder_slot_id === 'output_slot_summary'
    );
    const reboundOutput1 = reboundCanvas?.nodes.find(node => node.id === 'bound-output');
    const reboundOutput2 = reboundCanvas?.nodes.find(node => node.id === 'bound-output-2');

    expect(placeholder).toBeTruthy();
    expect(reboundOutput1?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');
    expect(reboundOutput2?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');
    expect(reboundOutput2?.position).toEqual({ x: 1280, y: 520 });

    useCanvasStore.getState().finishAiRun(
      'run-history-4',
      {
        id: 'bound-output-3',
        node_type: 'ai_output',
        title: '摘要结果（第三次）',
        position: { x: 0, y: 0 },
        size: { width: 240, height: 160 },
        file_path: 'outputs/summary_0421_224500.md',
        meta: {
          ai_provider: 'copilot',
          ai_model: 'gpt-4.1',
        },
      },
      {
        id: 'edge-fn-to-output-4',
        source: 'fn-summary',
        target: 'bound-output-3',
        edge_type: 'ai_generated',
      },
    );

    const rerunCanvas = clone(useCanvasStore.getState().canvasFile);
    const rerunOutput1 = rerunCanvas?.nodes.find(node => node.id === 'bound-output');
    const rerunOutput2 = rerunCanvas?.nodes.find(node => node.id === 'bound-output-2');
    const rerunOutput3 = rerunCanvas?.nodes.find(node => node.id === 'bound-output-3');

    expect(rerunOutput1?.position).toEqual(reboundOutput1?.position);
    expect(rerunOutput2?.position).toEqual({ x: 1280, y: 520 });
    expect(rerunOutput3?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');
    expect(rerunOutput3?.position.x).toBe((placeholder?.position.x ?? 0) + (placeholder?.size.width ?? 0) + 72);
    expect(rerunOutput3?.position.y).toBe((placeholder?.position.y ?? 0) + Math.max(((placeholder?.size.height ?? 0) - (rerunOutput3?.size.height ?? 0)) / 2, 0) + (2 * 36));
    expect(rerunCanvas?.edges.filter(edge =>
      edge.source === placeholder?.id &&
      edge.edge_type === 'data_flow' &&
      edge.role === 'output_slot_summary'
    )).toHaveLength(3);
  });

  it('keeps mixed manual and auto-positioned legacy blueprint output history stable across multiple reruns after definition rebind', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));
    const blueprintFilePath = '/tmp/research-space/blueprints/stable-output.blueprint.json';
    const container = canvas.nodes.find(node => node.id === 'bp-container');
    const boundOutput = canvas.nodes.find(node => node.id === 'bound-output');
    if (!container || !boundOutput) {
      throw new Error('missing blueprint output fixture nodes');
    }

    canvas.nodes = canvas.nodes.filter(node => node.id !== 'output-placeholder');
    canvas.edges = canvas.edges.filter(edge => edge.source !== 'output-placeholder' && edge.target !== 'output-placeholder');
    container.meta = {
      ...(container.meta ?? {}),
      blueprint_file_path: blueprintFilePath,
      blueprint_output_slots: 0,
      blueprint_output_slot_defs: [],
    };
    boundOutput.meta = {
      ...(boundOutput.meta ?? {}),
      blueprint_bound_slot_id: 'output_fn_def_summary',
      blueprint_bound_slot_title: '输出结果 · 摘要节点',
      blueprint_bound_slot_kind: 'output',
    };
    canvas.nodes.push({
      id: 'bound-output-2',
      node_type: 'ai_output',
      title: '摘要结果（手动历史）',
      position: { x: 1280, y: 520 },
      size: { width: 240, height: 160 },
      file_path: 'outputs/summary_mixed_manual_2.md',
      meta: {
        ai_provider: 'copilot',
        ai_model: 'gpt-4.1',
        blueprint_def_id: 'bp-def-stable-output',
        blueprint_color: '#2f7d68',
        blueprint_bound_instance_id: 'inst-stable-output',
        blueprint_bound_slot_id: 'output_fn_def_summary',
        blueprint_bound_slot_title: '输出结果 · 摘要节点',
        blueprint_bound_slot_kind: 'output',
        blueprint_output_position_manual: true,
      },
    });

    const definition: BlueprintDefinition = {
      version: BLUEPRINT_DEF_VERSION,
      id: 'bp-def-stable-output',
      title: '稳定输出蓝图',
      color: '#2f7d68',
      input_slots: [],
      intermediate_slots: [],
      output_slots: [
        {
          id: 'output_slot_summary',
          kind: 'output',
          title: '输出结果 · 摘要节点',
          required: false,
          allow_multiple: false,
          accepts: ['ai_output'],
          source_function_node_id: 'fn_def_summary',
          placeholder_style: 'output_placeholder',
          replacement_mode: 'attach_by_edge',
          binding_hint: '蓝图运行完成后，最终输出会优先回填到该占位位置。',
          rect: { x: 500, y: 150, width: 240, height: 136 },
        },
      ],
      data_nodes: [],
      function_nodes: [
        {
          id: 'fn_def_summary',
          title: '摘要节点',
          tool_id: 'summarize',
          rect: { x: 130, y: 120, width: 280, height: 220 },
        },
      ],
      edges: [
        {
          id: 'edge-def-summary-output',
          edge_type: 'data_flow',
          source: { kind: 'function_node', id: 'fn_def_summary' },
          target: { kind: 'output_slot', id: 'output_slot_summary' },
        },
      ],
      metadata: {
        created_at: '2026-04-21T00:00:00.000Z',
        source_canvas_title: '蓝图输出稳定性回归',
      },
    };

    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    useCanvasStore.getState().migrateBlueprintDefinitions([{ filePath: blueprintFilePath, definition }]);

    const reboundCanvas = clone(useCanvasStore.getState().canvasFile);
    const placeholder = reboundCanvas?.nodes.find(node =>
      node.meta?.blueprint_placeholder_kind === 'output' &&
      node.meta?.blueprint_placeholder_slot_id === 'output_slot_summary'
    );
    const reboundOutput1 = reboundCanvas?.nodes.find(node => node.id === 'bound-output');
    const reboundOutput2 = reboundCanvas?.nodes.find(node => node.id === 'bound-output-2');

    expect(placeholder).toBeTruthy();
    expect(reboundOutput1?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');
    expect(reboundOutput2?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');
    expect(reboundOutput2?.position).toEqual({ x: 1280, y: 520 });

    useCanvasStore.getState().finishAiRun(
      'run-history-3',
      {
        id: 'bound-output-3',
        node_type: 'ai_output',
        title: '摘要结果（第三次）',
        position: { x: 0, y: 0 },
        size: { width: 240, height: 160 },
        file_path: 'outputs/summary_0421_223000.md',
        meta: {
          ai_provider: 'copilot',
          ai_model: 'gpt-4.1',
        },
      },
      {
        id: 'edge-fn-to-output-3',
        source: 'fn-summary',
        target: 'bound-output-3',
        edge_type: 'ai_generated',
      },
    );

    useCanvasStore.getState().finishAiRun(
      'run-history-4',
      {
        id: 'bound-output-4',
        node_type: 'ai_output',
        title: '摘要结果（第四次）',
        position: { x: 0, y: 0 },
        size: { width: 240, height: 160 },
        file_path: 'outputs/summary_0421_224500.md',
        meta: {
          ai_provider: 'copilot',
          ai_model: 'gpt-4.1',
        },
      },
      {
        id: 'edge-fn-to-output-4',
        source: 'fn-summary',
        target: 'bound-output-4',
        edge_type: 'ai_generated',
      },
    );

    const rerunCanvas = clone(useCanvasStore.getState().canvasFile);
    const rerunOutput1 = rerunCanvas?.nodes.find(node => node.id === 'bound-output');
    const rerunOutput2 = rerunCanvas?.nodes.find(node => node.id === 'bound-output-2');
    const rerunOutput3 = rerunCanvas?.nodes.find(node => node.id === 'bound-output-3');
    const rerunOutput4 = rerunCanvas?.nodes.find(node => node.id === 'bound-output-4');
    const expectedX = (placeholder?.position.x ?? 0) + (placeholder?.size.width ?? 0) + 72;
    const expectedBaseY = (placeholder?.position.y ?? 0) + Math.max(((placeholder?.size.height ?? 0) - 160) / 2, 0);

    expect(rerunOutput1?.position).toEqual(reboundOutput1?.position);
    expect(rerunOutput2?.position).toEqual({ x: 1280, y: 520 });
    expect(rerunOutput3?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');
    expect(rerunOutput4?.meta?.blueprint_bound_slot_id).toBe('output_slot_summary');
    expect(rerunOutput3?.position).toEqual({ x: expectedX, y: expectedBaseY + (2 * 36) });
    expect(rerunOutput4?.position).toEqual({ x: expectedX, y: expectedBaseY + (3 * 36) });
    expect(rerunCanvas?.edges.filter(edge =>
      edge.source === placeholder?.id &&
      edge.edge_type === 'data_flow' &&
      edge.role === 'output_slot_summary'
    )).toHaveLength(4);

    useCanvasStore.getState().initCanvas(clone(rerunCanvas!), '/tmp/research-space');
    const reopenedCanvas = clone(useCanvasStore.getState().canvasFile);
    const reopenedOutputs = reopenedCanvas?.nodes.filter(node =>
      node.meta?.blueprint_bound_instance_id === 'inst-stable-output' &&
      node.meta?.blueprint_bound_slot_kind === 'output'
    ) ?? [];

    expect(reopenedOutputs).toHaveLength(4);
    expect(reopenedCanvas?.nodes.find(node => node.id === 'bound-output')?.position).toEqual(reboundOutput1?.position);
    expect(reopenedCanvas?.nodes.find(node => node.id === 'bound-output-2')?.position).toEqual({ x: 1280, y: 520 });
    expect(reopenedCanvas?.nodes.find(node => node.id === 'bound-output-3')?.position).toEqual({ x: expectedX, y: expectedBaseY + (2 * 36) });
    expect(reopenedCanvas?.nodes.find(node => node.id === 'bound-output-4')?.position).toEqual({ x: expectedX, y: expectedBaseY + (3 * 36) });
  });

  it('normalizes persisted blueprint run history to newest-first across reopen', async () => {
    const canvas = clone(loadCanvasFixture('blueprint-output-stable.rsws'));
    const container = canvas.nodes.find(node => node.id === 'bp-container');
    if (!container) {
      throw new Error('missing blueprint container fixture');
    }

    container.meta = {
      ...(container.meta ?? {}),
      blueprint_last_run_status: 'failed',
      blueprint_last_issue_node_id: 'fn-summary',
      blueprint_last_issue_node_title: '摘要节点',
      blueprint_run_history: [
        {
          id: 'hist-full-failed',
          finishedAt: '2026-04-22T00:54:00.000Z',
          status: 'failed',
          summary: '首次全量执行失败',
          totalNodes: 1,
          completedNodes: 1,
          failedNodes: 1,
          skippedNodes: 0,
          warningCount: 0,
          issueNodeId: 'fn-summary',
          issueNodeTitle: '摘要节点',
          mode: 'full',
          reusedCachedNodeCount: 0,
        },
        {
          id: 'hist-resume-success',
          finishedAt: '2026-04-22T00:56:00.000Z',
          status: 'succeeded',
          summary: '从失败点继续执行成功',
          totalNodes: 1,
          completedNodes: 1,
          failedNodes: 0,
          skippedNodes: 0,
          warningCount: 0,
          mode: 'resume',
          reusedCachedNodeCount: 1,
        },
        {
          id: 'hist-resume-refail',
          finishedAt: '2026-04-22T00:58:00.000Z',
          status: 'failed',
          summary: '继续执行时摘要节点再次失败',
          totalNodes: 1,
          completedNodes: 1,
          failedNodes: 1,
          skippedNodes: 0,
          warningCount: 0,
          issueNodeId: 'fn-summary',
          issueNodeTitle: '摘要节点',
          mode: 'resume',
          reusedCachedNodeCount: 1,
        },
      ],
    };

    const { useCanvasStore } = await loadFreshCanvasStore();

    useCanvasStore.getState().initCanvas(canvas, '/tmp/research-space');
    const firstCanvas = clone(useCanvasStore.getState().canvasFile);

    expect(firstCanvas?.nodes.find(node => node.id === 'bp-container')?.meta?.blueprint_run_history?.map(entry => entry.id)).toEqual([
      'hist-resume-refail',
      'hist-resume-success',
      'hist-full-failed',
    ]);

    useCanvasStore.getState().initCanvas(clone(firstCanvas!), '/tmp/research-space');
    const secondCanvas = clone(useCanvasStore.getState().canvasFile);

    expect(secondCanvas?.nodes.find(node => node.id === 'bp-container')?.meta?.blueprint_run_history?.map(entry => entry.id)).toEqual([
      'hist-resume-refail',
      'hist-resume-success',
      'hist-full-failed',
    ]);
  });
});
