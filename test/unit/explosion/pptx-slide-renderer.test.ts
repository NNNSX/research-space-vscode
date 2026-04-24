import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));
const { getDocumentMock } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
}));
const { globalWorkerOptionsMock } = vi.hoisted(() => ({
  globalWorkerOptionsMock: { workerSrc: '' },
}));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: getDocumentMock,
  GlobalWorkerOptions: globalWorkerOptionsMock,
}));

import { renderPptxSlidesToImages } from '../../../src/explosion/pptx-slide-renderer';

describe('renderPptxSlidesToImages', () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    delete process.env.RS_PPTX_PDF_READY_WAIT_MS;
    globalWorkerOptionsMock.workerSrc = '';
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    }
  });

  it('prefers Microsoft PowerPoint PDF export on macOS when osascript is available', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-pptx-renderer-'));
    const outputDir = path.join(rootDir, 'slides');
    const pptxPath = path.join(rootDir, 'sample.pptx');
    await fs.writeFile(pptxPath, 'fake-pptx');
    const renderMock = vi.fn(() => ({ promise: Promise.resolve() }));
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn(async () => ({
          getViewport: vi.fn(() => ({ width: 120, height: 80 })),
          render: renderMock,
        })),
        destroy: vi.fn(async () => undefined),
      }),
    });

    execFileMock.mockImplementation((binaryPath, args, options, callback) => {
      void options;
      if (binaryPath === '/usr/bin/osascript' && args[0] === '-e') {
        callback(null, '', '');
        return;
      }
      if (binaryPath === '/usr/bin/osascript' && String(args[0]).endsWith('.applescript')) {
        void fs.writeFile(path.join(outputDir, 'slides.pdf'), '%PDF-1.4\nfake-pdf').then(() => callback(null, '', ''));
        return;
      }
      callback(new Error(`Unexpected command: ${binaryPath} ${args.join(' ')}`));
    });

    const result = await renderPptxSlidesToImages(pptxPath, outputDir);

    expect(result).toEqual([
      path.join(outputDir, 'slide-1.png'),
      path.join(outputDir, 'slide-2.png'),
    ]);
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(globalWorkerOptionsMock.workerSrc).toContain('pdf.worker.mjs');
    expect(globalWorkerOptionsMock.workerSrc.startsWith('file://')).toBe(true);
    expect(getDocumentMock).toHaveBeenCalledWith(expect.objectContaining({
      disableFontFace: true,
      useSystemFonts: false,
      ownerDocument: expect.objectContaining({
        createElement: expect.any(Function),
        createElementNS: expect.any(Function),
      }),
      CanvasFactory: expect.any(Function),
      FilterFactory: expect.any(Function),
    }));

    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('uses soffice PDF export when LibreOffice is available', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-pptx-renderer-'));
    const outputDir = path.join(rootDir, 'slides');
    const pptxPath = path.join(rootDir, 'sample.pptx');
    await fs.writeFile(pptxPath, 'fake-pptx');
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn(async () => ({
          getViewport: vi.fn(() => ({ width: 120, height: 80 })),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
        })),
        destroy: vi.fn(async () => undefined),
      }),
    });

    execFileMock.mockImplementation((binaryPath, args, options, callback) => {
      void options;
      if (binaryPath === '/usr/bin/osascript') {
        callback(new Error('powerpoint unavailable'));
        return;
      }
      if (binaryPath === '/Applications/LibreOffice.app/Contents/MacOS/soffice' && args[0] === '--version') {
        callback(null, '', '');
        return;
      }
      if (args.includes('--convert-to') && args.includes('pdf')) {
        void fs.mkdir(outputDir, { recursive: true }).then(async () => {
          await fs.writeFile(path.join(outputDir, 'sample.pdf'), '%PDF-1.4\nfake-pdf');
          callback(null, '', '');
        });
        return;
      }
      callback(new Error(`Unexpected command: ${binaryPath} ${args.join(' ')}`));
    });

    const result = await renderPptxSlidesToImages(pptxPath, outputDir);

    expect(result).toEqual([
      path.join(outputDir, 'slide-1.png'),
      path.join(outputDir, 'slide-2.png'),
    ]);
    expect(getDocumentMock).toHaveBeenCalledTimes(1);

    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('throws a clear error when no PDF export backend is available', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-pptx-renderer-'));
    const outputDir = path.join(rootDir, 'slides');
    const pptxPath = path.join(rootDir, 'deck.pptx');
    await fs.writeFile(pptxPath, 'fake-pptx');

    execFileMock.mockImplementation((binaryPath, args, options, callback) => {
      void options;
      if (binaryPath === '/usr/bin/osascript') {
        callback(new Error('powerpoint unavailable'));
        return;
      }
      if (binaryPath.includes('soffice') || binaryPath === 'libreoffice') {
        callback(new Error('not installed'));
        return;
      }
      callback(new Error(`Unexpected command: ${binaryPath} ${args.join(' ')}`));
    });

    await expect(renderPptxSlidesToImages(pptxPath, outputDir)).rejects.toThrow('当前主链会优先使用 PowerPoint 导出 PDF');

    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('surfaces the actual PowerPoint export failure when PDF was not really written', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-pptx-renderer-'));
    const outputDir = path.join(rootDir, 'slides');
    const pptxPath = path.join(rootDir, 'sample.pptx');
    await fs.writeFile(pptxPath, 'fake-pptx');
    process.env.RS_PPTX_PDF_READY_WAIT_MS = '20';

    execFileMock.mockImplementation((binaryPath, args, options, callback) => {
      void options;
      if (binaryPath === '/usr/bin/osascript' && args[0] === '-e') {
        callback(null, '', '');
        return;
      }
      if (binaryPath === '/usr/bin/osascript' && String(args[0]).endsWith('.applescript')) {
        void fs.writeFile(path.join(outputDir, 'slides.pdf'), '').then(() => callback(null, '', ''));
        return;
      }
      callback(new Error(`Unexpected command: ${binaryPath} ${args.join(' ')}`));
    });

    await expect(renderPptxSlidesToImages(pptxPath, outputDir)).rejects.toThrow('没有成功写出可用的 PDF');

    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('does not crash when global navigator is exposed via getter-only descriptor', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-pptx-renderer-'));
    const outputDir = path.join(rootDir, 'slides');
    const pptxPath = path.join(rootDir, 'sample.pptx');
    await fs.writeFile(pptxPath, 'fake-pptx');

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      enumerable: true,
      get() {
        return undefined;
      },
    });

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getViewport: vi.fn(() => ({ width: 120, height: 80 })),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
        })),
        destroy: vi.fn(async () => undefined),
      }),
    });

    execFileMock.mockImplementation((binaryPath, args, options, callback) => {
      void options;
      if (binaryPath === '/usr/bin/osascript' && args[0] === '-e') {
        callback(null, '', '');
        return;
      }
      if (binaryPath === '/usr/bin/osascript' && String(args[0]).endsWith('.applescript')) {
        void fs.writeFile(path.join(outputDir, 'slides.pdf'), '%PDF-1.4\nfake-pdf').then(() => callback(null, '', ''));
        return;
      }
      callback(new Error(`Unexpected command: ${binaryPath} ${args.join(' ')}`));
    });

    await expect(renderPptxSlidesToImages(pptxPath, outputDir)).resolves.toEqual([
      path.join(outputDir, 'slide-1.png'),
    ]);

    await fs.rm(rootDir, { recursive: true, force: true });
  });
});
