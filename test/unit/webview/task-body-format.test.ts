import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../webview/src/bridge', () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(() => () => {}),
  saveState: vi.fn(),
  getState: vi.fn(() => null),
}));

vi.mock('../../../webview/src/stores/canvas-store', () => ({
  useCanvasStore: () => () => undefined,
}));

import { buildTaskMarkdown, buildTaskPreview } from '../../../webview/src/components/nodes/TaskBody';

describe('TaskBody formatting helpers', () => {
  it('marks completed tasks in preview and recalculates progress from next items', () => {
    const preview = buildTaskPreview([
      { id: 'a', label: 'done item', done: true },
      { id: 'b', label: 'todo item', done: false },
    ]);

    expect(preview).toContain('任务进度: 1/2 (50%)');
    expect(preview).toContain('[x] done item');
    expect(preview).toContain('[ ] todo item');
  });

  it('writes markdown checklist markers for completed tasks', () => {
    const markdown = buildTaskMarkdown('任务清单', [
      { id: 'a', label: 'finished', done: true },
      { id: 'b', label: 'pending', done: false },
    ]);

    expect(markdown).toContain('进度: 1/2');
    expect(markdown).toContain('- [x] finished');
    expect(markdown).toContain('- [ ] pending');
  });
});
