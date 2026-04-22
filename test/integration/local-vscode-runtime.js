const fs = require('node:fs');
const path = require('node:path');

const LOCAL_VSCODE_TEST_RUNTIME_VERSION = '1.116.0';

function resolveLocalVSCodeExecutablePath(extensionDevelopmentPath) {
  const vscodeExecutablePath = path.resolve(
    extensionDevelopmentPath,
    '.vscode-test',
    `vscode-darwin-arm64-${LOCAL_VSCODE_TEST_RUNTIME_VERSION}`,
    'Visual Studio Code.app',
    'Contents',
    'MacOS',
    'Code',
  );

  if (!fs.existsSync(vscodeExecutablePath)) {
    throw new Error(
      `Local VS Code test runtime not found at ${vscodeExecutablePath}. ` +
      'Integration tests are pinned to the existing local runtime and must not download a newer version.'
    );
  }

  return vscodeExecutablePath;
}

function buildLocalRunTestsOptions({
  extensionDevelopmentPath,
  extensionTestsPath,
  workspacePath,
  extensionTestsEnv,
}) {
  return {
    extensionDevelopmentPath,
    extensionTestsPath,
    vscodeExecutablePath: resolveLocalVSCodeExecutablePath(extensionDevelopmentPath),
    extensionTestsEnv,
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
  };
}

module.exports = {
  LOCAL_VSCODE_TEST_RUNTIME_VERSION,
  resolveLocalVSCodeExecutablePath,
  buildLocalRunTestsOptions,
};
