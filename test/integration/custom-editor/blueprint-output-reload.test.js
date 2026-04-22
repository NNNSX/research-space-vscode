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
  const targetPath = path.join(tempDir, `blueprint-output-reload-${Date.now()}.rsws`);
  await fs.copyFile(sourcePath, targetPath);
  return vscode.Uri.file(targetPath);
}

async function readCanvas(uri) {
  return JSON.parse(await fs.readFile(uri.fsPath, 'utf8'));
}

function findBoundOutput(canvas) {
  return canvas.nodes.find(node => node.id === 'bound-output');
}

async function run() {
  const canvasUri = await buildTempCanvasUri();

  try {
    await openCanvas(canvasUri);

    const rawCanvas = await readCanvas(canvasUri);
    const boundOutput = findBoundOutput(rawCanvas);
    assert.ok(boundOutput, 'Expected blueprint output fixture to contain the bound output node.');
    boundOutput.position = { x: 1120, y: 420 };
    if (boundOutput.meta) {
      delete boundOutput.meta.blueprint_output_position_manual;
    }
    rawCanvas.metadata.updated_at = '2026-04-21T16:20:00.000Z';

    await vscode.workspace.fs.writeFile(
      canvasUri,
      Buffer.from(JSON.stringify(rawCanvas, null, 2), 'utf8')
    );

    assert.ok(getCanvasTab(canvasUri), 'Expected custom editor to stay alive after externally moving a blueprint bound output.');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const normalized = await waitFor(async () => {
      const current = await readCanvas(canvasUri);
      const currentBoundOutput = findBoundOutput(current);
      if (!currentBoundOutput) { return null; }
      if (currentBoundOutput.position.x !== 1120 || currentBoundOutput.position.y !== 420) {
        return null;
      }
      return current;
    });

    assert.deepEqual(findBoundOutput(normalized).position, { x: 1120, y: 420 });

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const reopened = await readCanvas(canvasUri);
    assert.deepEqual(
      findBoundOutput(reopened).position,
      { x: 1120, y: 420 },
      'Expected externally moved blueprint bound output position to remain stable after reopen.',
    );
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
