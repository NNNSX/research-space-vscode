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
  const targetPath = path.join(tempDir, `blueprint-definition-mixed-history-${Date.now()}.rsws`);
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
      created_at: '2026-04-21T19:30:00.000Z',
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

async function run() {
  const canvasUri = await buildTempCanvasUri();
  const blueprintFilePath = path.join(path.dirname(canvasUri.fsPath), 'blueprints', `${path.basename(canvasUri.fsPath, '.rsws')}.blueprint.json`);

  try {
    await writeBlueprintDefinition(blueprintFilePath);

    const rawCanvas = await readCanvas(canvasUri);
    const container = rawCanvas.nodes.find(node => node.id === 'bp-container');
    const boundOutput = rawCanvas.nodes.find(node => node.id === 'bound-output');
    assert.ok(container, 'Expected mixed-history fixture canvas to contain a blueprint container.');
    assert.ok(boundOutput, 'Expected mixed-history fixture canvas to contain a blueprint bound output.');

    rawCanvas.nodes = rawCanvas.nodes.filter(node => node.id !== 'output-placeholder');
    rawCanvas.edges = rawCanvas.edges.filter(edge => edge.source !== 'output-placeholder' && edge.target !== 'output-placeholder');
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
    rawCanvas.nodes.push({
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
    rawCanvas.metadata.updated_at = '2026-04-21T19:32:00.000Z';

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
      const targets = getSlotBindingTargets(current, 'output_slot_summary', placeholder.id);
      if (targets.length !== 2) { return null; }
      return current;
    });

    const reboundPlaceholder = findOutputPlaceholder(rebound, 'output_slot_summary');
    assert.ok(reboundPlaceholder);

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const reopened = await readCanvas(canvasUri);
    const reopenedPlaceholder = findOutputPlaceholder(reopened, 'output_slot_summary');
    const reopenedOutputs = getBoundOutputs(reopened);
    const reopenedAutoOutput = reopenedOutputs.find(node => node.id === 'bound-output');
    const reopenedManualOutput = reopenedOutputs.find(node => node.id === 'bound-output-2');

    assert.ok(reopenedPlaceholder);
    assert.equal(reopenedOutputs.length, 2, 'Expected mixed manual/auto blueprint history to survive reopen.');
    assert.ok(reopenedAutoOutput);
    assert.ok(reopenedManualOutput);
    assert.equal(reopenedAutoOutput.position.x, reopenedPlaceholder.position.x + reopenedPlaceholder.size.width + 72);
    assert.deepEqual(reopenedManualOutput.position, { x: 1280, y: 520 });
    assert.deepEqual(getSlotBindingTargets(reopened, 'output_slot_summary', reopenedPlaceholder.id), ['bound-output', 'bound-output-2']);
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
