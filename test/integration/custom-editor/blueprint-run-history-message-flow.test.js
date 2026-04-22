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
  const tab = getCanvasTab(uri);
  assert.ok(tab, `Expected ${path.basename(uri.fsPath)} to open in the Research Space custom editor.`);
  await waitFor(async () => {
    return vscode.commands.executeCommand('researchSpace.test.isCanvasReady', uri);
  }, 12000, 150);
}

async function buildTempCanvasUri() {
  const sourcePath = path.resolve(__dirname, '..', '..', 'fixtures', 'canvases', 'blueprint-output-stable.rsws');
  const tempDir = path.resolve(__dirname, '..', '..', 'fixtures', 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  const targetPath = path.join(tempDir, `blueprint-run-history-message-flow-${Date.now()}.rsws`);
  await fs.copyFile(sourcePath, targetPath);
  return vscode.Uri.file(targetPath);
}

async function readCanvas(uri) {
  return JSON.parse(await fs.readFile(uri.fsPath, 'utf8'));
}

async function readLiveCanvas(uri) {
  return vscode.commands.executeCommand('researchSpace.test.getCanvasState', uri);
}

function getBlueprintContainer(canvas) {
  if (!canvas || !Array.isArray(canvas.nodes)) { return null; }
  return canvas.nodes.find(node => node.id === 'bp-container');
}

async function postCanvasMessage(canvasUri, message) {
  const posted = await vscode.commands.executeCommand('researchSpace.test.postCanvasMessage', message, canvasUri);
  assert.ok(posted, `Expected test message ${message.type} to be delivered to the canvas webview.`);
}

function mapRunHistory(container) {
  return (container.meta?.blueprint_run_history ?? []).map(entry => ({
    status: entry.status,
    mode: entry.mode ?? 'full',
    issueNodeId: entry.issueNodeId ?? null,
    reusedCachedNodeCount: entry.reusedCachedNodeCount ?? 0,
  }));
}

async function simulateFailedRun(canvasUri, pipelineId, runMode) {
  await postCanvasMessage(canvasUri, {
    type: 'pipelineStarted',
    pipelineId,
    triggerNodeId: 'bp-container',
    nodeIds: ['fn-summary'],
    totalNodes: 1,
    initialNodeStatuses: { 'fn-summary': 'waiting' },
    initialCompletedNodes: 0,
    runMode,
    reusedCachedNodeCount: 0,
  });
  await wait(80);
  await postCanvasMessage(canvasUri, { type: 'pipelineNodeStart', pipelineId, nodeId: 'fn-summary' });
  await wait(80);
  await postCanvasMessage(canvasUri, {
    type: 'pipelineNodeError',
    pipelineId,
    nodeId: 'fn-summary',
    error: '摘要节点执行失败',
    issueKind: 'run_failed',
  });
  await wait(80);
  await postCanvasMessage(canvasUri, {
    type: 'pipelineComplete',
    pipelineId,
    totalNodes: 1,
    completedNodes: 1,
    status: 'failed',
  });
}

async function simulateSucceededResumeRun(canvasUri, pipelineId) {
  await postCanvasMessage(canvasUri, {
    type: 'pipelineStarted',
    pipelineId,
    triggerNodeId: 'bp-container',
    nodeIds: ['fn-summary'],
    totalNodes: 1,
    initialNodeStatuses: { 'fn-summary': 'waiting' },
    initialCompletedNodes: 0,
    runMode: 'resume',
    reusedCachedNodeCount: 0,
  });
  await wait(80);
  await postCanvasMessage(canvasUri, { type: 'pipelineNodeStart', pipelineId, nodeId: 'fn-summary' });
  await wait(80);
  await postCanvasMessage(canvasUri, {
    type: 'pipelineNodeComplete',
    pipelineId,
    nodeId: 'fn-summary',
    outputNodeId: 'bound-output',
  });
  await wait(80);
  await postCanvasMessage(canvasUri, {
    type: 'pipelineComplete',
    pipelineId,
    totalNodes: 1,
    completedNodes: 1,
    status: 'succeeded',
  });
}

async function run() {
  const canvasUri = await buildTempCanvasUri();

  try {
    await openCanvas(canvasUri);

    await simulateFailedRun(canvasUri, 'pipeline-full-failed', 'full');

    const afterFirstFailed = await waitFor(async () => {
      const current = await readLiveCanvas(canvasUri);
      const container = getBlueprintContainer(current);
      if (!container) { return null; }
      if (container.meta?.blueprint_last_run_status !== 'failed') { return null; }
      if ((container.meta?.blueprint_run_history ?? []).length !== 1) { return null; }
      if (container.meta?.blueprint_last_issue_node_id !== 'fn-summary') { return null; }
      return current;
    });

    const firstFailedContainer = getBlueprintContainer(afterFirstFailed);
    assert.ok(firstFailedContainer);
    assert.equal(firstFailedContainer.meta?.blueprint_run_history?.[0]?.mode, 'full');
    assert.equal(firstFailedContainer.meta?.blueprint_run_history?.[0]?.status, 'failed');

    await wait(120);
    await simulateSucceededResumeRun(canvasUri, 'pipeline-resume-succeeded');

    const afterResumeSuccess = await waitFor(async () => {
      const current = await readLiveCanvas(canvasUri);
      const container = getBlueprintContainer(current);
      if (!container) { return null; }
      if (container.meta?.blueprint_last_run_status !== 'succeeded') { return null; }
      if ((container.meta?.blueprint_run_history ?? []).length !== 2) { return null; }
      if (!container.meta?.blueprint_last_run_succeeded_at) { return null; }
      return current;
    });

    const resumeSuccessContainer = getBlueprintContainer(afterResumeSuccess);
    assert.ok(resumeSuccessContainer);
    assert.equal(resumeSuccessContainer.meta?.blueprint_last_issue_node_id, undefined);
    assert.deepEqual(
      mapRunHistory(resumeSuccessContainer),
      [
        { status: 'succeeded', mode: 'resume', issueNodeId: null, reusedCachedNodeCount: 0 },
        { status: 'failed', mode: 'full', issueNodeId: 'fn-summary', reusedCachedNodeCount: 0 },
      ],
    );

    await wait(120);
    await simulateFailedRun(canvasUri, 'pipeline-resume-refailed', 'resume');

    const afterResumeRefail = await waitFor(async () => {
      const current = await readLiveCanvas(canvasUri);
      const container = getBlueprintContainer(current);
      if (!container) { return null; }
      if (container.meta?.blueprint_last_run_status !== 'failed') { return null; }
      if ((container.meta?.blueprint_run_history ?? []).length !== 3) { return null; }
      if (!container.meta?.blueprint_last_run_failed_at || !container.meta?.blueprint_last_run_succeeded_at) { return null; }
      if (container.meta?.blueprint_last_issue_node_id !== 'fn-summary') { return null; }
      return current;
    });

    const refailedContainer = getBlueprintContainer(afterResumeRefail);
    assert.ok(refailedContainer);
    assert.deepEqual(
      mapRunHistory(refailedContainer),
      [
        { status: 'failed', mode: 'resume', issueNodeId: 'fn-summary', reusedCachedNodeCount: 0 },
        { status: 'succeeded', mode: 'resume', issueNodeId: null, reusedCachedNodeCount: 0 },
        { status: 'failed', mode: 'full', issueNodeId: 'fn-summary', reusedCachedNodeCount: 0 },
      ],
    );

    const succeededAt = Date.parse(refailedContainer.meta?.blueprint_last_run_succeeded_at ?? '');
    const failedAt = Date.parse(refailedContainer.meta?.blueprint_last_run_failed_at ?? '');
    assert.ok(Number.isFinite(succeededAt), 'Expected blueprint_last_run_succeeded_at to be persisted.');
    assert.ok(Number.isFinite(failedAt), 'Expected blueprint_last_run_failed_at to be persisted.');
    assert.ok(failedAt >= succeededAt, 'Expected the latest failed timestamp to be newer than or equal to the last succeeded timestamp.');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);

    await openCanvas(canvasUri);

    const reopened = await waitFor(async () => {
      const current = await readCanvas(canvasUri);
      const container = getBlueprintContainer(current);
      if (!container) { return null; }
      if ((container.meta?.blueprint_run_history ?? []).length !== 3) { return null; }
      return current;
    }, 12000, 150);
    const reopenedContainer = getBlueprintContainer(reopened);
    assert.ok(reopenedContainer);
    assert.equal(reopenedContainer.meta?.blueprint_last_run_status, 'failed');
    assert.equal(reopenedContainer.meta?.blueprint_last_issue_node_id, 'fn-summary');
    assert.deepEqual(
      mapRunHistory(reopenedContainer),
      [
        { status: 'failed', mode: 'resume', issueNodeId: 'fn-summary', reusedCachedNodeCount: 0 },
        { status: 'succeeded', mode: 'resume', issueNodeId: null, reusedCachedNodeCount: 0 },
        { status: 'failed', mode: 'full', issueNodeId: 'fn-summary', reusedCachedNodeCount: 0 },
      ],
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
