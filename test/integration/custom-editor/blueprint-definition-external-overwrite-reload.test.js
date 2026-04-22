const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const vscode = require('vscode');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 6000, stepMs = 150) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await predicate();
      if (result) { return result; }
    } catch (error) {
      lastError = error;
    }
    await wait(stepMs);
  }
  if (lastError) { throw lastError; }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition.`);
}

function getCanvasTab(uri) {
  return vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .find(tab => (
      tab.input instanceof vscode.TabInputCustom &&
      tab.input.viewType === 'researchSpace.canvas' &&
      tab.input.uri.fsPath === uri.fsPath
    ));
}

async function openCanvas(uri) {
  await vscode.commands.executeCommand('vscode.openWith', uri, 'researchSpace.canvas');
  await wait(1500);
  const tab = getCanvasTab(uri);
  assert.ok(tab, `Expected ${path.basename(uri.fsPath)} to open in the Research Space custom editor.`);
}

async function buildTempCanvasUri() {
  const sourcePath = path.resolve(__dirname, '..', '..', 'fixtures', 'canvases', 'blueprint-output-stable.rsws');
  const tempDir = path.resolve(__dirname, '..', '..', 'fixtures', 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  const targetPath = path.join(tempDir, `blueprint-definition-external-overwrite-${Date.now()}.rsws`);
  await fs.copyFile(sourcePath, targetPath);
  return vscode.Uri.file(targetPath);
}

async function writeBlueprintDefinition(filePath) {
  const definition = {
    version: '2.1.0-alpha.2',
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
      created_at: '2026-04-21T20:24:00.000Z',
      source_canvas_title: '蓝图输出稳定性回归',
    },
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(definition, null, 2), 'utf8');
}

async function readCanvas(uri) {
  return JSON.parse(await fs.readFile(uri.fsPath, 'utf8'));
}

function getBoundOutputs(canvas) {
  return canvas.nodes
    .filter(node =>
      node.meta?.blueprint_bound_instance_id === 'inst-stable-output' &&
      node.meta?.blueprint_bound_slot_kind === 'output'
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function findOutputPlaceholder(canvas, slotId) {
  return canvas.nodes.find(node =>
    node.meta?.blueprint_instance_id === 'inst-stable-output' &&
    node.meta?.blueprint_placeholder_kind === 'output' &&
    node.meta?.blueprint_placeholder_slot_id === slotId
  );
}

function getSlotBindingTargets(canvas, slotId, placeholderId) {
  return canvas.edges
    .filter(edge =>
      edge.source === placeholderId &&
      edge.edge_type === 'data_flow' &&
      edge.role === slotId
    )
    .map(edge => edge.target)
    .sort();
}

function applyLegacyMixedHistoryState(canvas, blueprintFilePath, options = {}) {
  const legacySlotId = 'output_fn_def_summary';
  const includeThirdOutput = options.includeThirdOutput === true;
  const container = canvas.nodes.find(node => node.id === 'bp-container');
  const output1 = canvas.nodes.find(node => node.id === 'bound-output');
  assert.ok(container, 'Expected external-overwrite fixture canvas to contain a blueprint container.');
  assert.ok(output1, 'Expected external-overwrite fixture canvas to contain a blueprint bound output.');

  canvas.nodes = canvas.nodes.filter(node => node.id !== 'output-placeholder');
  canvas.edges = canvas.edges.filter(edge => edge.source !== 'output-placeholder' && edge.target !== 'output-placeholder');
  container.meta = {
    ...(container.meta ?? {}),
    blueprint_file_path: blueprintFilePath,
    blueprint_output_slots: 0,
    blueprint_output_slot_defs: [],
  };

  output1.position = { x: 540, y: 250 };
  output1.meta = {
    ...(output1.meta ?? {}),
    blueprint_bound_slot_id: legacySlotId,
    blueprint_bound_slot_title: '输出结果 · 摘要节点',
    blueprint_bound_slot_kind: 'output',
  };

  let output2 = canvas.nodes.find(node => node.id === 'bound-output-2');
  if (!output2) {
    output2 = {
      id: 'bound-output-2',
      node_type: 'ai_output',
      title: '摘要结果（手动历史）',
      position: { x: 1280, y: 520 },
      size: { width: 240, height: 160 },
      file_path: 'outputs/summary_external_manual_2.md',
      meta: {},
    };
    canvas.nodes.push(output2);
  }
  output2.position = { x: 1280, y: 520 };
  output2.size = { width: 240, height: 160 };
  output2.file_path = 'outputs/summary_external_manual_2.md';
  output2.meta = {
    ...(output2.meta ?? {}),
    ai_provider: 'copilot',
    ai_model: 'gpt-4.1',
    blueprint_def_id: 'bp-def-stable-output',
    blueprint_color: '#2f7d68',
    blueprint_bound_instance_id: 'inst-stable-output',
    blueprint_bound_slot_id: legacySlotId,
    blueprint_bound_slot_title: '输出结果 · 摘要节点',
    blueprint_bound_slot_kind: 'output',
    blueprint_output_position_manual: true,
  };

  canvas.nodes = canvas.nodes.filter(node => node.id !== 'bound-output-3');
  if (includeThirdOutput) {
    canvas.nodes.push({
      id: 'bound-output-3',
      node_type: 'ai_output',
      title: '摘要结果（外部追加历史）',
      position: { x: 660, y: 370 },
      size: { width: 240, height: 160 },
      file_path: 'outputs/summary_external_auto_3.md',
      meta: {
        ai_provider: 'copilot',
        ai_model: 'gpt-4.1',
        blueprint_def_id: 'bp-def-stable-output',
        blueprint_color: '#2f7d68',
        blueprint_bound_instance_id: 'inst-stable-output',
        blueprint_bound_slot_id: legacySlotId,
        blueprint_bound_slot_title: '输出结果 · 摘要节点',
        blueprint_bound_slot_kind: 'output',
      },
    });
  }

  canvas.metadata.updated_at = includeThirdOutput
    ? '2026-04-21T20:27:00.000Z'
    : '2026-04-21T20:25:00.000Z';
  return canvas;
}

async function run() {
  const canvasUri = await buildTempCanvasUri();
  const blueprintFilePath = path.join(path.dirname(canvasUri.fsPath), 'blueprints', `${path.basename(canvasUri.fsPath, '.rsws')}.blueprint.json`);

  try {
    await writeBlueprintDefinition(blueprintFilePath);

    const rawCanvas = applyLegacyMixedHistoryState(await readCanvas(canvasUri), blueprintFilePath);
    await vscode.workspace.fs.writeFile(
      canvasUri,
      Buffer.from(JSON.stringify(rawCanvas, null, 2), 'utf8')
    );

    await openCanvas(canvasUri);

    const rebound = await waitFor(async () => {
      const current = await readCanvas(canvasUri);
      const placeholder = findOutputPlaceholder(current, 'output_slot_summary');
      const outputs = getBoundOutputs(current);
      if (!placeholder || outputs.length !== 2) { return null; }
      const autoOutput = outputs.find(node => node.id === 'bound-output');
      const manualOutput = outputs.find(node => node.id === 'bound-output-2');
      if (!autoOutput || !manualOutput) { return null; }
      if (autoOutput.meta?.blueprint_bound_slot_id !== 'output_slot_summary') { return null; }
      if (manualOutput.meta?.blueprint_bound_slot_id !== 'output_slot_summary') { return null; }
      if (manualOutput.position.x !== 1280 || manualOutput.position.y !== 520) { return null; }
      const expectedAutoX = placeholder.position.x + placeholder.size.width + 72;
      if (autoOutput.position.x !== expectedAutoX) { return null; }
      if (getSlotBindingTargets(current, 'output_slot_summary', placeholder.id).length !== 2) { return null; }
      return current;
    }, 15000, 150);

    const revertedCanvas = applyLegacyMixedHistoryState(rebound, blueprintFilePath, { includeThirdOutput: true });
    await vscode.workspace.fs.writeFile(
      canvasUri,
      Buffer.from(JSON.stringify(revertedCanvas, null, 2), 'utf8')
    );

    assert.ok(getCanvasTab(canvasUri), 'Expected custom editor to stay alive after externally overwriting a definitions-rebound blueprint back to legacy mixed-history structure.');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const reopened = await waitFor(async () => {
      const current = await readCanvas(canvasUri);
      const placeholder = findOutputPlaceholder(current, 'output_slot_summary');
      const outputs = getBoundOutputs(current);
      if (!placeholder || outputs.length !== 3) { return null; }
      const output1 = outputs.find(node => node.id === 'bound-output');
      const output2 = outputs.find(node => node.id === 'bound-output-2');
      const output3 = outputs.find(node => node.id === 'bound-output-3');
      if (!output1 || !output2 || !output3) { return null; }
      if (outputs.some(node => node.meta?.blueprint_bound_slot_id !== 'output_slot_summary')) { return null; }
      if (output2.position.x !== 1280 || output2.position.y !== 520) { return null; }
      const expectedX = placeholder.position.x + placeholder.size.width + 72;
      const expectedBaseY = placeholder.position.y + Math.max((placeholder.size.height - output1.size.height) / 2, 0);
      if (output1.position.x !== expectedX || output3.position.x !== expectedX) { return null; }
      if (output1.position.y !== expectedBaseY) { return null; }
      if (output3.position.y !== expectedBaseY + (2 * 36)) { return null; }
      const targets = getSlotBindingTargets(current, 'output_slot_summary', placeholder.id);
      if (targets.length !== 3) { return null; }
      return current;
    }, 15000, 150);

    const reopenedPlaceholder = findOutputPlaceholder(reopened, 'output_slot_summary');
    const reopenedOutputs = getBoundOutputs(reopened);
    assert.ok(reopenedPlaceholder);
    assert.equal(reopenedOutputs.length, 3, 'Expected external-overwrite mixed blueprint history to survive reopen.');
    assert.deepEqual(getSlotBindingTargets(reopened, 'output_slot_summary', reopenedPlaceholder.id), ['bound-output', 'bound-output-2', 'bound-output-3']);
    assert.deepEqual(reopened.nodes.find(node => node.id === 'bound-output-2')?.position, { x: 1280, y: 520 });
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try {
      await fs.unlink(canvasUri.fsPath);
    } catch {
      // ignore temp cleanup failures
    }
    try {
      await fs.unlink(blueprintFilePath);
    } catch {
      // ignore temp cleanup failures
    }
  }
}

module.exports = { run };
