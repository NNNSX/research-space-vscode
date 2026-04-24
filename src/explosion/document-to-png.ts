import * as path from 'path';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import type { CanvasNode } from '../core/canvas-model';
import { DEFAULT_SIZES } from '../core/canvas-model';
import { toRelPath } from '../core/storage';
import { getPdfPageCount } from '../core/content-extractor';
import { getMinerUConfig } from './mineru-adapter';
import { renderPdfPagesToPngImages, renderPptxSlidesToImages } from './pptx-slide-renderer';
import { getExplosionSourceTypeFromPath } from '../core/explosion-file-types';
import type { ExplosionSourceFileType } from './explosion-types';

type ProgressReporter = (message: string) => void;
type OfficePdfBackend = 'word-mac' | 'word-windows' | 'soffice';

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
  return sanitized || 'untitled';
}

function buildOutputDir(sourceAbsPath: string, canvasUri: vscode.Uri, mode: string): string {
  const sourceBase = sanitizePathSegment(path.basename(sourceAbsPath, path.extname(sourceAbsPath)));
  const session = `${new Date().toISOString().replace(/[:.]/g, '-')}-${uuid().slice(0, 8)}`;
  return path.resolve(path.dirname(canvasUri.fsPath), getMinerUConfig().outputDir, sourceBase, `${mode}-${session}`);
}

function getSourceTypeLabel(sourceType: ExplosionSourceFileType): string {
  if (sourceType === 'pdf') { return 'PDF'; }
  if (sourceType === 'pptx') { return 'PPT'; }
  if (sourceType === 'docx') { return 'Word'; }
  return '文件';
}

function getUnitType(sourceType: ExplosionSourceFileType): 'page' | 'slide' | 'section' {
  if (sourceType === 'pptx') { return 'slide'; }
  if (sourceType === 'docx') { return 'section'; }
  return 'page';
}

async function materializeRelationIndex(
  sourceNode: CanvasNode,
  imagePaths: string[],
  outputDir: string,
  sourceType: ExplosionSourceFileType,
): Promise<{ title: string; filePath: string; content: string }> {
  const sourceLabel = getSourceTypeLabel(sourceType);
  const unitLabel = sourceType === 'pptx'
    ? '幻灯片'
    : sourceType === 'docx'
      ? '页'
      : '页';
  const lines = [
    `# ${sourceLabel} 图片关系索引`,
    '',
    `来源文件：${sourceNode.title || sourceLabel}`,
    `图片数量：${imagePaths.length}`,
    '',
    `| 顺序 | 资源文件名 | 节点标题 | ${unitLabel} |`,
    '| --- | --- | --- | --- |',
  ];

  for (const [index, imagePath] of imagePaths.entries()) {
    const unitIndex = index + 1;
    const title = sourceType === 'pptx'
      ? `第 ${unitIndex} 张幻灯片图片`
      : `第 ${unitIndex} 页图片`;
    const position = sourceType === 'pptx'
      ? `第 ${unitIndex} 张幻灯片`
      : `第 ${unitIndex} 页`;
    lines.push(`| ${unitIndex} | ${path.basename(imagePath)} | ${title} | ${position} |`);
  }

  lines.push(
    '',
    '> 说明：当该节点组被连接到 AI 节点时，模型会同时拿到这份关系索引、图片节点标题，以及图片本体。',
  );

  const content = lines.join('\n');
  const filePath = path.join(outputDir, '0000-page-image-relations.md');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return {
    title: `${sourceLabel} 图片关系索引`,
    filePath,
    content,
  };
}

function execFileAsync(binaryPath: string, args: string[], timeout = 180000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function waitForUsablePdf(pdfPath: string, backend: OfficePdfBackend): Promise<void> {
  try {
    const stat = await fs.stat(pdfPath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error('PDF 文件为空。');
    }
    const header = await fs.readFile(pdfPath, { encoding: null });
    if (!header.subarray(0, 5).toString('utf8').startsWith('%PDF-')) {
      throw new Error('文件头不是有效 PDF。');
    }
  } catch (error) {
    const label = backend === 'word-mac'
      ? 'Microsoft Word (macOS)'
      : backend === 'word-windows'
        ? 'Microsoft Word (Windows)'
        : 'LibreOffice / soffice';
    throw new Error(`${label} 已被调用，但没有成功写出可用的 PDF：${pdfPath}。${error instanceof Error ? error.message : String(error)}`);
  }
}

async function canExecute(binaryPath: string, probeArgs: string[]): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, probeArgs, 5000);
    return true;
  } catch {
    return false;
  }
}

async function resolveSofficeBinary(): Promise<string> {
  const candidates = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/Applications/OpenOffice.app/Contents/MacOS/soffice',
    '/opt/homebrew/bin/soffice',
    '/usr/local/bin/soffice',
    'soffice',
    'libreoffice',
  ];
  for (const candidate of candidates) {
    if (await canExecute(candidate, ['--version'])) {
      return candidate;
    }
  }
  throw new Error('当前环境缺少 DOC / Word 转 PDF 所需的 LibreOffice / soffice。请安装 LibreOffice 后重试。');
}

async function resolveWordMacBinary(): Promise<string> {
  const candidates = ['/usr/bin/osascript', 'osascript'];
  for (const candidate of candidates) {
    if (await canExecute(candidate, ['-e', 'id of application "Microsoft Word"'])) {
      return candidate;
    }
  }
  throw new Error('当前 macOS 环境未检测到可用的 Microsoft Word。');
}

async function resolveWordWindowsBinary(): Promise<string> {
  const candidates = ['powershell.exe', 'pwsh.exe', 'pwsh', 'powershell'];
  for (const candidate of candidates) {
    if (await canExecute(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'])) {
      return candidate;
    }
  }
  throw new Error('当前 Windows 环境未检测到可用的 PowerShell，无法调用 Microsoft Word。');
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

async function exportOfficeDocumentToPdfWithSoffice(sourceAbsPath: string, outputDir: string): Promise<string> {
  const binaryPath = await resolveSofficeBinary();
  await fs.mkdir(outputDir, { recursive: true });
  await execFileAsync(binaryPath, [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDir,
    sourceAbsPath,
  ]);

  const basename = path.basename(sourceAbsPath, path.extname(sourceAbsPath)).toLowerCase();
  const entries = await collectFilesRecursive(outputDir);
  const pdfEntries = entries.filter(entry => entry.toLowerCase().endsWith('.pdf'));
  const matched = pdfEntries.filter(entry => path.basename(entry, '.pdf').toLowerCase() === basename);
  const target = (matched.length > 0 ? matched : pdfEntries)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  if (!target) {
    throw new Error('LibreOffice 已被调用，但没有生成可用的 PDF。');
  }
  await waitForUsablePdf(target, 'soffice');
  return target;
}

async function exportOfficeDocumentToPdfWithWordMac(sourceAbsPath: string, outputDir: string): Promise<string> {
  const binaryPath = await resolveWordMacBinary();
  await fs.mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, 'rs-word-export-pdf.applescript');
  const exportPdfPath = path.join(outputDir, 'word.pdf');
  const script = [
    'on run argv',
    '  set sourcePath to item 1 of argv',
    '  set exportPdfPath to item 2 of argv',
    '  tell application "Microsoft Word"',
    '    activate',
    '    open POSIX file sourcePath',
    '    delay 1',
    '    set targetDocument to active document',
    '    save as targetDocument file name exportPdfPath file format format PDF',
    '    delay 1',
    '    close targetDocument saving no',
    '  end tell',
    'end run',
  ].join('\n');
  await fs.writeFile(scriptPath, script, 'utf8');
  await execFileAsync(binaryPath, [scriptPath, sourceAbsPath, exportPdfPath], 180000);
  await waitForUsablePdf(exportPdfPath, 'word-mac');
  return exportPdfPath;
}

async function exportOfficeDocumentToPdfWithWordWindows(sourceAbsPath: string, outputDir: string): Promise<string> {
  const binaryPath = await resolveWordWindowsBinary();
  await fs.mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, 'rs-word-export-pdf.ps1');
  const exportPdfPath = path.join(outputDir, 'word.pdf');
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$sourcePath = $args[0]',
    '$outputPath = $args[1]',
    'New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null',
    '$word = New-Object -ComObject Word.Application',
    '$word.Visible = $false',
    '$document = $null',
    'try {',
    '  $document = $word.Documents.Open($sourcePath, $false, $true)',
    '  $document.ExportAsFixedFormat($outputPath, 17)',
    '} finally {',
    '  if ($document) { $document.Close($false) }',
    '  if ($word) { $word.Quit() }',
    '}',
  ].join('\n');
  await fs.writeFile(scriptPath, script, 'utf8');
  await execFileAsync(binaryPath, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, sourceAbsPath, exportPdfPath], 180000);
  await waitForUsablePdf(exportPdfPath, 'word-windows');
  return exportPdfPath;
}

async function exportOfficeDocumentToPdf(sourceAbsPath: string, outputDir: string, opts?: { onProgress?: ProgressReporter }): Promise<string> {
  const errors: Error[] = [];
  if (process.platform === 'darwin') {
    try {
      opts?.onProgress?.('正在使用 Microsoft Word 导出 PDF… 如系统弹出授权，请先处理');
      return await exportOfficeDocumentToPdfWithWordMac(sourceAbsPath, path.join(outputDir, 'word'));
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  } else if (process.platform === 'win32') {
    try {
      opts?.onProgress?.('正在使用 Microsoft Word 导出 PDF…');
      return await exportOfficeDocumentToPdfWithWordWindows(sourceAbsPath, path.join(outputDir, 'word'));
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  try {
    opts?.onProgress?.('正在使用 LibreOffice / soffice 导出 PDF…');
    return await exportOfficeDocumentToPdfWithSoffice(sourceAbsPath, path.join(outputDir, 'soffice'));
  } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  }

  const detail = errors.map(error => error.message).filter(Boolean).join('；');
  throw new Error(`Word 转 PDF 失败。已尝试 Microsoft Word（当前平台可用时）和 LibreOffice / soffice。${detail ? `详情：${detail}` : ''}`);
}

async function renderSourceToPngImages(
  absPath: string,
  outputDir: string,
  sourceType: ExplosionSourceFileType,
  opts?: { onProgress?: ProgressReporter },
): Promise<string[]> {
  if (sourceType === 'pdf') {
    opts?.onProgress?.('正在读取 PDF 页数…');
    const pageCount = await getPdfPageCount(vscode.Uri.file(absPath));
    opts?.onProgress?.(typeof pageCount === 'number' ? `正在转换 PDF… 共 ${pageCount} 页` : '正在转换 PDF…');
    return renderPdfPagesToPngImages(absPath, outputDir, {
      filenamePrefix: 'page',
      onStage: message => opts?.onProgress?.(message),
    });
  }

  if (sourceType === 'pptx') {
    opts?.onProgress?.('正在将 PPT 导出为 PDF 并转换 PNG… 如系统弹出授权，请先处理');
    return renderPptxSlidesToImages(absPath, outputDir, {
      onStage: message => opts?.onProgress?.(message),
    });
  }

  if (sourceType === 'docx') {
    opts?.onProgress?.('正在将 Word 文档导出为 PDF…');
    const pdfPath = await exportOfficeDocumentToPdf(absPath, path.join(outputDir, '_pdf'), opts);
    opts?.onProgress?.('正在将 Word PDF 逐页转换为 PNG…');
    return renderPdfPagesToPngImages(pdfPath, outputDir, {
      filenamePrefix: 'page',
      onStage: message => opts?.onProgress?.(message),
    });
  }

  throw new Error('当前输入类型不支持转 PNG。');
}

export async function convertDocumentNodeToPngGroup(
  sourceNode: CanvasNode,
  canvasUri: vscode.Uri,
  opts?: { onProgress?: ProgressReporter },
): Promise<{
  sourceNodeId: string;
  groupName: string;
  nodes: CanvasNode[];
  warnings: string[];
}> {
  if (!sourceNode.file_path) {
    throw new Error('当前文件节点缺少文件路径，无法转换。');
  }

  const absPath = path.isAbsolute(sourceNode.file_path)
    ? sourceNode.file_path
    : path.resolve(path.dirname(canvasUri.fsPath), sourceNode.file_path);
  const sourceType = getExplosionSourceTypeFromPath(absPath);
  if (!sourceType || !['pdf', 'pptx', 'docx'].includes(sourceType)) {
    throw new Error('当前文件转换为 PNG 仅支持 PDF / Word / PPT 文件节点。');
  }

  const outputDir = buildOutputDir(absPath, canvasUri, 'png-pages');
  const imagePaths = await renderSourceToPngImages(absPath, outputDir, sourceType, opts);
  if (imagePaths.length === 0) {
    throw new Error('文件转 PNG 未生成任何图片。');
  }

  const sessionId = uuid();
  const sourceLabel = getSourceTypeLabel(sourceType);
  const unitType = getUnitType(sourceType);
  const relationIndex = await materializeRelationIndex(sourceNode, imagePaths, outputDir, sourceType);
  const nodes: CanvasNode[] = [
    {
      id: uuid(),
      node_type: 'note',
      title: relationIndex.title,
      position: { x: 0, y: 0 },
      size: { ...DEFAULT_SIZES.note },
      file_path: toRelPath(relationIndex.filePath, canvasUri),
      meta: {
        content_preview: relationIndex.content,
        card_content_mode: 'preview',
        explode_session_id: sessionId,
        explode_provider: 'mineru',
        explode_source_file_path: sourceNode.file_path,
        explode_source_node_id: sourceNode.id,
        explode_status: 'ready',
        explode_source_type: sourceType,
        exploded_from_node_id: sourceNode.id,
        explode_unit_type: 'section',
        explode_kind: 'text',
        explode_order: -1,
      },
    },
    ...imagePaths.map((imagePath, index): CanvasNode => {
      const unitIndex = index + 1;
      const title = sourceType === 'pptx'
        ? `第 ${unitIndex} 张幻灯片图片`
        : `第 ${unitIndex} 页图片`;
      const positionLabel = sourceType === 'pptx'
        ? `第 ${unitIndex} 张幻灯片`
        : `第 ${unitIndex} 页`;
      return {
        id: uuid(),
        node_type: 'image',
        title,
        position: { x: 0, y: 0 },
        size: { ...DEFAULT_SIZES.image },
        file_path: toRelPath(imagePath, canvasUri),
        meta: {
          display_mode: 'file',
          content_preview: [
            title,
            `来源文件：${sourceNode.title || path.basename(absPath)}`,
            `位置：${positionLabel}`,
            `资源文件名：${path.basename(imagePath)}`,
          ].join('\n'),
          explode_session_id: sessionId,
          explode_provider: 'mineru',
          explode_source_file_path: sourceNode.file_path,
          explode_source_node_id: sourceNode.id,
          explode_status: 'ready',
          explode_source_type: sourceType,
          exploded_from_node_id: sourceNode.id,
          explode_unit_type: unitType,
          explode_unit_index: unitIndex,
          explode_kind: 'image',
          explode_order: index,
        },
      };
    }),
  ];

  return {
    sourceNodeId: sourceNode.id,
    groupName: `${sourceNode.title || sourceLabel} · PNG 转换组`,
    nodes,
    warnings: [],
  };
}
