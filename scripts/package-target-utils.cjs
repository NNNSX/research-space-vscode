function isMusl(reportHeader) {
  if (!reportHeader || typeof reportHeader !== 'object') { return false; }
  if (typeof reportHeader.glibcVersionRuntime === 'string' && reportHeader.glibcVersionRuntime) { return false; }
  const component = String(reportHeader.componentVersions?.glibc || '');
  if (component) { return false; }
  return true;
}

function resolveVsceTarget(platform = process.platform, arch = process.arch, reportHeader = process.report?.getReport?.().header) {
  if (platform === 'darwin') {
    if (arch === 'arm64') { return 'darwin-arm64'; }
    if (arch === 'x64') { return 'darwin-x64'; }
  }

  if (platform === 'win32') {
    if (arch === 'arm64') { return 'win32-arm64'; }
    if (arch === 'x64') { return 'win32-x64'; }
  }

  if (platform === 'linux') {
    const prefix = isMusl(reportHeader) ? 'alpine' : 'linux';
    if (arch === 'arm64') { return `${prefix}-arm64`; }
    if (arch === 'x64') { return `${prefix}-x64`; }
    if (arch === 'arm') { return 'linux-armhf'; }
  }

  throw new Error(`Unsupported VS Code extension target platform: ${platform}-${arch}`);
}

module.exports = { resolveVsceTarget, isMusl };
