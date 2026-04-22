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
  const targetPath = path.join(tempDir, `blueprint-output-history-reload-${Date.now()}.rsws`);
  await fs.copyFile(sourcePath, targetPath);
  return vscode.Uri.file(targetPath);
}

async function readCanvas(uri) {
  return JSON.parse(await fs.readFile(uri.fsPath, 'utf8'));
}

function getBoundOutputs(canvas) {
  return canvas.nodes
    .filter(node =>
      node.meta?.blueprint_bound_instance_id === 'inst-stable-output' &&
      node.meta?.blueprint_bound_slot_kind === 'output' &&
      node.meta?.blueprint_bound_slot_id === 'output_slot_summary'
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function getSlotBindingTargets(canvas) {
  return canvas.edges
    .filter(edge =>
      edge.source === 'output-placeholder' &&
      edge.edge_type === 'data_flow' &&
      edge.role === 'output_slot_summary'
    )
    .map(edge => edge.target)
    .sort();
}

async function run() {
  const canvasUri = await buildTempCanvasUri();

  try {
    await openCanvas(canvasUri);

    const rawCanvas = await readCanvas(canvasUri);
    rawCanvas.nodes.push({
      id: 'bound-output-2',
      node_type: 'ai_output',
      title: '摘要结果（第二次）',
      position: { x: 0, y: 0 },
      size: { width: 240, height: 160 },
      file_path: 'outputs/summary_20260421_2.md',
      meta: {
        ai_provider: 'copilot',
        ai_model: 'gpt-4.1',
        blueprint_def_id: 'bp-def-stable-output',
        blueprint_color: '#2f7d68',
        blueprint_bound_instance_id: 'inst-stable-output',
        blueprint_bound_slot_id: 'output_slot_summary',
        blueprint_bound_slot_title: '输出结果 · 摘要节点',
        blueprint_bound_slot_kind: 'output',
      },
    });
    rawCanvas.edges.push({
      id: 'edge-placeholder-to-output-2',
      source: 'output-placeholder',
      target: 'bound-output-2',
      edge_type: 'data_flow',
      role: 'output_slot_summary',
    });
    rawCanvas.metadata.updated_at = '2026-04-21T17:20:00.000Z';

    await vscode.workspace.fs.writeFile(
      canvasUri,
      Buffer.from(JSON.stringify(rawCanvas, null, 2), 'utf8')
    );

    assert.ok(getCanvasTab(canvasUri), 'Expected custom editor to stay alive after externally appending blueprint output history.');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const normalized = await waitFor(async () => {
      const current = await readCanvas(canvasUri);
      const outputs = getBoundOutputs(current);
      if (outputs.length !== 2) { return null; }
      const targets = getSlotBindingTargets(current);
      if (targets.length !== 2) { return null; }
      const output1 = outputs.find(node => node.id === 'bound-output');
      const output2 = outputs.find(node => node.id === 'bound-output-2');
      if (!output1 || !output2) { return null; }
      if (output1.position.x !== output2.position.x) { return null; }
      if (output2.position.y !== output1.position.y + 36) { return null; }
      return current;
    });

    const normalizedOutputs = getBoundOutputs(normalized);
    assert.equal(normalizedOutputs.length, 2);
    assert.deepEqual(getSlotBindingTargets(normalized), ['bound-output', 'bound-output-2']);

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const reopened = await readCanvas(canvasUri);
    const reopenedOutputs = getBoundOutputs(reopened);
    assert.equal(reopenedOutputs.length, 2, 'Expected both blueprint final outputs to survive reopen.');
    assert.deepEqual(getSlotBindingTargets(reopened), ['bound-output', 'bound-output-2']);

    const reopenedOutput1 = reopenedOutputs.find(node => node.id === 'bound-output');
    const reopenedOutput2 = reopenedOutputs.find(node => node.id === 'bound-output-2');
    assert.ok(reopenedOutput1);
    assert.ok(reopenedOutput2);
    assert.equal(reopenedOutput1.position.x, reopenedOutput2.position.x);
    assert.equal(reopenedOutput2.position.y, reopenedOutput1.position.y + 36);
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try {
      await fs.unlink(canvasUri.fsPath);
    } catch {
      // ignore temp cleanup failures
    }
  }
}

module.exports = { run };
