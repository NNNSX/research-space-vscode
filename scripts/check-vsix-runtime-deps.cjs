const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function listVsixEntries(vsixPath) {
  const script = `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    print('\\n'.join(z.namelist()))
`;
  const result = cp.spawnSync('python3', ['-c', script, vsixPath], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Failed to inspect ${vsixPath}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function findLatestVsix(cwd) {
  const files = fs.readdirSync(cwd)
    .filter(file => file.endsWith('.vsix'))
    .map(file => ({ file, mtime: fs.statSync(path.join(cwd, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) {
    throw new Error('No VSIX file found. Run npm run package first.');
  }
  return path.join(cwd, files[0].file);
}

function checkVsixRuntimeDeps(vsixPath = findLatestVsix(process.cwd())) {
  const entries = listVsixEntries(vsixPath);
  const required = [
    'extension/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    'extension/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
    'extension/node_modules/@napi-rs/canvas/index.js',
  ];
  const missing = required.filter(item => !entries.includes(item));
  const hasCanvasNative = entries.some(item => item.startsWith('extension/node_modules/@napi-rs/canvas-') && item.endsWith('.node'));
  if (!hasCanvasNative) {
    missing.push('extension/node_modules/@napi-rs/canvas-*/skia.*.node');
  }
  if (missing.length) {
    throw new Error(`VSIX runtime dependencies missing from ${path.basename(vsixPath)}:\n- ${missing.join('\n- ')}`);
  }
  return { vsixPath, entries, required, hasCanvasNative };
}

if (require.main === module) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const result = checkVsixRuntimeDeps(target);
  console.log(`[check-vsix-runtime-deps] OK ${path.basename(result.vsixPath)}`);
}

module.exports = { checkVsixRuntimeDeps, listVsixEntries };
