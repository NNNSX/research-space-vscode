const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vscode = require('vscode');

async function run() {
  const result = await vscode.commands.executeCommand('researchSpace.test.runOllamaSmoke');
  assert.ok(result, 'Expected Ollama smoke command to return a result.');
  assert.equal(result.providerId, 'ollama', 'Expected smoke test to execute through the Ollama provider.');
  assert.equal(result.model, 'qwen3.5:0.8b', 'Expected smoke test to use qwen3.5:0.8b.');
  assert.ok(
    String(result.text || '').trim().length > 0,
    `Expected Ollama smoke output to be non-empty, got: ${JSON.stringify(result.text)}`,
  );
  assert.ok(result.auditPath, 'Expected Ollama smoke test to return an audit log path.');
  const auditLog = await fs.readFile(result.auditPath, 'utf8');
  assert.match(auditLog, /"kind":"ollama-smoke"/, 'Expected audit log to contain the Ollama smoke entry.');
  assert.match(auditLog, /qwen3\.5:0\.8b/, 'Expected audit log to record the qwen3.5:0.8b model.');
}

module.exports = { run };
