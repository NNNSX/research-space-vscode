import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import type { CanvasNode } from '../../../src/core/canvas-model';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));
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
  renderPptxSlidesToImages: vi.fn(),
}));

import { getPdfPageCount } from '../../../src/core/content-extractor';
import { renderPdfPagesToPngImages } from '../../../src/explosion/pptx-slide-renderer';
import { convertDocumentNodeToPngGroup } from '../../../src/explosion/document-to-png';

describe('convertDocumentNodeToPngGroup', () => {
  const tempRoot = path.join('/tmp', `rs-document-to-png-${Date.now()}`);
  const canvasDir = path.join(tempRoot, 'canvas');
  const paperDir = path.join(canvasDir, 'papers');
  const outputDir = path.join(canvasDir, '.research-space/explosions/sample/pdf-pages');
  const canvasUri = { fsPath: path.join(canvasDir, 'research.rsws') } as { fsPath: string };
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  function setPlatform(value: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      value,
      configurable: true,
    });
  }

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
    vi.mocked(execFile).mockImplementation((binaryPath: any, args: any, options: any, callback: any) => {
      const cb = typeof options === 'function' ? options : callback;
      if (binaryPath === '/usr/bin/osascript' && Array.isArray(args) && String(args[0]).endsWith('.applescript')) {
        fs.writeFile(String(args[2]), '%PDF-1.4\n').then(() => cb?.(null, '', ''), cb);
        return {} as any;
      }
      cb?.(null, '', '');
      return {} as any;
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
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

    const result = await convertDocumentNodeToPngGroup(sourceNode, canvasUri as never);

    expect(renderPdfPagesToPngImages).toHaveBeenCalledWith(
      expect.stringContaining('sample.pdf'),
      expect.stringContaining('png-pages-'),
      expect.objectContaining({ filenamePrefix: 'page' }),
    );
    expect(result.groupName).toBe('Sample PDF · PNG 转换组');
    expect(result.nodes.map(node => node.title)).toEqual([
      'PDF 图片关系索引',
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

  it('prefers Microsoft Word on macOS before converting docx PDF output to PNG', async () => {
    setPlatform('darwin');
    await fs.writeFile(path.join(paperDir, 'sample.docx'), 'fake-docx');
    vi.mocked(renderPdfPagesToPngImages).mockResolvedValueOnce([
      path.join(canvasDir, '.research-space/explosions/sample/png-pages-test/page-1.png'),
    ]);
    const sourceNode: CanvasNode = {
      id: 'docx-1',
      node_type: 'note',
      title: 'Sample Word',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.docx',
    };

    const result = await convertDocumentNodeToPngGroup(sourceNode, canvasUri as never);

    expect(execFile).toHaveBeenCalledWith('/usr/bin/osascript', ['-e', 'id of application "Microsoft Word"'], expect.any(Object), expect.any(Function));
    expect(vi.mocked(execFile).mock.calls.some(call =>
      call[0] === '/usr/bin/osascript' &&
      Array.isArray(call[1]) &&
      String(call[1][0]).endsWith('.applescript'),
    )).toBe(true);
    expect(renderPdfPagesToPngImages).toHaveBeenCalledWith(
      expect.stringContaining('word.pdf'),
      expect.stringContaining('png-pages-'),
      expect.objectContaining({ filenamePrefix: 'page' }),
    );
    expect(result.nodes.map(node => node.title)).toEqual([
      'Word 图片关系索引',
      '第 1 页图片',
    ]);
  });

  it('falls back to LibreOffice when Microsoft Word is unavailable on macOS', async () => {
    setPlatform('darwin');
    await fs.writeFile(path.join(paperDir, 'sample.docx'), 'fake-docx');
    vi.mocked(execFile).mockImplementation((binaryPath: any, args: any, options: any, callback: any) => {
      const cb = typeof options === 'function' ? options : callback;
      if (binaryPath === '/usr/bin/osascript') {
        cb?.(new Error('Word missing'));
        return {} as any;
      }
      if (binaryPath === '/Applications/LibreOffice.app/Contents/MacOS/soffice' && Array.isArray(args) && args[0] === '--version') {
        cb?.(null, '', '');
        return {} as any;
      }
      if (binaryPath === '/Applications/LibreOffice.app/Contents/MacOS/soffice' && Array.isArray(args) && args.includes('--convert-to')) {
        const outDir = String(args[args.indexOf('--outdir') + 1]);
        fs.writeFile(path.join(outDir, 'sample.pdf'), '%PDF-1.4\n').then(() => cb?.(null, '', ''), cb);
        return {} as any;
      }
      cb?.(new Error('unexpected execFile call'));
      return {} as any;
    });
    vi.mocked(renderPdfPagesToPngImages).mockResolvedValueOnce([
      path.join(canvasDir, '.research-space/explosions/sample/png-pages-test/page-1.png'),
    ]);

    await convertDocumentNodeToPngGroup({
      id: 'docx-1',
      node_type: 'note',
      title: 'Sample Word',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.docx',
    }, canvasUri as never);

    expect(vi.mocked(execFile).mock.calls.some(call =>
      call[0] === '/Applications/LibreOffice.app/Contents/MacOS/soffice' &&
      Array.isArray(call[1]) &&
      call[1].includes('--convert-to'),
    )).toBe(true);
    expect(renderPdfPagesToPngImages).toHaveBeenCalledWith(
      expect.stringContaining('sample.pdf'),
      expect.any(String),
      expect.objectContaining({ filenamePrefix: 'page' }),
    );
  });
});
