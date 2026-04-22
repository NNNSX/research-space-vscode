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
  const targetPath = path.join(tempDir, `undo-redo-${Date.now()}.rsws`);
  await fs.copyFile(sourcePath, targetPath);
  return vscode.Uri.file(targetPath);
}

async function getCanvasState(canvasUri) {
  return vscode.commands.executeCommand('researchSpace.test.getCanvasState', canvasUri);
}

async function run() {
  const canvasUri = await buildTempCanvasUri();

  try {
    await openCanvas(canvasUri);

    const original = await getCanvasState(canvasUri);
    assert.ok(original, 'Expected test command to return the active canvas state.');
    const originalTitle = original.metadata.title;
    const editedTitle = `${originalTitle}（undo-redo）`;

    const changed = await vscode.commands.executeCommand(
      'researchSpace.test.applyCanvasTitleEdit',
      editedTitle,
      canvasUri
    );
    assert.equal(changed, true, 'Expected test edit command to create a provider-level canvas edit.');

    await wait(300);
    let current = await getCanvasState(canvasUri);
    assert.equal(current.metadata.title, editedTitle, 'Expected provider edit to update the in-memory canvas state.');

    const undone = await vscode.commands.executeCommand('researchSpace.test.undoCanvasEdit', canvasUri);
    assert.equal(undone, true, 'Expected test undo command to restore the previous canvas state.');
    await wait(300);
    current = await getCanvasState(canvasUri);
    assert.equal(current.metadata.title, originalTitle, 'Expected undo to restore the previous canvas state.');
    assert.ok(getCanvasTab(canvasUri), 'Expected custom editor to stay alive after undo.');

    const redone = await vscode.commands.executeCommand('researchSpace.test.redoCanvasEdit', canvasUri);
    assert.equal(redone, true, 'Expected test redo command to restore the edited canvas state.');
    await wait(300);
    current = await getCanvasState(canvasUri);
    assert.equal(current.metadata.title, editedTitle, 'Expected redo to restore the edited canvas state.');
    assert.ok(getCanvasTab(canvasUri), 'Expected custom editor to stay alive after redo.');

    await vscode.commands.executeCommand('workbench.action.files.save');
    await wait(500);
    const persisted = JSON.parse(await fs.readFile(canvasUri.fsPath, 'utf8'));
    assert.equal(persisted.metadata.title, editedTitle, 'Expected save after redo to persist the restored canvas state.');
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
