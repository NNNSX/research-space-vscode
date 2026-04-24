import { describe, expect, it } from 'vitest';
import {
  getExplosionSourceTypeFromPath,
  requiresMinerUTokenForSourceType,
} from '../../../src/core/explosion-file-types';

describe('explosion-file-types', () => {
  it('recognizes spreadsheet files as local xlsx explosion sources', () => {
    expect(getExplosionSourceTypeFromPath('数据.xlsx')).toBe('xlsx');
    expect(getExplosionSourceTypeFromPath('/tmp/report.xls')).toBe('xlsx');
    expect(requiresMinerUTokenForSourceType('xlsx')).toBe(false);
  });

  it('still requires MinerU token for MinerU-backed document sources', () => {
    expect(requiresMinerUTokenForSourceType('pdf')).toBe(true);
    expect(requiresMinerUTokenForSourceType('docx')).toBe(true);
    expect(requiresMinerUTokenForSourceType('pptx')).toBe(true);
    expect(requiresMinerUTokenForSourceType('image')).toBe(true);
  });
});
