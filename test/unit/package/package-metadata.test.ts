import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

describe('package metadata', () => {
  it('points users to the public GitHub repository used for releases', () => {
    expect(packageJson.repository).toMatchObject({
      type: 'git',
      url: 'https://github.com/NNNSX/research-space-vscode',
    });
  });
});
