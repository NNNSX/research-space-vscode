import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import * as vscode from 'vscode';
import type { ConversionDiagnosticItem, ConversionDiagnosticsReport, ConversionDiagnosticStatus } from '../core/canvas-model';

const execFileAsync = promisify(execFile);
const runtimeRequire = createRequire(__filename);

type CheckResult = Omit<ConversionDiagnosticItem, 'id' | 'title'>;

function item(
  id: string,
  title: string,
  result: CheckResult,
): ConversionDiagnosticItem {
  return { id, title, ...result };
}

function ok(summary: string, detail?: string): CheckResult {
  return { status: 'ok', summary, detail };
}

function warn(summary: string, detail?: string): CheckResult {
  return { status: 'warning', summary, detail };
}

function error(summary: string, detail?: string): CheckResult {
  return { status: 'error', summary, detail };
}

function unknown(summary: string, detail?: string): CheckResult {
  return { status: 'unknown', summary, detail };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function commandVersion(commands: string[], args: string[] = ['--version']): Promise<{ command: string; output: string } | null> {
  for (const command of commands) {
    try {
      const result = await execFileAsync(command, args, { timeout: 1800 });
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
      return { command, output };
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

async function checkMacApp(appName: string): Promise<boolean> {
  if (process.platform !== 'darwin') { return false; }
  return pathExists(`/Applications/${appName}.app`);
}

async function checkWindowsOffice(appNames: string[]): Promise<boolean> {
  if (process.platform !== 'win32') { return false; }
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean) as string[];
  for (const root of roots) {
    for (const appName of appNames) {
      const candidates = [
        `${root}\\Microsoft Office\\root\\Office16\\${appName}.EXE`,
        `${root}\\Microsoft Office\\Office16\\${appName}.EXE`,
      ];
      for (const candidate of candidates) {
        if (await pathExists(candidate)) { return true; }
      }
    }
  }
  return false;
}

async function checkWord(): Promise<ConversionDiagnosticItem> {
  if (process.platform === 'darwin') {
    const exists = await checkMacApp('Microsoft Word');
    return item(
      'word',
      'Word → PDF / PNG',
      exists
        ? ok('已检测到 Microsoft Word。', 'Word 文档会优先使用本机 Word 转 PDF，再转 PNG。')
        : warn('未检测到 Microsoft Word。', 'Word 转 PNG 会尝试回退 LibreOffice / soffice；若也缺失，则 Word 转换不可用。'),
    );
  }
  if (process.platform === 'win32') {
    const exists = await checkWindowsOffice(['WINWORD']);
    return item(
      'word',
      'Word → PDF / PNG',
      exists
        ? ok('已检测到 Microsoft Word。')
        : warn('未检测到 Microsoft Word。', 'Word 转 PNG 会尝试回退 LibreOffice / soffice。'),
    );
  }
  return item('word', 'Word → PDF / PNG', unknown('当前平台不检测 Microsoft Word。', 'Linux 等平台主要依赖 LibreOffice / soffice。'));
}

async function checkPowerPoint(): Promise<ConversionDiagnosticItem> {
  if (process.platform === 'darwin') {
    const exists = await checkMacApp('Microsoft PowerPoint');
    return item(
      'powerpoint',
      'PPT → PDF / PNG',
      exists
        ? ok('已检测到 Microsoft PowerPoint。', 'PPT 会优先使用 PowerPoint 导出 PDF，再逐页转 PNG。')
        : warn('未检测到 Microsoft PowerPoint。', 'PPT 转 PNG 会尝试回退 LibreOffice / soffice；若也缺失，则 PPT 转换不可用。'),
    );
  }
  if (process.platform === 'win32') {
    const exists = await checkWindowsOffice(['POWERPNT']);
    return item(
      'powerpoint',
      'PPT → PDF / PNG',
      exists
        ? ok('已检测到 Microsoft PowerPoint。')
        : warn('未检测到 Microsoft PowerPoint。', 'PPT 转 PNG 会尝试回退 LibreOffice / soffice。'),
    );
  }
  return item('powerpoint', 'PPT → PDF / PNG', unknown('当前平台不检测 Microsoft PowerPoint。', 'Linux 等平台主要依赖 LibreOffice / soffice。'));
}

async function checkLibreOffice(): Promise<ConversionDiagnosticItem> {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', 'soffice', 'libreoffice']
    : process.platform === 'win32'
      ? ['soffice', 'libreoffice']
      : ['soffice', 'libreoffice'];
  const found = await commandVersion(candidates);
  return item(
    'libreoffice',
    'LibreOffice / soffice fallback',
    found
      ? ok(`已检测到 ${found.command}。`, found.output || undefined)
      : warn('未检测到 LibreOffice / soffice。', '当本机 Word / PowerPoint 缺失或导出失败时，缺少 fallback 会导致 Word/PPT 转 PNG 不可用。'),
  );
}

async function checkPdfRenderer(): Promise<ConversionDiagnosticItem> {
  try {
    const canvas = runtimeRequire('@napi-rs/canvas');
    if (typeof canvas.createCanvas !== 'function') {
      return item('pdf-renderer', 'PDF → PNG 渲染 runtime', error('@napi-rs/canvas 已加载，但 createCanvas 不可用。'));
    }
    return item('pdf-renderer', 'PDF → PNG 渲染 runtime', ok('@napi-rs/canvas 可用。', 'PDF、PPT→PDF、Word→PDF 的逐页 PNG 渲染链可使用。'));
  } catch (e) {
    return item('pdf-renderer', 'PDF → PNG 渲染 runtime', error('PDF 渲染 runtime 不可用。', e instanceof Error ? e.message : String(e)));
  }
}

async function checkMinerULocal(url: string): Promise<ConversionDiagnosticItem> {
  const normalized = (url || 'http://localhost:8000').trim();
  if (!normalized) {
    return item('mineru-local', '本地 MinerU fallback', warn('未配置本地 MinerU URL。'));
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    try {
      const resp = await fetch(normalized, { method: 'GET', signal: controller.signal });
      return item(
        'mineru-local',
        '本地 MinerU fallback',
        resp.status < 500
          ? ok(`本地服务可连接：HTTP ${resp.status}`, normalized)
          : warn(`本地服务响应异常：HTTP ${resp.status}`, normalized),
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return item('mineru-local', '本地 MinerU fallback', warn('本地 MinerU 服务当前不可连接。', `${normalized} · ${e instanceof Error ? e.message : String(e)}`));
  }
}

function checkMinerUOnline(apiMode: string, baseUrl: string, token: string): ConversionDiagnosticItem {
  if (apiMode === 'local') {
    return item('mineru-online', 'MinerU 在线拆解配置', unknown('当前使用 local 模式，在线 Token 不参与本地 fallback。'));
  }
  const hasBaseUrl = !!baseUrl?.trim();
  const hasToken = !!token?.trim();
  if (hasBaseUrl && hasToken) {
    return item('mineru-online', 'MinerU 在线拆解配置', ok('已配置在线 Base URL 和 Token。', '不会在诊断结果中显示 Token 内容。'));
  }
  if (hasBaseUrl && !hasToken) {
    return item('mineru-online', 'MinerU 在线拆解配置', warn('已配置 Base URL，但缺少 Token。', '文字 + 图片拆解会在运行前提示配置 MinerU Token。'));
  }
  return item('mineru-online', 'MinerU 在线拆解配置', error('缺少 MinerU 在线 Base URL。'));
}

export async function runConversionDiagnostics(): Promise<ConversionDiagnosticsReport> {
  const explosion = vscode.workspace.getConfiguration('researchSpace.explosion');
  const mineruApiMode = explosion.get<'precise' | 'agent' | 'local'>('mineru.apiMode', 'precise');
  const mineruApiBaseUrl = explosion.get<string>('mineru.apiBaseUrl', 'https://mineru.net');
  const mineruApiToken = explosion.get<string>('mineru.apiToken', '');
  const mineruLocalApiUrl = explosion.get<string>('mineru.apiUrl', 'http://localhost:8000');

  const [word, powerpoint, libreOffice, pdfRenderer, mineruLocal] = await Promise.all([
    checkWord(),
    checkPowerPoint(),
    checkLibreOffice(),
    checkPdfRenderer(),
    checkMinerULocal(mineruLocalApiUrl),
  ]);

  const items = [
    word,
    powerpoint,
    libreOffice,
    pdfRenderer,
    checkMinerUOnline(mineruApiMode, mineruApiBaseUrl, mineruApiToken),
    mineruLocal,
    item(
      'spreadsheet',
      'XLS / XLSX 表格转换',
      ok('内置表格转换可用。', 'Markdown / TeX 转换不依赖 MinerU，也不依赖 Office。'),
    ),
  ];

  const summary: Record<ConversionDiagnosticStatus, number> = {
    ok: 0,
    warning: 0,
    error: 0,
    unknown: 0,
  };
  for (const result of items) {
    summary[result.status] += 1;
  }

  return {
    checkedAt: Date.now(),
    platform: process.platform,
    items,
    summary,
  };
}
