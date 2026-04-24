import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { CanvasNode } from '../../../src/core/canvas-model';

vi.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
}));
vi.mock('../../../src/core/content-extractor', () => ({
  extractSpreadsheetSheets: vi.fn(),
}));
vi.mock('../../../src/explosion/mineru-adapter', () => ({
  getMinerUConfig: vi.fn(() => ({ outputDir: '.research-space/explosions' })),
}));

import { extractSpreadsheetSheets } from '../../../src/core/content-extractor';
import { convertSpreadsheetNodeToFile } from '../../../src/explosion/spreadsheet-conversion';

describe('convertSpreadsheetNodeToFile', () => {
  const tempRoot = path.join('/tmp', `rs-spreadsheet-conversion-${Date.now()}`);
  const canvasDir = path.join(tempRoot, 'canvas');
  const dataDir = path.join(canvasDir, 'data');
  const canvasUri = { fsPath: path.join(canvasDir, 'research.rsws') } as { fsPath: string };

  beforeEach(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'sample.xlsx'), 'fake-xlsx');
    vi.mocked(extractSpreadsheetSheets).mockResolvedValue([
      {
        index: 1,
        title: '第 1 个工作表文本',
        text: '姓名\t分数\n张三\t95',
      },
    ]);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const sourceNode: CanvasNode = {
    id: 'xlsx-1',
    node_type: 'data',
    title: '成绩表',
    position: { x: 0, y: 0 },
    size: { width: 280, height: 160 },
    file_path: 'data/sample.xlsx',
  };

  it('converts spreadsheets into a single markdown node', async () => {
    const result = await convertSpreadsheetNodeToFile(sourceNode, canvasUri as never, 'md');

    expect(result.groupName).toBe('成绩表 · Markdown 转换组');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      node_type: 'note',
      title: '成绩表 · Markdown',
      meta: {
        explode_source_type: 'xlsx',
        explode_unit_type: 'sheet',
        explode_kind: 'table',
      },
    });
    const content = await fs.readFile(path.resolve(canvasDir, result.nodes[0].file_path!), 'utf8');
    expect(content).toContain('| 姓名 | 分数 |');
    expect(content).toContain('| 张三 | 95 |');
  });

  it('converts spreadsheets into a TeX tabular fragment node', async () => {
    const result = await convertSpreadsheetNodeToFile(sourceNode, canvasUri as never, 'tex');

    expect(result.groupName).toBe('成绩表 · TeX 转换组');
    expect(result.nodes[0]).toMatchObject({
      node_type: 'code',
      title: '成绩表 · TeX',
      meta: {
        language: 'latex',
        explode_kind: 'table',
      },
    });
    const content = await fs.readFile(path.resolve(canvasDir, result.nodes[0].file_path!), 'utf8');
    expect(content).toContain('\\begin{tabular}{ll}');
    expect(content).toContain('张三 & 95 \\\\');
  });
});
