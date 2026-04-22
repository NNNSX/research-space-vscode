const assert = require('node:assert/strict');
const vscode = require('vscode');

async function run() {
  const config = vscode.workspace.getConfiguration('researchSpace.ai');
  assert.equal(
    config.get('provider'),
    'ollama',
    'Expected integration test workspace to use Ollama as the AI provider.',
  );
  assert.equal(
    config.get('ollamaModel'),
    'qwen3.5:0.8b',
    'Expected integration test workspace to pin Ollama model to qwen3.5:0.8b.',
  );
}

module.exports = { run };
