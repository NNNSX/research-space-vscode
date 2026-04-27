import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../src/core/canvas-model';
import { buildNextStepSuggestions } from '../../../webview/src/utils/next-step-suggestions';

function node(patch: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'node_type'>): CanvasNode {
  return {
    title: patch.id,
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    ...patch,
  };
}

const ALL_SUGGESTION_TOOLS = new Set([
  'summarize',
  'polish',
  'review',
  'literature-review',
  'stt',
  'meeting-transcribe',
  'image-edit',
  'image-to-video',
  'explode-document',
  'action-items',
]);

function toolIdsFor(nodes: CanvasNode[]): string[] {
  return buildNextStepSuggestions(nodes, { availableToolIds: ALL_SUGGESTION_TOOLS, limit: 5 })
    .map(suggestion => suggestion.toolId ?? '');
}

describe('next step suggestions', () => {
  it('suggests transcription tools for audio nodes', () => {
    expect(toolIdsFor([
      node({ id: 'audio-1', node_type: 'audio', file_path: 'audio/interview.mp3' }),
    ])).toEqual(['stt', 'meeting-transcribe']);
  });

  it('suggests image edit, image-to-video and image description for image nodes', () => {
    expect(toolIdsFor([
      node({ id: 'image-1', node_type: 'image', file_path: 'figures/diagram.png' }),
    ])).toEqual(['image-edit', 'image-to-video', 'summarize']);
  });

  it('prioritizes continuing work from a single AI output', () => {
    expect(toolIdsFor([
      node({ id: 'out-1', node_type: 'ai_output', file_path: 'outputs/draft.md' }),
    ])).toEqual(['polish', 'review', 'summarize']);
  });

  it('suggests synthesis tools for multiple text-like materials', () => {
    expect(toolIdsFor([
      node({ id: 'paper-1', node_type: 'paper', file_path: 'papers/a.pdf' }),
      node({ id: 'note-1', node_type: 'note', file_path: 'notes/b.md' }),
    ])).toEqual(['summarize', 'literature-review', 'review', 'explode-document']);
  });

  it('does not suggest automatic tools for function-only selection', () => {
    expect(toolIdsFor([
      node({ id: 'fn-1', node_type: 'function' }),
    ])).toEqual([]);
  });

  it('filters out tools that are not available in the current tool registry', () => {
    const suggestions = buildNextStepSuggestions([
      node({ id: 'image-1', node_type: 'image', file_path: 'figures/diagram.png' }),
    ], {
      availableToolIds: new Set(['summarize']),
      limit: 5,
    });

    expect(suggestions.map(suggestion => suggestion.toolId)).toEqual(['summarize']);
  });
});
