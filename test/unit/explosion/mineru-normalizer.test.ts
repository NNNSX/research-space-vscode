import { describe, expect, it } from 'vitest';
import { normalizeMinerUManifest } from '../../../src/explosion/mineru-normalizer';

describe('normalizeMinerUManifest', () => {
  it('aggregates text blocks by page and keeps page images as separate units', () => {
    const result = normalizeMinerUManifest({
      content_list_v2: [
        {
          id: 't-1',
          type: 'title',
          page_idx: 0,
          text: 'Introduction',
        },
        {
          id: 't-1b',
          type: 'paragraph',
          page_idx: 0,
          text: 'First page paragraph',
        },
        {
          id: 'i-1',
          type: 'image',
          page_idx: 1,
          image_path: 'images/page-2-figure-1.png',
          caption: 'Figure 1',
        },
        {
          id: 't-2',
          type: 'paragraph',
          page_idx: 1,
          text: 'Second page paragraph',
        },
      ],
    }, {
      manifestPath: '/tmp/mineru/job-1/content_list_v2.json',
      outputDir: '/tmp/mineru/job-1',
      maxUnits: 10,
      sourceType: 'pdf',
    });

    expect(result.status).toBe('success');
    expect(result.units).toEqual([
      {
        id: 't-1',
        kind: 'text',
        order: 0,
        title: '第 1 页文本',
        page: 1,
        text: 'Introduction\n\nFirst page paragraph',
        sourceType: 'page_text',
      },
      {
        id: 't-2',
        kind: 'text',
        order: 1,
        title: '第 2 页文本',
        page: 2,
        text: 'Second page paragraph',
        sourceType: 'page_text',
      },
      {
        id: 'i-1',
        kind: 'image',
        order: 2,
        title: '第 2 页图片 1',
        page: 2,
        imagePath: '/tmp/mineru/job-1/images/page-2-figure-1.png',
        caption: 'Figure 1',
        sourceType: 'image',
      },
    ]);
    expect(result.nodeDrafts).toEqual([
      {
        id: 't-1',
        nodeType: 'note',
        title: '第 1 页文本',
        order: 0,
        page: 1,
        text: 'Introduction\n\nFirst page paragraph',
      },
      {
        id: 't-2',
        nodeType: 'note',
        title: '第 2 页文本',
        order: 1,
        page: 2,
        text: 'Second page paragraph',
      },
      {
        id: 'i-1',
        nodeType: 'image',
        title: '第 2 页图片 1',
        order: 2,
        page: 2,
        filePath: '/tmp/mineru/job-1/images/page-2-figure-1.png',
        mimeType: undefined,
      },
    ]);
  });

  it('truncates emitted page units when maxUnits is configured', () => {
    const result = normalizeMinerUManifest({
      content_list: [
        { type: 'paragraph', page: 1, text: 'A' },
        { type: 'paragraph', page: 2, text: 'B' },
      ],
    }, { maxUnits: 1 });

    expect(result.units).toHaveLength(1);
    expect(result.units[0]).toMatchObject({
      title: '第 1 页文本',
      text: 'A',
    });
    expect(result.warnings).toContain('MinerU result truncated to 1 units by configuration.');
  });

  it('returns failed when manifest has no usable blocks', () => {
    const result = normalizeMinerUManifest({ content_list: [{ type: 'image' }] });

    expect(result.status).toBe('failed');
    expect(result.warnings).toContain('MinerU manifest produced no usable text/image units.');
  });

  it('emits pptx units in image-first slide order with slide-specific titles', () => {
    const result = normalizeMinerUManifest({
      content_list_v2: [
        {
          id: 't-1',
          type: 'title',
          page_idx: 0,
          text: 'Slide title',
        },
        {
          id: 'i-1',
          type: 'image',
          page_idx: 0,
          image_path: 'images/slide-1-preview.png',
          caption: 'Preview',
        },
      ],
    }, {
      manifestPath: '/tmp/mineru/job-ppt/content_list_v2.json',
      outputDir: '/tmp/mineru/job-ppt',
      sourceType: 'pptx',
    });

    expect(result.units).toEqual([
      {
        id: 'i-1',
        kind: 'image',
        order: 0,
        title: '第 1 张幻灯片图片 1',
        page: 1,
        imagePath: '/tmp/mineru/job-ppt/images/slide-1-preview.png',
        caption: 'Preview',
        sourceType: 'image',
      },
      {
        id: 't-1',
        kind: 'text',
        order: 1,
        title: '第 1 张幻灯片文本',
        page: 1,
        text: 'Slide title',
        sourceType: 'slide_text',
      },
    ]);
  });
});
