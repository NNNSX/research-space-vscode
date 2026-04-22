const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vscode = require('vscode');

async function run() {
  const result = await vscode.commands.executeCommand('researchSpace.test.inspectOllamaProvider');
  assert.ok(result, 'Expected Ollama provider inspection command to return a result.');
  assert.equal(result.providerId, 'ollama', 'Expected provider inspection to use the Ollama provider.');
  assert.equal(result.model, 'qwen3.5:0.8b', 'Expected provider inspection to resolve qwen3.5:0.8b.');
  assert.ok(Array.isArray(result.models), 'Expected provider inspection to return a model list.');
  assert.ok(
    result.models.some(model => model.id === 'qwen3.5:0.8b'),
    'Expected Ollama model list to include qwen3.5:0.8b.',
  );
  assert.ok(result.capabilities, 'Expected Ollama provider inspection to return capabilities.');
  assert.equal(
    result.capabilities.modelId,
    'qwen3.5:0.8b',
    'Expected capabilities to be resolved for qwen3.5:0.8b.',
  );
  assert.ok(
    typeof result.capabilities.contextWindowTokens === 'number' && result.capabilities.contextWindowTokens > 0,
    `Expected positive Ollama contextWindowTokens, got: ${JSON.stringify(result.capabilities)}`,
  );
  assert.match(
    String(result.capabilities.source || ''),
    /api\/show/i,
    'Expected Ollama capabilities to come from /api/show.',
  );
  assert.ok(result.auditPath, 'Expected Ollama provider inspection to return an audit log path.');
  const auditLog = await fs.readFile(result.auditPath, 'utf8');
  assert.match(auditLog, /"kind":"ollama-provider-inspection"/, 'Expected audit log to contain the provider inspection entry.');
  assert.match(auditLog, /"modelCount":/, 'Expected audit log to record the provider model count.');
}

module.exports = { run };
