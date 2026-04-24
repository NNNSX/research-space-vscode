import type { ExplosionSourceFileType } from '../explosion/explosion-types';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const DOC_EXTENSIONS = new Set(['.doc', '.docx']);
const PPT_EXTENSIONS = new Set(['.ppt', '.pptx']);
const SHEET_EXTENSIONS = new Set(['.xls', '.xlt', '.xlsx', '.xlsm', '.xltx', '.xltm']);

export const MINERU_SUPPORTED_FILE_HINT = 'PDF / DOCX / PPTX / XLS / XLSX / 图片';

export function getExplosionSourceTypeFromPath(filePath?: string): ExplosionSourceFileType | null {
  if (!filePath) {
    return null;
  }
  const normalized = filePath.toLowerCase();
  const slashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  const basename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = basename.lastIndexOf('.');
  const ext = dotIndex >= 0 ? basename.slice(dotIndex) : '';
  if (ext === '.pdf') {
    return 'pdf';
  }
  if (DOC_EXTENSIONS.has(ext)) {
    return 'docx';
  }
  if (PPT_EXTENSIONS.has(ext)) {
    return 'pptx';
  }
  if (SHEET_EXTENSIONS.has(ext)) {
    return 'xlsx';
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }
  return null;
}

export function isMinerUSupportedFilePath(filePath?: string): boolean {
  return getExplosionSourceTypeFromPath(filePath) !== null;
}

export function requiresMinerUTokenForSourceType(sourceType: ExplosionSourceFileType | null | undefined): boolean {
  return !!sourceType;
}
