import * as path from 'path';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const yauzl = require('yauzl');

const runtimeRequire = createRequire(__filename);
const runtimeGlobals = globalThis as typeof globalThis & {
  DOMMatrix?: unknown;
  ImageData?: unknown;
  Path2D?: unknown;
  navigator?: any;
};

function defineRuntimeValue(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

type ExecFileOptions = {
  timeout: number;
  maxBuffer: number;
};

type RendererBackend = {
  id: 'powerpoint-mac' | 'powerpoint-windows' | 'soffice';
  candidates: string[];
  probeArgs: string[];
};

type ResolvedRendererBackend = {
  backend: RendererBackend;
  binaryPath: string;
};
type RenderStageReporter = (message: string) => void;

type ZipEntryMap = Map<string, Buffer>;
const PDF_READY_WAIT_MS = 15000;
const PDF_READY_POLL_MS = 500;

function getPdfReadyWaitMs(): number {
  const raw = Number(process.env.RS_PPTX_PDF_READY_WAIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : PDF_READY_WAIT_MS;
}

const POWERPOINT_MAC_BACKEND: RendererBackend = {
  id: 'powerpoint-mac',
  candidates: [
    '/usr/bin/osascript',
    'osascript',
  ],
  probeArgs: ['-e', 'return "ok"'],
};

const POWERPOINT_WINDOWS_BACKEND: RendererBackend = {
  id: 'powerpoint-windows',
  candidates: [
    'powershell.exe',
    'pwsh.exe',
    'pwsh',
    'powershell',
  ],
  probeArgs: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'],
};

const SOFFICE_BACKEND: RendererBackend = {
  id: 'soffice',
  candidates: [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/Applications/OpenOffice.app/Contents/MacOS/soffice',
    '/opt/homebrew/bin/soffice',
    '/usr/local/bin/soffice',
    'soffice',
    'libreoffice',
  ],
  probeArgs: ['--version'],
};

function getBackendsForCurrentPlatform(): RendererBackend[] {
  if (process.platform === 'darwin') {
    return [
      POWERPOINT_MAC_BACKEND,
      SOFFICE_BACKEND,
    ];
  }
  if (process.platform === 'win32') {
    return [
      POWERPOINT_WINDOWS_BACKEND,
      SOFFICE_BACKEND,
    ];
  }
  return [
    SOFFICE_BACKEND,
  ];
}

function execFileAsync(binaryPath: string, args: string[], options: ExecFileOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, options, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function canExecute(binaryPath: string, probeArgs: string[]): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, probeArgs, {
      timeout: 5000,
      maxBuffer: 512 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveRendererBackends(): Promise<ResolvedRendererBackend[]> {
  const resolved: ResolvedRendererBackend[] = [];
  for (const backend of getBackendsForCurrentPlatform()) {
    for (const candidate of backend.candidates) {
      if (await canExecute(candidate, backend.probeArgs)) {
        resolved.push({ backend, binaryPath: candidate });
        break;
      }
    }
  }
  return resolved;
}

function sortEntries(entries: string[]): string[] {
  return entries.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function collectFilesRecursive(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectFilesRecursive(entryPath));
      continue;
    }
    results.push(entryPath);
  }
  return results;
}

async function listImageFiles(outputDir: string): Promise<string[]> {
  const entries = await collectFilesRecursive(outputDir);
  return sortEntries(entries.filter(entry => /\.(png|jpe?g)$/i.test(entry)));
}

function getRendererLabel(backendId: RendererBackend['id']): string {
  switch (backendId) {
    case 'powerpoint-mac':
      return 'PowerPoint (macOS)';
    case 'powerpoint-windows':
      return 'PowerPoint (Windows)';
    case 'soffice':
      return 'LibreOffice / soffice';
    default:
      return backendId;
  }
}

function isZipBasedPpt(filePath: string): boolean {
  return /\.(pptx|pptm|ppsx|ppsm|potx|potm)$/i.test(filePath);
}

function readZipEntries(zipPath: string): Promise<ZipEntryMap> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err: Error | null, zipFile: any) => {
      if (err || !zipFile) {
        reject(err ?? new Error(`Failed to open zip: ${zipPath}`));
        return;
      }
      const entries = new Map<string, Buffer>();
      zipFile.readEntry();
      zipFile.on('entry', (entry: any) => {
        if (entry.fileName.endsWith('/')) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamErr: Error | null, stream: any) => {
          if (streamErr || !stream) {
            reject(streamErr ?? new Error(`Failed to read zip entry: ${entry.fileName}`));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          stream.on('error', reject);
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipFile.readEntry();
          });
        });
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.on('error', reject);
    });
  });
}

async function getPptxSlideCount(pptPath: string): Promise<number | null> {
  if (!isZipBasedPpt(pptPath)) {
    return null;
  }
  try {
    const entries = await readZipEntries(pptPath);
    return Array.from(entries.keys())
      .filter(entry => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
      .length;
  } catch {
    return null;
  }
}

function buildMissingBackendError(availableBackends: ResolvedRendererBackend[]): Error {
  const available = availableBackends.length > 0
    ? availableBackends.map(item => getRendererLabel(item.backend.id)).join(' / ')
    : '无';
  return new Error(
    `当前 PPT / PPTX 的整页拆解需要可用的整页渲染后端。已检测到：${available}。当前主链会优先使用 PowerPoint 导出 PDF，再逐页转成 PNG；若无 PowerPoint，请安装 LibreOffice。`,
  );
}

function buildIncompleteRenderError(
  backendId: RendererBackend['id'],
  imageCount: number,
  expectedCount: number,
): Error {
  return new Error(
    `${getRendererLabel(backendId)} 导出的 PDF 只成功转出了 ${imageCount}/${expectedCount} 张整页幻灯片图片，结果不完整。请优先使用 Microsoft PowerPoint；若无 PowerPoint，请安装 LibreOffice，当前不会再把不完整结果当作成功输出。`,
  );
}

function buildPdfExportFailedError(
  backendId: RendererBackend['id'],
  pdfPath: string,
): Error {
  return new Error(
    `${getRendererLabel(backendId)} 已被调用，但没有成功写出可用的 PDF：${pdfPath}。这通常说明当前 macOS / PowerPoint 自动化导出没有真正落盘；请先确认 PowerPoint 对该文件有读取权限，并优先保持 PowerPoint 已启动后再重试。若仍失败，请安装 LibreOffice 作为 PPT 整页渲染 fallback。`,
  );
}

async function waitForUsablePdf(pdfPath: string, backendId: RendererBackend['id']): Promise<void> {
  const deadlineAt = Date.now() + getPdfReadyWaitMs();
  while (Date.now() < deadlineAt) {
    try {
      const stat = await fs.stat(pdfPath);
      if (stat.isFile() && stat.size > 0) {
        const handle = await fs.open(pdfPath, 'r');
        const buffer = Buffer.alloc(5);
        await handle.read(buffer, 0, 5, 0);
        await handle.close();
        if (buffer.toString('utf8') === '%PDF-') {
          return;
        }
      }
    } catch {
      // wait for file to appear
    }
    await new Promise(resolve => setTimeout(resolve, PDF_READY_POLL_MS));
  }
  throw buildPdfExportFailedError(backendId, pdfPath);
}

function loadNodeCanvasModule(): {
  createCanvas: (width: number, height: number) => {
    getContext: (type: '2d') => unknown;
    toBuffer: (mimeType: 'image/png') => Buffer;
  };
  DOMMatrix?: unknown;
  ImageData?: unknown;
  Path2D?: unknown;
} {
  try {
    return runtimeRequire('@napi-rs/canvas');
  } catch (error) {
    throw new Error(
      `当前环境缺少 PDF 转 PNG 所需的 @napi-rs/canvas 运行时，无法继续生成整页幻灯片图片。${error instanceof Error ? ` 原始错误：${error.message}` : ''}`,
    );
  }
}

function ensurePdfRuntimeGlobals(canvasModule: {
  DOMMatrix?: unknown;
  ImageData?: unknown;
  Path2D?: unknown;
}): void {
  if (!runtimeGlobals.DOMMatrix && canvasModule.DOMMatrix) {
    defineRuntimeValue(runtimeGlobals, 'DOMMatrix', canvasModule.DOMMatrix);
  }
  if (!runtimeGlobals.ImageData && canvasModule.ImageData) {
    defineRuntimeValue(runtimeGlobals, 'ImageData', canvasModule.ImageData);
  }
  if (!runtimeGlobals.Path2D && canvasModule.Path2D) {
    defineRuntimeValue(runtimeGlobals, 'Path2D', canvasModule.Path2D);
  }
  const navigatorValue = runtimeGlobals.navigator;
  const fallbackNavigator = {
    language: 'en-US',
    platform: process.platform,
    userAgent: `node ${process.version}`,
  };
  if (!navigatorValue || typeof navigatorValue !== 'object') {
    defineRuntimeValue(runtimeGlobals, 'navigator', fallbackNavigator);
    return;
  }
  if (!navigatorValue.language) {
    defineRuntimeValue(navigatorValue, 'language', fallbackNavigator.language);
  }
  if (!navigatorValue.platform) {
    defineRuntimeValue(navigatorValue, 'platform', fallbackNavigator.platform);
  }
  if (!navigatorValue.userAgent) {
    defineRuntimeValue(navigatorValue, 'userAgent', fallbackNavigator.userAgent);
  }
}

function createPdfOwnerDocument(canvasModule: {
  createCanvas: (width: number, height: number) => any;
}): {
  createElement: (tagName: string) => any;
  createElementNS: (_namespace: string, tagName: string) => any;
  documentElement: { getElementsByTagName: (_tagName: string) => Array<{ append: (_node: unknown) => void }> };
  body: { append: (_node: unknown) => void };
  fonts: { add: (_fontFace: unknown) => void; delete: (_fontFace: unknown) => void };
} {
  const createStubElement = (): any => {
    const cssRules: string[] = [];
    return {
      style: {},
      sheet: {
        cssRules,
        insertRule(rule: string, index: number): void {
          cssRules.splice(index, 0, rule);
        },
      },
      append(): void {},
      appendChild(): void {},
      remove(): void {},
      setAttribute(): void {},
      getContext(): undefined {
        return undefined;
      },
      textContent: '',
    };
  };

  return {
    createElement(tagName: string): any {
      if (tagName === 'canvas') {
        return canvasModule.createCanvas(1, 1);
      }
      return createStubElement();
    },
    createElementNS(_namespace: string, tagName: string): any {
      return this.createElement(tagName);
    },
    documentElement: {
      getElementsByTagName(): Array<{ append: (_node: unknown) => void }> {
        return [{ append(): void {} }];
      },
    },
    body: {
      append(): void {},
    },
    fonts: {
      add(): void {},
      delete(): void {},
    },
  };
}

class PdfCanvasFactory {
  private readonly createCanvasImpl: (width: number, height: number) => any;

  constructor(options: {
    createCanvas: (width: number, height: number) => any;
  }) {
    this.createCanvasImpl = options.createCanvas;
  }

  create(width: number, height: number): { canvas: any; context: unknown } {
    const canvas = this.createCanvasImpl(width, height);
    return {
      canvas,
      context: canvas.getContext('2d'),
    };
  }

  reset(canvasAndContext: { canvas: any }, width: number, height: number): void {
    if (!canvasAndContext.canvas) {
      throw new Error('Canvas is not specified');
    }
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: { canvas: any; context: unknown | null }): void {
    if (!canvasAndContext.canvas) {
      return;
    }
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

class PdfFilterFactory {
  addFilter(): string {
    return 'none';
  }

  addHCMFilter(): string {
    return 'none';
  }

  addAlphaFilter(): string {
    return 'none';
  }

  addLuminosityFilter(): string {
    return 'none';
  }

  addHighlightHCMFilter(): string {
    return 'none';
  }

  destroy(): void {}
}

function resolvePdfWorkerSrc(): string {
  try {
    const workerPath = runtimeRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return pathToFileURL(workerPath).href;
  } catch (error) {
    throw new Error(
      `当前环境缺少 pdf.js worker 入口，无法继续把 PDF 转成整页 PNG。${error instanceof Error ? ` 原始错误：${error.message}` : ''}`,
    );
  }
}

async function rasterizePdfToImages(pdfPath: string, outputDir: string, onStage?: RenderStageReporter): Promise<string[]> {
  const canvasModule = loadNodeCanvasModule();
  ensurePdfRuntimeGlobals(canvasModule);
  const ownerDocument = createPdfOwnerDocument(canvasModule);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc();
  }
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await fs.readFile(pdfPath)),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    ownerDocument,
    CanvasFactory: class extends PdfCanvasFactory {
      constructor() {
        super({ createCanvas: canvasModule.createCanvas });
      }
    },
    FilterFactory: PdfFilterFactory,
  }).promise;
  const images: string[] = [];
  onStage?.(`正在逐页生成 PNG… 共 ${document.numPages} 页`);
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext('2d');
    await page.render({
      canvas,
      canvasContext,
      viewport,
    } as any).promise;
    const imageBuffer = canvas.toBuffer('image/png');
    const imagePath = path.join(outputDir, `slide-${pageNumber}.png`);
    await fs.writeFile(imagePath, imageBuffer);
    images.push(imagePath);
  }
  await document.destroy?.();
  return images;
}

async function exportPdfWithSoffice(binaryPath: string, pptPath: string, outputDir: string): Promise<string> {
  await execFileAsync(binaryPath, [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDir,
    pptPath,
  ], {
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });

  const basename = path.basename(pptPath, path.extname(pptPath)).toLowerCase();
  const entries = await collectFilesRecursive(outputDir);
  const pdfEntries = entries.filter(entry => entry.toLowerCase().endsWith('.pdf'));
  const matched = pdfEntries.filter(entry => entry.toLowerCase().startsWith(path.join(outputDir, basename).toLowerCase()));
  const target = sortEntries(matched.length > 0 ? matched : pdfEntries)[0];
  if (!target) {
    throw new Error('LibreOffice 未生成可用的 PDF。');
  }
  return target;
}

async function exportPdfWithPowerPointMac(binaryPath: string, pptPath: string, outputDir: string): Promise<string> {
  const scriptPath = path.join(outputDir, 'rs-powerpoint-export-pdf.applescript');
  const exportPdfPath = path.join(outputDir, 'slides.pdf');
  const script = [
    'on run argv',
    '  set sourcePath to item 1 of argv',
    '  set exportPdfPath to item 2 of argv',
    '  tell application "Microsoft PowerPoint"',
    '    activate',
    '    open POSIX file sourcePath',
    '    delay 1',
    '    set targetPresentation to active presentation',
    '    save targetPresentation in POSIX file exportPdfPath as save as PDF',
    '    delay 1',
    '    close targetPresentation saving no',
    '  end tell',
    'end run',
  ].join('\n');
  await fs.writeFile(scriptPath, script, 'utf8');
  await execFileAsync(binaryPath, [scriptPath, pptPath, exportPdfPath], {
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  });
  await waitForUsablePdf(exportPdfPath, 'powerpoint-mac');
  return exportPdfPath;
}

async function exportPdfWithPowerPointWindows(binaryPath: string, pptPath: string, outputDir: string): Promise<string> {
  const scriptPath = path.join(outputDir, 'rs-powerpoint-export-pdf.ps1');
  const exportPdfPath = path.join(outputDir, 'slides.pdf');
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$sourcePath = $args[0]',
    '$outputPath = $args[1]',
    'New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null',
    '$powerPoint = New-Object -ComObject PowerPoint.Application',
    '$powerPoint.Visible = -1',
    '$presentation = $powerPoint.Presentations.Open($sourcePath, $false, $false, $false)',
    'try {',
    '  $presentation.ExportAsFixedFormat($outputPath, 2)',
    '} finally {',
    '  if ($presentation) { $presentation.Close() }',
    '  if ($powerPoint) { $powerPoint.Quit() }',
    '}',
  ].join('\n');
  await fs.writeFile(scriptPath, script, 'utf8');
  await execFileAsync(binaryPath, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, pptPath, exportPdfPath], {
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  });
  await waitForUsablePdf(exportPdfPath, 'powerpoint-windows');
  return exportPdfPath;
}

export async function renderPptxSlidesToImages(
  pptPath: string,
  outputDir: string,
  opts?: { onStage?: RenderStageReporter },
): Promise<string[]> {
  const resolved = await resolveRendererBackends();
  if (resolved.length === 0) {
    throw buildMissingBackendError(resolved);
  }

  const expectedSlideCount = await getPptxSlideCount(pptPath);
  await fs.mkdir(outputDir, { recursive: true });
  const incompleteErrors: Error[] = [];
  const backendErrors: Error[] = [];

  for (const candidate of resolved) {
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
      await fs.mkdir(outputDir, { recursive: true });
      opts?.onStage?.(
        candidate.backend.id === 'powerpoint-mac' || candidate.backend.id === 'powerpoint-windows'
          ? `正在请求 ${getRendererLabel(candidate.backend.id)} 导出 PDF… 如系统弹出授权，请先处理`
          : `正在使用 ${getRendererLabel(candidate.backend.id)} 导出 PDF…`,
      );

      const pdfPath = candidate.backend.id === 'powerpoint-mac'
        ? await exportPdfWithPowerPointMac(candidate.binaryPath, pptPath, outputDir)
        : candidate.backend.id === 'powerpoint-windows'
          ? await exportPdfWithPowerPointWindows(candidate.binaryPath, pptPath, outputDir)
          : await exportPdfWithSoffice(candidate.binaryPath, pptPath, outputDir);

      const images = await rasterizePdfToImages(pdfPath, outputDir, opts?.onStage);
      if (expectedSlideCount && images.length > 0 && images.length < expectedSlideCount) {
        incompleteErrors.push(buildIncompleteRenderError(candidate.backend.id, images.length, expectedSlideCount));
        continue;
      }
      if (images.length > 0) {
        return sortEntries(images);
      }
    } catch (error) {
      backendErrors.push(error instanceof Error ? error : new Error(String(error)));
      continue;
    }
  }

  if (incompleteErrors.length > 0) {
    throw incompleteErrors[incompleteErrors.length - 1];
  }
  if (backendErrors.length > 0) {
    throw backendErrors[backendErrors.length - 1];
  }
  throw buildMissingBackendError(resolved);
}
