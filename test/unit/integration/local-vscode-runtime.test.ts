import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  LOCAL_VSCODE_TEST_RUNTIME_VERSION,
  buildLocalRunTestsOptions,
  resolveLocalVSCodeExecutablePath,
} = require('../../integration/local-vscode-runtime');

describe('local VS Code integration runtime', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('builds runTests options from the pinned local runtime path without a version field', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-local-vscode-runtime-'));
    tempDirs.push(root);

    const executablePath = path.join(
      root,
      '.vscode-test',
      `vscode-darwin-arm64-${LOCAL_VSCODE_TEST_RUNTIME_VERSION}`,
      'Visual Studio Code.app',
      'Contents',
      'MacOS',
      'Code',
    );
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, '');

    const options = buildLocalRunTestsOptions({
      extensionDevelopmentPath: root,
      extensionTestsPath: '/tmp/extension-tests.js',
      workspacePath: '/tmp/workspace',
      extensionTestsEnv: { RESEARCH_SPACE_TEST_MODE: '1' },
    });

    expect(options.vscodeExecutablePath).toBe(executablePath);
    expect(options).not.toHaveProperty('version');
    expect(options.launchArgs[0]).toBe('/tmp/workspace');
    expect(options.extensionTestsEnv).toEqual({ RESEARCH_SPACE_TEST_MODE: '1' });
  });

  it('throws a no-download error when the pinned local runtime is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-local-vscode-runtime-missing-'));
    tempDirs.push(root);

    expect(() => resolveLocalVSCodeExecutablePath(root)).toThrowError(
      /must not download a newer version/i,
    );
  });
});
