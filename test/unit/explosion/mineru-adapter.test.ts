import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as yazl from 'yazl';

const { getConfiguration } = vi.hoisted(() => ({
  getConfiguration: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration,
  },
}));

function createConfiguration(values: Record<string, unknown>) {
  return {
    get<T>(key: string, defaultValue?: T) {
      return (key in values ? values[key] : defaultValue) as T;
    },
  };
}

async function createZipBuffer(files: Record<string, string>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(files)) {
    zip.addBuffer(Buffer.from(content, 'utf8'), name);
  }
  zip.end();

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    Readable.from(zip.outputStream)
      .on('data', chunk => chunks.push(Buffer.from(chunk)))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return Buffer.concat(chunks);
}

import {
  buildMinerUApiUrl,
  checkMinerUHealth,
  formatMinerUErrorForDisplay,
  getMinerUConfig,
  isMinerUTaskCompletedState,
  MinerUError,
  parseDocumentViaMinerU,
  parsePdfViaMinerU,
} from '../../../src/explosion/mineru-adapter';

describe('MinerU adapter', () => {
  const tempRoot = path.join('/tmp', `rs-mineru-adapter-${Date.now()}`);
  const tempPdfPath = path.join(tempRoot, 'paper.pdf');
  const tempDocxPath = path.join(tempRoot, 'paper.docx');

  beforeEach(() => {
    getConfiguration.mockReturnValue(createConfiguration({
      'mineru.apiMode': 'precise',
      'mineru.apiBaseUrl': 'https://mineru.net',
      'mineru.apiToken': 'token-123',
      'mineru.modelVersion': 'pipeline',
      'mineru.pollIntervalMs': 2500,
      'mineru.pollTimeoutMs': 300000,
      'mineru.mode': 'auto',
      'mineru.apiUrl': 'http://localhost:8000',
      maxUnits: 120,
      attachOriginalFileNode: true,
      consumeAsGroup: true,
      outputDir: '.research-space/explosions',
    }));
  });

  beforeEach(async () => {
    await fs.mkdir(tempRoot, { recursive: true });
    await fs.writeFile(tempPdfPath, '%PDF-1.4\n');
    await fs.writeFile(tempDocxPath, 'fake-docx');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('normalizes api urls without duplicate slashes', () => {
    expect(buildMinerUApiUrl('http://localhost:8000/', '/file_parse')).toBe('http://localhost:8000/file_parse');
    expect(buildMinerUApiUrl('http://localhost:8000', 'health')).toBe('http://localhost:8000/health');
  });

  it('reads MinerU settings from researchSpace.explosion', () => {
    expect(getMinerUConfig()).toEqual({
      provider: 'mineru',
      apiMode: 'precise',
      apiBaseUrl: 'https://mineru.net',
      apiToken: 'token-123',
      modelVersion: 'pipeline',
      pollIntervalMs: 2500,
      pollTimeoutMs: 300000,
      localMode: 'auto',
      localApiUrl: 'http://localhost:8000',
      maxUnits: 120,
      attachOriginalFileNode: true,
      consumeAsGroup: true,
      outputDir: '.research-space/explosions',
    });
  });

  it('treats /docs as a healthy fallback when /health is unavailable', async () => {
    getConfiguration.mockReturnValue(createConfiguration({
      'mineru.apiMode': 'local',
      'mineru.apiUrl': 'http://localhost:8000',
    }));
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('<html>docs</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkMinerUHealth('http://localhost:8000')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:8000/health', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:8000/docs', expect.any(Object));
  });

  it('parses successful local path-mode responses and extracts manifest hints', async () => {
    getConfiguration.mockReturnValue(createConfiguration({
      'mineru.apiMode': 'local',
      'mineru.mode': 'path',
      'mineru.apiUrl': 'http://localhost:8000',
      maxUnits: 120,
      attachOriginalFileNode: true,
      consumeAsGroup: true,
      outputDir: '.research-space/explosions',
    }));

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_dir: '/tmp/mineru/job-1',
      content_list_v2_path: '/tmp/mineru/job-1/content_list_v2.json',
      markdown_path: '/tmp/mineru/job-1/result.md',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(parsePdfViaMinerU('/tmp/paper.pdf', '/tmp/workspace')).resolves.toEqual({
      requestMode: 'path',
      endpoint: 'http://localhost:8000/file_parse',
      outputDir: '/tmp/mineru/job-1',
      manifestPath: '/tmp/mineru/job-1/content_list_v2.json',
      markdownPath: '/tmp/mineru/job-1/result.md',
      raw: {
        output_dir: '/tmp/mineru/job-1',
        content_list_v2_path: '/tmp/mineru/job-1/content_list_v2.json',
        markdown_path: '/tmp/mineru/job-1/result.md',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/file_parse',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: '/tmp/paper.pdf' }),
      }),
    );
  });

  it('surfaces concise API errors from JSON bodies', async () => {
    getConfiguration.mockReturnValue(createConfiguration({
      'mineru.apiMode': 'local',
      'mineru.mode': 'path',
      'mineru.apiUrl': 'http://localhost:8000',
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: 'unsupported file',
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    })));

    const error = await parsePdfViaMinerU('/tmp/paper.pdf', '/tmp/workspace').catch(value => value);
    expect(error).toBeInstanceOf(MinerUError);
    expect((error as MinerUError).code).toBe('api_error');
    expect((error as MinerUError).message).toBe('本地 MinerU 服务调用失败。 unsupported file');
  });

  it('requires a token when using the online precise API', async () => {
    getConfiguration.mockReturnValue(createConfiguration({
      'mineru.apiMode': 'precise',
      'mineru.apiBaseUrl': 'https://mineru.net',
      'mineru.apiToken': '',
    }));

    const error = await parsePdfViaMinerU('/tmp/paper.pdf', '/tmp/workspace').catch(value => value);
    expect(error).toBeInstanceOf(MinerUError);
    expect((error as MinerUError).code).toBe('config_missing_token');
    expect(formatMinerUErrorForDisplay(error))
      .toBe('未配置 MinerU 在线 API Token。请先在设置中填写 researchSpace.explosion.mineru.apiToken。');
  });

  it('classifies online auth failures and exposes a readable display message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: 'invalid token',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })));

    const error = await parsePdfViaMinerU(tempPdfPath, '/tmp/workspace').catch(value => value);
    expect(error).toBeInstanceOf(MinerUError);
    expect((error as MinerUError).code).toBe('api_auth_failed');
    expect(formatMinerUErrorForDisplay(error))
      .toContain('MinerU 在线 API 鉴权失败');
  });

  it('formats task timeout errors with timeout setting guidance', () => {
    const error = new MinerUError('task_timeout', 'MinerU 在线解析任务超时。');
    expect(formatMinerUErrorForDisplay(error))
      .toContain('researchSpace.explosion.mineru.pollTimeoutMs');
  });

  it('treats multiple completed task states as successful terminal states', () => {
    expect(isMinerUTaskCompletedState('done')).toBe(true);
    expect(isMinerUTaskCompletedState('completed')).toBe(true);
    expect(isMinerUTaskCompletedState('success')).toBe(true);
    expect(isMinerUTaskCompletedState('running')).toBe(false);
    expect(isMinerUTaskCompletedState(undefined)).toBe(false);
  });

  it('accepts a batch poll result once full_zip_url is available even if state is still running', async () => {
    const zipBuffer = await createZipBuffer({
      'result/content_list.json': JSON.stringify({ content_list: [] }),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          batch_id: 'batch-1',
          file_urls: ['https://upload.example.com/file.pdf'],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          extract_result: [
            {
              file_name: 'paper.pdf',
              state: 'running',
              full_zip_url: 'https://download.example.com/result.zip',
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(zipBuffer, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await parsePdfViaMinerU(tempPdfPath, tempRoot);
    expect(result.requestMode).toBe('precise-batch-upload');
    expect(result.manifestPath).toContain('content_list.json');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('routes remote pdf urls to the precise task endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {},
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await parsePdfViaMinerU('https://example.com/papers/demo.pdf', '/tmp/workspace').catch(value => value);
    expect(error).toBeInstanceOf(MinerUError);
    expect((error as MinerUError).code).toBe('api_error');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mineru.net/api/v4/extract/task',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('accepts docx files on the shared MinerU document parse entry', async () => {
    getConfiguration.mockReturnValue(createConfiguration({
      'mineru.apiMode': 'local',
      'mineru.mode': 'path',
      'mineru.apiUrl': 'http://localhost:8000',
      maxUnits: 120,
      attachOriginalFileNode: true,
      consumeAsGroup: true,
      outputDir: '.research-space/explosions',
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_dir: '/tmp/mineru/job-docx',
      content_list_v2_path: '/tmp/mineru/job-docx/content_list_v2.json',
      markdown_path: '/tmp/mineru/job-docx/result.md',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(parseDocumentViaMinerU(tempDocxPath, '/tmp/workspace')).resolves.toEqual({
      requestMode: 'path',
      endpoint: 'http://localhost:8000/file_parse',
      outputDir: '/tmp/mineru/job-docx',
      manifestPath: '/tmp/mineru/job-docx/content_list_v2.json',
      markdownPath: '/tmp/mineru/job-docx/result.md',
      raw: {
        output_dir: '/tmp/mineru/job-docx',
        content_list_v2_path: '/tmp/mineru/job-docx/content_list_v2.json',
        markdown_path: '/tmp/mineru/job-docx/result.md',
      },
    });
  });
});
