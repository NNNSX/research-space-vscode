const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const vscode = require('vscode');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const sourcePath = path.resolve(__dirname, '..', '..', 'fixtures', 'canvases', 'selection-basic.rsws');
  const tempDir = path.resolve(__dirname, '..', '..', 'fixtures', 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  const targetPath = path.join(tempDir, `save-reload-${Date.now()}.rsws`);
  await fs.copyFile(sourcePath, targetPath);
  return vscode.Uri.file(targetPath);
}

async function run() {
  const canvasUri = await buildTempCanvasUri();

  try {
    await openCanvas(canvasUri);

    const raw = await fs.readFile(canvasUri.fsPath, 'utf8');
    const canvas = JSON.parse(raw);
    canvas.nodes = canvas.nodes.filter(node => node.id !== 'input-note');
    canvas.edges = canvas.edges.filter(edge => edge.source !== 'input-note' && edge.target !== 'input-note');
    canvas.metadata.updated_at = '2026-04-21T09:10:00.000Z';

    await vscode.workspace.fs.writeFile(
      canvasUri,
      Buffer.from(JSON.stringify(canvas, null, 2), 'utf8')
    );

    await wait(1500);
    assert.ok(getCanvasTab(canvasUri), 'Expected custom editor to stay alive after the canvas file was externally updated.');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const persisted = JSON.parse(await fs.readFile(canvasUri.fsPath, 'utf8'));
    assert.ok(!persisted.nodes.some(node => node.id === 'input-note'), 'Expected externally persisted node removal to survive reopen.');
    assert.ok(!persisted.edges.some(edge => edge.source === 'input-note' || edge.target === 'input-note'), 'Expected edges attached to the removed node to stay removed after reopen.');
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
