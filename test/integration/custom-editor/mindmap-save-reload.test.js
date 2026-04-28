const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const vscode = require('vscode');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 9000, stepMs = 150) {
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
  assert.ok(getCanvasTab(uri), `Expected ${path.basename(uri.fsPath)} to open in the Research Space custom editor.`);
  await waitFor(async () => vscode.commands.executeCommand('researchSpace.test.isCanvasReady', uri), 12000, 150);
}

async function buildTempMindMapCanvas() {
  const tempRoot = path.resolve(__dirname, '..', '..', 'fixtures', 'tmp', `mindmap-save-reload-${Date.now()}`);
  const mindMapDir = path.join(tempRoot, '.rs-mindmaps');
  await fs.mkdir(mindMapDir, { recursive: true });
  const mindMapPath = path.join(mindMapDir, 'phase4.rs-mindmap.json');
  const canvasPath = path.join(tempRoot, 'mindmap-phase4.rsws');
  const now = new Date().toISOString();
  const mindmap = {
    version: '1.0',
    id: 'mindmap-file',
    title: 'Phase 4 导图',
    root: {
      id: 'root',
      text: 'Phase 4 导图',
      children: [
        { id: 'branch-before', text: '保存前分支', children: [] },
      ],
    },
    metadata: { created_at: now, updated_at: now },
  };
  const canvas = {
    version: '1.0',
    nodes: [
      {
        id: 'mindmap-node',
        node_type: 'mindmap',
        title: 'Phase 4 导图',
        position: { x: 120, y: 120 },
        size: { width: 340, height: 240 },
        file_path: '.rs-mindmaps/phase4.rs-mindmap.json',
        meta: {
          content_preview: '# Phase 4 导图\n\n- 一级分支：1\n- 总条目：2\n\n- 保存前分支',
          mindmap_summary: {
            rootTitle: 'Phase 4 导图',
            firstLevelCount: 1,
            totalItems: 2,
            imageCount: 0,
            outlinePreview: '- 保存前分支',
            updatedAt: now,
          },
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: { title: 'mindmap-phase4', created_at: now, updated_at: now },
    boards: [],
    nodeGroups: [],
  };
  await fs.writeFile(mindMapPath, JSON.stringify(mindmap, null, 2), 'utf8');
  await fs.writeFile(canvasPath, JSON.stringify(canvas, null, 2), 'utf8');
  return {
    tempRoot,
    mindMapUri: vscode.Uri.file(mindMapPath),
    canvasUri: vscode.Uri.file(canvasPath),
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function run() {
  const { tempRoot, mindMapUri, canvasUri } = await buildTempMindMapCanvas();
  try {
    await openCanvas(canvasUri);

    const nextMindMap = {
      version: '1.0',
      id: 'mindmap-file',
      title: 'Phase 4 自动测试',
      root: {
        id: 'root',
        text: 'Phase 4 自动测试',
        children: [
          {
            id: 'branch-one',
            text: '保存后分支',
            children: [
              { id: 'branch-child', text: '重载后仍存在', children: [] },
            ],
          },
          { id: 'branch-two', text: '第二分支', children: [] },
        ],
      },
      metadata: { created_at: '2026-04-27T00:00:00.000Z', updated_at: '2026-04-27T00:00:00.000Z' },
    };

    const saved = await vscode.commands.executeCommand(
      'researchSpace.test.saveMindMapFile',
      canvasUri,
      'mindmap-node',
      '.rs-mindmaps/phase4.rs-mindmap.json',
      nextMindMap
    );
    assert.equal(saved.title, 'Phase 4 自动测试');
    assert.equal(saved.summary.firstLevelCount, 2);
    assert.equal(saved.summary.totalItems, 4);

    const persistedMindMap = await readJson(mindMapUri.fsPath);
    assert.equal(persistedMindMap.root.text, 'Phase 4 自动测试');
    assert.equal(persistedMindMap.root.children[0].children[0].text, '重载后仍存在');

    let liveCanvas = await vscode.commands.executeCommand('researchSpace.test.getCanvasState', canvasUri);
    let liveNode = liveCanvas.nodes.find(node => node.id === 'mindmap-node');
    assert.equal(liveNode.title, 'Phase 4 自动测试');
    assert.equal(liveNode.meta.mindmap_summary.firstLevelCount, 2);
    assert.ok(liveNode.meta.content_preview.includes('保存后分支'));

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);
    await openCanvas(canvasUri);

    liveCanvas = await vscode.commands.executeCommand('researchSpace.test.getCanvasState', canvasUri);
    liveNode = liveCanvas.nodes.find(node => node.id === 'mindmap-node');
    assert.equal(liveNode.title, 'Phase 4 自动测试');
    assert.equal(liveNode.meta.mindmap_summary.totalItems, 4);

    const reloadedMindMap = await vscode.commands.executeCommand('researchSpace.test.readMindMapFile', mindMapUri);
    assert.equal(reloadedMindMap.root.children[0].children[0].text, '重载后仍存在');
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

module.exports = { run };
