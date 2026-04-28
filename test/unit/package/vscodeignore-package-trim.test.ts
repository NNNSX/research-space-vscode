import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('VSIX packaging ignore rules', () => {
  it('keeps runtime node_modules for pdf workers while excluding tests and internal files', () => {
    const ignore = fs.readFileSync(path.join(__dirname, '../../../.vscodeignore'), 'utf-8');

    expect(ignore).toContain('node_modules/*');
    expect(ignore).not.toContain('node_modules/**\n!node_modules/@napi-rs/**');
    expect(ignore).toContain('node_modules/**/test/**');
    expect(ignore).toContain('test/');
    expect(ignore).toContain('*.test.*');
    expect(ignore).toContain('scripts/');
    expect(ignore).toContain('AGENTS.md');
    expect(ignore).toContain('CODEX.md');
    expect(ignore).toContain('CLAUDE.md');
  });
});
