import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasFile } from '../../../src/core/canvas-model';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(helperDir, '../../fixtures/canvases');

export function loadCanvasFixture(name: string): CanvasFile {
  const filePath = path.join(fixturesDir, name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CanvasFile;
}
