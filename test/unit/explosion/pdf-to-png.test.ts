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
  getPdfPageCount: vi.fn(),
}));
vi.mock('../../../src/explosion/mineru-adapter', () => ({
  getMinerUConfig: vi.fn(() => ({ outputDir: '.research-space/explosions' })),
}));
vi.mock('../../../src/explosion/pptx-slide-renderer', () => ({
  renderPdfPagesToPngImages: vi.fn(),
}));

import { getPdfPageCount } from '../../../src/core/content-extractor';
import { renderPdfPagesToPngImages } from '../../../src/explosion/pptx-slide-renderer';
import { convertPdfNodeToPngGroup } from '../../../src/explosion/pdf-to-png';

describe('convertPdfNodeToPngGroup', () => {
  const tempRoot = path.join('/tmp', `rs-pdf-to-png-${Date.now()}`);
  const canvasDir = path.join(tempRoot, 'canvas');
  const paperDir = path.join(canvasDir, 'papers');
  const outputDir = path.join(canvasDir, '.research-space/explosions/sample/pdf-pages');
  const canvasUri = { fsPath: path.join(canvasDir, 'research.rsws') } as { fsPath: string };

  beforeEach(async () => {
    await fs.mkdir(paperDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(paperDir, 'sample.pdf'), '%PDF-1.4\n');
    const images = [
      path.join(outputDir, 'page-1.png'),
      path.join(outputDir, 'page-2.png'),
    ];
    for (const image of images) {
      await fs.writeFile(image, 'fake-image');
    }
    vi.mocked(getPdfPageCount).mockResolvedValue(2);
    vi.mocked(renderPdfPagesToPngImages).mockResolvedValue(images);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('creates image nodes and a relation index for every rendered PDF page', async () => {
    const sourceNode: CanvasNode = {
      id: 'pdf-1',
      node_type: 'paper',
      title: 'Sample PDF',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.pdf',
    };

    const result = await convertPdfNodeToPngGroup(sourceNode, canvasUri as never);

    expect(renderPdfPagesToPngImages).toHaveBeenCalledWith(
      expect.stringContaining('sample.pdf'),
      expect.stringContaining('pdf-pages'),
      expect.objectContaining({ filenamePrefix: 'page' }),
    );
    expect(result.groupName).toBe('Sample PDF · 页面图片组');
    expect(result.nodes.map(node => node.title)).toEqual([
      'PDF 页面图片关系索引',
      '第 1 页图片',
      '第 2 页图片',
    ]);
    expect(result.nodes[0].node_type).toBe('note');
    expect(result.nodes[0].meta?.content_preview).toContain('| 1 | page-1.png | 第 1 页图片 | 第 1 页 |');
    expect(result.nodes[1]).toMatchObject({
      node_type: 'image',
      file_path: '.research-space/explosions/sample/pdf-pages/page-1.png',
      meta: {
        explode_source_type: 'pdf',
        explode_unit_type: 'page',
        explode_unit_index: 1,
        explode_kind: 'image',
      },
    });
  });
});
