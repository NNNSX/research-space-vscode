const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const canvasUri = vscode.Uri.file(
    path.resolve(__dirname, '..', '..', 'fixtures', 'canvases', 'selection-basic.rsws')
  );

  await vscode.commands.executeCommand('vscode.openWith', canvasUri, 'researchSpace.canvas');
  await wait(1500);

  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
  const hasCanvasTab = tabs.some(tab => (
    tab.input instanceof vscode.TabInputCustom &&
    tab.input.viewType === 'researchSpace.canvas' &&
    tab.input.uri.fsPath === canvasUri.fsPath
  ));

  assert.ok(hasCanvasTab, 'Expected selection-basic.rsws to open in the Research Space custom editor.');

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

module.exports = { run };
