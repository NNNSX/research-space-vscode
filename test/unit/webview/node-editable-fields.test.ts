import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'webview', 'src', 'components', 'nodes');

function readNodeSource(filename: string): string {
  return readFileSync(join(root, filename), 'utf8');
}

describe('canvas editable field drag guards', () => {
  it('keeps function-node editable controls marked as nodrag', () => {
    const source = readNodeSource('FunctionNode.tsx');

    expect(source).toContain('function stopEditableFieldMouseDown');
    expect(source).toContain('<textarea\n                    className="nodrag"');
    expect(source).toContain('<textarea\n        className="nodrag"');
    expect(source).toContain('<select\n      className="nodrag"');
    expect((source.match(/className="nodrag"/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect((source.match(/onMouseDown=\{stopEditableFieldMouseDown\}/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it('keeps task node inputs protected from canvas drag interception', () => {
    const source = readNodeSource('TaskBody.tsx');

    expect((source.match(/className="nodrag"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((source.match(/onMouseDown=\{e => e\.stopPropagation\(\)\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps experiment log inputs protected from canvas drag interception', () => {
    const source = readNodeSource('ExperimentLogBody.tsx');

    expect((source.match(/className="nodrag"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((source.match(/onMouseDown=\{e => e\.stopPropagation\(\)\}/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('keeps rename inputs in canvas menus and dialogs protected as well', () => {
    const contextMenuSource = readNodeSource('NodeContextMenu.tsx');
    const groupSource = readNodeSource('NodeGroupNode.tsx');

    expect(contextMenuSource).toContain('className="nodrag"');
    expect(contextMenuSource).toContain('onMouseDown={e => e.stopPropagation()}');
    expect(groupSource).toContain('className="nodrag"');
    expect(groupSource).toContain('onMouseDown={e => e.stopPropagation()}');
  });
});
