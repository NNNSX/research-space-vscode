import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

describe('package scripts', () => {
  it('packages a generic VSIX by default and keeps target packaging explicit', () => {
    expect(packageJson.scripts.package).toBe('npm run build:package && vsce package');
    expect(packageJson.scripts['package:generic']).toBe('npm run build:package && vsce package');
    expect(packageJson.scripts['package:target']).toContain('package-current-target.cjs');
    expect(packageJson.scripts['check:vsix']).toContain('check-vsix-runtime-deps.cjs');
  });
});
