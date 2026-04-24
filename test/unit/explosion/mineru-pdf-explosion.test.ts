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
vi.mock('../../../src/explosion/pptx-slide-renderer', () => ({
  renderPptxSlidesToImages: vi.fn(),
  renderPdfPagesToPngImages: vi.fn(),
}));
vi.mock('../../../src/explosion/mineru-adapter', () => ({
  MinerUError: class MinerUError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'MinerUError';
      this.code = code;
    }
  },
  getMinerUConfig: vi.fn(() => ({ outputDir: '.research-space/explosions' })),
  parseDocumentViaMinerU: vi.fn(),
  readMinerUResultManifest: vi.fn(),
}));

import { getPdfPageCount } from '../../../src/core/content-extractor';
import { renderPptxSlidesToImages } from '../../../src/explosion/pptx-slide-renderer';
import { MinerUError, parseDocumentViaMinerU, readMinerUResultManifest } from '../../../src/explosion/mineru-adapter';
import { explodeDocumentNodeViaMinerU, explodePdfNodeViaMinerU } from '../../../src/explosion/mineru-pdf-explosion';

describe('explodePdfNodeViaMinerU', () => {
  const tempRoot = path.join('/tmp', `rs-mineru-${Date.now()}`);
  const canvasDir = path.join(tempRoot, 'canvas');
  const outputDir = path.join(tempRoot, 'mineru-job');
  const paperDir = path.join(tempRoot, 'canvas', 'papers');
  const canvasUri = { fsPath: path.join(canvasDir, 'research.rsws') } as { fsPath: string };

  beforeEach(async () => {
    await fs.mkdir(canvasDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(paperDir, { recursive: true });
    await fs.writeFile(path.join(paperDir, 'sample.pdf'), '%PDF-1.4\n');
    vi.mocked(getPdfPageCount).mockResolvedValue(12);
    vi.mocked(parseDocumentViaMinerU).mockResolvedValue({
      requestMode: 'precise-batch-upload',
      endpoint: 'https://mineru.net/api/v4/file-urls/batch',
      outputDir,
      raw: {},
    });
    vi.mocked(renderPptxSlidesToImages).mockResolvedValue([]);
    vi.mocked(readMinerUResultManifest).mockResolvedValue({
      manifestPath: path.join(outputDir, 'content_list_v2.json'),
      outputDir,
      manifest: {
        content_list_v2: [
          { id: 't1', type: 'paragraph', page_idx: 0, text: 'First paragraph' },
          { id: 'i1', type: 'image', page_idx: 0, image_path: 'images/figure-1.png', caption: 'Figure 1' },
        ],
      },
    });
    await fs.mkdir(path.join(outputDir, 'images'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'images', 'figure-1.png'), 'fake-image');
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('materializes text units as markdown files and returns relative paths for both note and image nodes', async () => {
    const sourceNode: CanvasNode = {
      id: 'paper-1',
      node_type: 'paper',
      title: 'Sample PDF',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.pdf',
    };

    const result = await explodePdfNodeViaMinerU(sourceNode, canvasUri as never);

    expect(result.groupName).toBe('Sample PDF · 拆解组');
    expect(result.nodes).toHaveLength(3);

    const relationNode = result.nodes.find(node => node.node_type === 'note' && node.title === '文档关系索引');
    const noteNode = result.nodes.find(node => node.node_type === 'note' && node.title !== '文档关系索引');
    const imageNode = result.nodes.find(node => node.node_type === 'image');

    expect(noteNode?.file_path).toMatch(/^\.\.\/mineru-job\/rs-text-nodes\/.+\.md$/);
    expect(imageNode?.file_path).toBe('../mineru-job/images/figure-1.png');
    expect(relationNode?.file_path).toBe('../mineru-job/rs-text-nodes/0000-document-relations.md');
    expect(relationNode?.meta?.content_preview).toContain('## 文本文件索引');
    expect(relationNode?.meta?.content_preview).toContain('## 图片文件索引');
    expect(relationNode?.meta?.content_preview).toContain('0001-第-1-页文本.md');
    expect(relationNode?.meta?.content_preview).toContain('figure-1.png');
    expect(relationNode?.meta?.content_preview).toContain('Figure 1');
    expect(noteNode?.meta).toMatchObject({
      explode_provider: 'mineru',
      explode_source_file_path: 'papers/sample.pdf',
      explode_source_node_id: 'paper-1',
      explode_status: 'ready',
      explode_source_type: 'pdf',
      exploded_from_node_id: 'paper-1',
      explode_unit_type: 'page',
      explode_unit_index: 1,
      explode_kind: 'text',
      explode_order: 0,
    });
    expect(imageNode?.meta).toMatchObject({
      explode_provider: 'mineru',
      explode_source_file_path: 'papers/sample.pdf',
      explode_source_node_id: 'paper-1',
      explode_status: 'ready',
      explode_source_type: 'pdf',
      exploded_from_node_id: 'paper-1',
      explode_unit_type: 'page',
      explode_unit_index: 1,
      explode_kind: 'image',
      explode_order: 1,
    });
    expect(noteNode?.meta?.explode_session_id).toBeTruthy();
    expect(imageNode?.meta?.explode_session_id).toBe(noteNode?.meta?.explode_session_id);
    expect(relationNode?.meta?.explode_session_id).toBe(noteNode?.meta?.explode_session_id);

    const noteAbsPath = path.resolve(canvasDir, noteNode!.file_path!);
    await expect(fs.readFile(noteAbsPath, 'utf8')).resolves.toBe('First paragraph');
    const relationAbsPath = path.resolve(canvasDir, relationNode!.file_path!);
    const relationContent = await fs.readFile(relationAbsPath, 'utf8');
    expect(relationContent).toContain('| 1 | 0001-第-1-页文本.md | 第 1 页文本 | 第 1 页 | First paragraph |');
    expect(relationContent).toContain('| 1 | figure-1.png | 第 1 页图片 1 | 第 1 页 | Figure 1 |');
  });

  it('rejects pdfs that exceed MinerU page limits before calling the API', async () => {
    vi.mocked(getPdfPageCount).mockResolvedValue(260);

    const sourceNode: CanvasNode = {
      id: 'paper-1',
      node_type: 'paper',
      title: 'Too Large PDF',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.pdf',
    };

    const error = await explodePdfNodeViaMinerU(sourceNode, canvasUri as never).catch(value => value);
    expect(error).toBeInstanceOf(MinerUError);
    expect((error as MinerUError).code).toBe('input_limit_exceeded');
    expect((error as Error).message).toContain('200 页限制');
    expect(parseDocumentViaMinerU).not.toHaveBeenCalled();
  });

  it('supports docx nodes on the shared document explosion entry and writes section-style metadata', async () => {
    await fs.writeFile(path.join(paperDir, 'sample.docx'), 'fake-docx');

    const sourceNode: CanvasNode = {
      id: 'docx-1',
      node_type: 'note',
      title: 'Sample DOCX',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.docx',
    };

    const result = await explodeDocumentNodeViaMinerU(sourceNode, canvasUri as never);

    expect(result.groupName).toBe('Sample DOCX · 拆解组');
    expect(result.nodes).toHaveLength(3);

    const relationNode = result.nodes.find(node => node.title === '文档关系索引');
    const noteNode = result.nodes.find(node => node.node_type === 'note' && node.title !== '文档关系索引');
    const imageNode = result.nodes.find(node => node.node_type === 'image');

    expect(noteNode?.meta).toMatchObject({
      explode_source_type: 'docx',
      explode_unit_type: 'section',
      explode_kind: 'text',
    });
    expect(imageNode?.meta).toMatchObject({
      explode_source_type: 'docx',
      explode_unit_type: 'section',
      explode_kind: 'image',
    });
    expect(relationNode?.meta).toMatchObject({
      explode_source_type: 'docx',
    });
    expect(parseDocumentViaMinerU).toHaveBeenCalledWith(expect.stringContaining('sample.docx'), canvasDir);
  });

  it('uses rendered slide previews as the primary pptx image output when available', async () => {
    await fs.writeFile(path.join(paperDir, 'sample.pptx'), 'fake-pptx');
    await fs.mkdir(path.join(outputDir, 'rs-slide-previews'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'rs-slide-previews', 'sample-1.png'), 'fake-preview');
    vi.mocked(renderPptxSlidesToImages).mockResolvedValue([
      path.join(outputDir, 'rs-slide-previews', 'sample-1.png'),
    ]);
    vi.mocked(readMinerUResultManifest).mockResolvedValueOnce({
      manifestPath: path.join(outputDir, 'content_list_v2.json'),
      outputDir,
      manifest: {
        content_list_v2: [
          { id: 't1', type: 'paragraph', page_idx: 0, text: 'Slide summary' },
          { id: 'i1', type: 'image', page_idx: 0, image_path: 'images/slide-1.png', caption: 'Slide image' },
        ],
      },
    });

    const sourceNode: CanvasNode = {
      id: 'pptx-1',
      node_type: 'note',
      title: 'Sample PPTX',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.pptx',
    };

    const result = await explodeDocumentNodeViaMinerU(sourceNode, canvasUri as never);
    const relationNode = result.nodes.find(node => node.title === '文档关系索引');
    const noteNode = result.nodes.find(node => node.node_type === 'note' && node.title !== '文档关系索引');
    const imageNode = result.nodes.find(node => node.node_type === 'image');

    expect(result.nodes.map(node => node.title)).toEqual(['文档关系索引', '第 1 张幻灯片图片 1', '第 1 张幻灯片文本']);
    expect(noteNode?.meta).toMatchObject({
      explode_source_type: 'pptx',
      explode_unit_type: 'slide',
    });
    expect(imageNode?.meta?.content_preview).toContain('位置：第 1 张幻灯片');
    expect(imageNode?.file_path).toBe('../mineru-job/rs-slide-previews/sample-1.png');
    expect(imageNode?.meta?.content_preview).toContain('sample-1.png');
    expect(relationNode?.meta?.content_preview).toContain('sample-1.png');
    expect(relationNode?.meta?.content_preview).not.toContain('slide-1.png');
  });

  it('starts pptx preview rendering before MinerU parsing so authorization appears first', async () => {
    await fs.writeFile(path.join(paperDir, 'sample.pptx'), 'fake-pptx');
    vi.mocked(renderPptxSlidesToImages).mockResolvedValueOnce([
      path.join(outputDir, 'rs-slide-previews', 'sample-1.png'),
    ]);
    vi.mocked(readMinerUResultManifest).mockResolvedValueOnce({
      manifestPath: path.join(outputDir, 'content_list_v2.json'),
      outputDir,
      manifest: {
        content_list_v2: [
          { id: 't1', type: 'paragraph', page_idx: 0, text: 'fragment only in MinerU' },
        ],
      },
    });

    const sourceNode: CanvasNode = {
      id: 'pptx-local-1',
      node_type: 'note',
      title: 'Sample PPTX',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.pptx',
    };

    await explodeDocumentNodeViaMinerU(sourceNode, canvasUri as never);

    expect(vi.mocked(renderPptxSlidesToImages).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(parseDocumentViaMinerU).mock.invocationCallOrder[0],
    );
  });

  it('keeps rendered slide previews even when some slides have no MinerU text units', async () => {
    await fs.writeFile(path.join(paperDir, 'sample.pptx'), 'fake-pptx');
    await fs.mkdir(path.join(outputDir, 'rs-slide-previews'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'rs-slide-previews', 'sample-1.png'), 'fake-preview-1');
    await fs.writeFile(path.join(outputDir, 'rs-slide-previews', 'sample-2.png'), 'fake-preview-2');
    vi.mocked(renderPptxSlidesToImages).mockResolvedValue([
      path.join(outputDir, 'rs-slide-previews', 'sample-1.png'),
      path.join(outputDir, 'rs-slide-previews', 'sample-2.png'),
    ]);
    vi.mocked(readMinerUResultManifest).mockResolvedValueOnce({
      manifestPath: path.join(outputDir, 'content_list_v2.json'),
      outputDir,
      manifest: {
        content_list_v2: [
          { id: 't1', type: 'paragraph', page_idx: 0, text: 'Slide summary' },
        ],
      },
    });

    const sourceNode: CanvasNode = {
      id: 'pptx-2',
      node_type: 'note',
      title: 'Sample PPTX',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.pptx',
    };

    const result = await explodeDocumentNodeViaMinerU(sourceNode, canvasUri as never);

    expect(result.nodes.map(node => node.title)).toEqual([
      '文档关系索引',
      '第 1 张幻灯片图片 1',
      '第 1 张幻灯片文本',
      '第 2 张幻灯片图片 1',
    ]);
    expect(result.nodes.find(node => node.title === '第 2 张幻灯片图片 1')?.file_path).toBe('../mineru-job/rs-slide-previews/sample-2.png');
  });

  it('supports xlsx nodes through MinerU and writes sheet-style metadata', async () => {
    await fs.writeFile(path.join(paperDir, 'sample.xlsx'), 'fake-xlsx');

    const sourceNode: CanvasNode = {
      id: 'xlsx-1',
      node_type: 'data',
      title: 'Sample XLSX',
      position: { x: 0, y: 0 },
      size: { width: 280, height: 160 },
      file_path: 'papers/sample.xlsx',
    };

    const result = await explodeDocumentNodeViaMinerU(sourceNode, canvasUri as never);
    const relationNode = result.nodes.find(node => node.title === '文档关系索引');
    const noteNode = result.nodes.find(node => node.node_type === 'note' && node.title !== '文档关系索引');

    expect(result.nodes.map(node => node.title)).toEqual([
      '文档关系索引',
      '第 1 个工作表文本',
      '第 1 个工作表图片 1',
    ]);
    expect(noteNode?.meta).toMatchObject({
      explode_source_type: 'xlsx',
      explode_unit_type: 'sheet',
      explode_kind: 'text',
    });
    expect(relationNode?.meta?.content_preview).toContain('第 1 个工作表');
    expect(parseDocumentViaMinerU).toHaveBeenCalledWith(expect.stringContaining('sample.xlsx'), canvasDir);
  });
});
