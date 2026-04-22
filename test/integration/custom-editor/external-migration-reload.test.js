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
  const sourcePath = path.resolve(__dirname, '..', '..', 'fixtures', 'canvases', 'selection-basic.rsws');
  const tempDir = path.resolve(__dirname, '..', '..', 'fixtures', 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  const targetPath = path.join(tempDir, `external-migration-reload-${Date.now()}.rsws`);
  await fs.copyFile(sourcePath, targetPath);
  return vscode.Uri.file(targetPath);
}

async function readCanvas(uri) {
  return JSON.parse(await fs.readFile(uri.fsPath, 'utf8'));
}

function buildLegacyCanvas() {
  return {
    version: '1.0',
    nodes: [
      {
        id: 'input-note',
        node_type: 'note',
        title: '输入材料',
        position: { x: 80, y: 120 },
        size: { width: 240, height: 160 },
        file_path: 'notes/input.md',
      },
      {
        id: 'summarize-fn',
        node_type: 'function',
        title: '摘要',
        position: { x: 460, y: 120 },
        size: { width: 280, height: 220 },
        meta: {
          ai_tool: 'summarize',
          param_values: {},
          fn_status: 'idle',
        },
      },
      {
        id: 'stale-hub',
        node_type: 'group_hub',
        title: '失效节点组',
        position: { x: 50, y: 90 },
        size: { width: 360, height: 240 },
        meta: {
          hub_group_id: 'deleted-group',
          input_order: ['input-note'],
        },
      },
    ],
    edges: [
      {
        id: 'edge-member-hub',
        source: 'input-note',
        target: 'stale-hub',
        edge_type: 'hub_member',
      },
      {
        id: 'edge-hub-function',
        source: 'stale-hub',
        target: 'summarize-fn',
        edge_type: 'data_flow',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title: '外部改回旧结构',
      created_at: '2026-04-21T00:00:00.000Z',
      updated_at: '2026-04-21T00:00:00.000Z',
    },
    summaryGroups: [
      {
        id: 'legacy-board',
        name: '旧分组',
        color: '#ff8800',
        nodeIds: ['input-note'],
        bounds: { x: 40, y: 80, width: 760, height: 340 },
      },
    ],
    nodeGroups: [],
  };
}

async function run() {
  const canvasUri = await buildTempCanvasUri();

  try {
    await openCanvas(canvasUri);

    await vscode.workspace.fs.writeFile(
      canvasUri,
      Buffer.from(JSON.stringify(buildLegacyCanvas(), null, 2), 'utf8')
    );

    assert.ok(getCanvasTab(canvasUri), 'Expected custom editor to stay alive after an external legacy-canvas overwrite.');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const migrated = await waitFor(async () => {
      const current = await readCanvas(canvasUri);
      const hasLegacySummaryGroups = current.summaryGroups !== undefined;
      const hasStaleHub = current.nodes.some(node => node.id === 'stale-hub');
      const hasStaleEdges = current.edges.some(edge => edge.source === 'stale-hub' || edge.target === 'stale-hub');
      if (hasLegacySummaryGroups || hasStaleHub || hasStaleEdges) { return null; }
      if (!Array.isArray(current.boards) || current.boards.length !== 1) { return null; }
      return current;
    });

    assert.deepEqual(migrated.boards, [
      {
        id: 'legacy-board',
        name: '旧分组',
        color: 'rgba(255,136,0,0.12)',
        borderColor: '#ff8800',
        bounds: { x: 40, y: 80, width: 760, height: 340 },
      },
    ]);
    assert.equal(migrated.nodeGroups.length, 0);
    assert.deepEqual(
      migrated.nodes.map(node => node.id).sort(),
      ['input-note', 'summarize-fn']
    );
    assert.deepEqual(migrated.edges, []);

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const reopened = await readCanvas(canvasUri);
    assert.deepEqual(reopened, migrated, 'Expected migrated external legacy canvas to remain stable after reopen.');
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
