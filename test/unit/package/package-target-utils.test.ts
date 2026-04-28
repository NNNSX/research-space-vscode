import { describe, expect, it } from 'vitest';

const { resolveVsceTarget } = require('../../../scripts/package-target-utils.cjs') as {
  resolveVsceTarget(platform: string, arch: string, reportHeader?: Record<string, unknown>): string;
};

describe('package target utils', () => {
  it('maps macOS and Windows targets explicitly', () => {
    expect(resolveVsceTarget('darwin', 'arm64')).toBe('darwin-arm64');
    expect(resolveVsceTarget('darwin', 'x64')).toBe('darwin-x64');
    expect(resolveVsceTarget('win32', 'x64')).toBe('win32-x64');
    expect(resolveVsceTarget('win32', 'arm64')).toBe('win32-arm64');
  });

  it('maps Linux glibc and musl targets separately', () => {
    expect(resolveVsceTarget('linux', 'x64', { glibcVersionRuntime: '2.35' })).toBe('linux-x64');
    expect(resolveVsceTarget('linux', 'arm64', { glibcVersionRuntime: '2.35' })).toBe('linux-arm64');
    expect(resolveVsceTarget('linux', 'x64', {})).toBe('alpine-x64');
    expect(resolveVsceTarget('linux', 'arm64', {})).toBe('alpine-arm64');
    expect(resolveVsceTarget('linux', 'arm', { glibcVersionRuntime: '2.35' })).toBe('linux-armhf');
  });
});
