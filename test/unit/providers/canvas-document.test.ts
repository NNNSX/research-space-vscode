import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  class MockDisposable {
    dispose() {}
  }

  class MockEventEmitter<T> {
    listeners = new Set<(value: T) => void>();
    event = (listener: (value: T) => void) => {
      this.listeners.add(listener);
      return new MockDisposable();
    };
    fire(value: T) {
      for (const listener of this.listeners) {
        listener(value);
      }
    }
    dispose() {
      this.listeners.clear();
    }
  }

  return {
    EventEmitter: MockEventEmitter,
    Disposable: MockDisposable,
  };
});

import { CanvasDocument } from '../../../src/providers/CanvasEditorProvider';
import type { CanvasFile } from '../../../src/core/canvas-model';

function createCanvas(title: string): CanvasFile {
  return {
    version: '1.0',
    nodes: [
      {
        id: 'node-1',
        node_type: 'note',
        title,
        position: { x: 0, y: 0 },
        size: { width: 280, height: 160 },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      title,
      created_at: '2026-04-21T00:00:00.000Z',
      updated_at: '2026-04-21T00:00:00.000Z',
    },
  };
}

describe('CanvasDocument undo/redo contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks applyEdit snapshots and supports undo/redo without throwing', () => {
    const original = createCanvas('原始画布');
    const edited = createCanvas('编辑后画布');
    const secondEdit = createCanvas('第二次编辑');
    const doc = new CanvasDocument({ fsPath: '/tmp/test.rsws' } as any, original);
    const changeSpy = vi.fn();

    doc.onDidChange(changeSpy);

    doc.applyEdit(edited);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(doc.data.metadata.title).toBe('编辑后画布');

    doc.undo();
    expect(doc.data.metadata.title).toBe('原始画布');

    doc.redo();
    expect(doc.data.metadata.title).toBe('编辑后画布');

    doc.applyEdit(secondEdit);
    expect(doc.data.metadata.title).toBe('第二次编辑');

    doc.undo();
    expect(doc.data.metadata.title).toBe('编辑后画布');

    doc.redo();
    expect(doc.data.metadata.title).toBe('第二次编辑');
  });
});
