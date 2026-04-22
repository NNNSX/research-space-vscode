const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'custom-editor', 'index.js');
  const workspacePath = path.resolve(extensionDevelopmentPath, 'test', 'fixtures');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspacePath,
      '--disable-extensions',
      '--disable-extension=github.copilot',
      '--disable-extension=github.copilot-chat',
      '--disable-extension=vscode.github',
      '--disable-extension=vscode.github-authentication',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
    ],
  });
}

main().catch(error => {
  console.error('Failed to run VS Code integration tests.');
  console.error(error);
  process.exit(1);
});
