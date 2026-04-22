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
  const targetPath = path.join(tempDir, `blueprint-legacy-output-history-${Date.now()}.rsws`);
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

  try {
    await openCanvas(canvasUri);

    const rawCanvas = await readCanvas(canvasUri);
    const container = rawCanvas.nodes.find(node => node.id === 'bp-container');
    const boundOutput = rawCanvas.nodes.find(node => node.id === 'bound-output');
    assert.ok(container, 'Expected legacy-migration fixture canvas to contain a blueprint container.');
    assert.ok(boundOutput, 'Expected legacy-migration fixture canvas to contain a blueprint bound output.');

    const legacySlotId = 'output_fn_def_summary';
    rawCanvas.nodes = rawCanvas.nodes.filter(node => node.id !== 'output-placeholder');
    rawCanvas.edges = rawCanvas.edges.filter(edge => edge.source !== 'output-placeholder' && edge.target !== 'output-placeholder');
    container.meta = {
      ...(container.meta ?? {}),
      blueprint_output_slots: 0,
      blueprint_output_slot_defs: [],
    };

    boundOutput.position = { x: 540, y: 250 };
    boundOutput.meta = {
      ...(boundOutput.meta ?? {}),
      blueprint_bound_slot_id: legacySlotId,
      blueprint_bound_slot_title: '输出结果 · 摘要节点',
      blueprint_bound_slot_kind: 'output',
    };

    rawCanvas.nodes.push({
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
        blueprint_bound_slot_id: legacySlotId,
        blueprint_bound_slot_title: '输出结果 · 摘要节点',
        blueprint_bound_slot_kind: 'output',
      },
    });
    rawCanvas.metadata.updated_at = '2026-04-21T17:35:00.000Z';

    await vscode.workspace.fs.writeFile(
      canvasUri,
      Buffer.from(JSON.stringify(rawCanvas, null, 2), 'utf8')
    );

    assert.ok(getCanvasTab(canvasUri), 'Expected custom editor to stay alive after externally reverting blueprint outputs to a legacy structure.');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const migrated = await waitFor(async () => {
      const current = await readCanvas(canvasUri);
      const currentContainer = current.nodes.find(node => node.id === 'bp-container');
      const placeholder = findOutputPlaceholder(current, legacySlotId);
      const outputs = getBoundOutputs(current);
      if (!currentContainer || !placeholder || outputs.length !== 2) { return null; }
      if (!Array.isArray(currentContainer.meta?.blueprint_output_slot_defs) || currentContainer.meta.blueprint_output_slot_defs.length !== 1) {
        return null;
      }
      if (currentContainer.meta.blueprint_output_slot_defs[0]?.id !== legacySlotId) {
        return null;
      }
      const targets = getSlotBindingTargets(current, legacySlotId, placeholder.id);
      if (targets.length !== 2) { return null; }
      const output1 = outputs.find(node => node.id === 'bound-output');
      const output2 = outputs.find(node => node.id === 'bound-output-2');
      if (!output1 || !output2) { return null; }
      const expectedX = placeholder.position.x + placeholder.size.width + 72;
      if (output1.position.x !== expectedX || output2.position.x !== expectedX) { return null; }
      if (output2.position.y !== output1.position.y + 36) { return null; }
      return current;
    });

    const migratedContainer = migrated.nodes.find(node => node.id === 'bp-container');
    assert.equal(migratedContainer.meta?.blueprint_output_slot_defs?.[0]?.id, legacySlotId);
    const migratedPlaceholder = findOutputPlaceholder(migrated, legacySlotId);
    assert.ok(migratedPlaceholder);
    assert.deepEqual(getSlotBindingTargets(migrated, legacySlotId, migratedPlaceholder.id), ['bound-output', 'bound-output-2']);

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const reopened = await readCanvas(canvasUri);
    const reopenedOutputs = getBoundOutputs(reopened);
    assert.equal(reopenedOutputs.length, 2, 'Expected both legacy blueprint outputs to survive migration + reopen.');
    const reopenedPlaceholder = findOutputPlaceholder(reopened, legacySlotId);
    assert.ok(reopenedPlaceholder);
    assert.deepEqual(getSlotBindingTargets(reopened, legacySlotId, reopenedPlaceholder.id), ['bound-output', 'bound-output-2']);

    const reopenedOutput1 = reopenedOutputs.find(node => node.id === 'bound-output');
    const reopenedOutput2 = reopenedOutputs.find(node => node.id === 'bound-output-2');
    assert.ok(reopenedOutput1);
    assert.ok(reopenedOutput2);
    assert.equal(reopenedOutput1.position.x, reopenedPlaceholder.position.x + reopenedPlaceholder.size.width + 72);
    assert.equal(reopenedOutput2.position.x, reopenedPlaceholder.position.x + reopenedPlaceholder.size.width + 72);
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
