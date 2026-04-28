const { spawnSync } = require('child_process');
const path = require('path');
const { resolveVsceTarget } = require('./package-target-utils.cjs');

const pkg = require(path.join(process.cwd(), 'package.json'));
const target = resolveVsceTarget();
const out = `research-space-${pkg.version}-${target}.vsix`;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log(`[package] target=${target}`);
console.log(`[package] out=${out}`);

const result = spawnSync(npx, ['vsce', 'package', '--target', target, '--out', out], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
