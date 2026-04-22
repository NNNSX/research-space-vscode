const path = require('node:path');
const { runTests } = require('@vscode/test-electron');
const { buildLocalRunTestsOptions } = require('./local-vscode-runtime');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'custom-editor', 'index.js');
  const workspacePath = path.resolve(extensionDevelopmentPath, 'test', 'fixtures');
  await runTests(buildLocalRunTestsOptions({
    extensionDevelopmentPath,
    extensionTestsPath,
    workspacePath,
    extensionTestsEnv: {
      RESEARCH_SPACE_TEST_MODE: '1',
    },
  }));
}

main().catch(error => {
  console.error('Failed to run VS Code integration tests.');
  console.error(error);
  process.exit(1);
});
