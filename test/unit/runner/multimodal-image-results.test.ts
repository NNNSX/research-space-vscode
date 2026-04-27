import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { extractPredictionImageCandidates } from '../../../src/ai/multimodal/image-results';

describe('multimodal image result extraction', () => {
  it('extracts image candidates from AIHubMix prediction payload variants', () => {
    expect(extractPredictionImageCandidates({ output: ['https://example.com/a.png'] })).toEqual([
      { url: 'https://example.com/a.png' },
    ]);
    expect(extractPredictionImageCandidates({ data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/webp' }] })).toEqual([
      { dataUrl: 'data:image/webp;base64,aGVsbG8=', mimeType: 'image/webp' },
    ]);
    expect(extractPredictionImageCandidates({ output: { images: [{ url: 'https://example.com/b.png' }] } })).toEqual([
      { url: 'https://example.com/b.png' },
    ]);
  });

  it('ignores unsupported prediction entries', () => {
    expect(extractPredictionImageCandidates({ output: [{ text: 'not an image' }, null, 42] })).toEqual([]);
  });
});
