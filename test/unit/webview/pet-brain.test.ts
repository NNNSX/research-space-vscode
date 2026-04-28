import { describe, expect, it } from 'vitest';
import { buildPetSuggestionCard, derivePetPreferenceSignals } from '../../../webview/src/pet/pet-brain';
import type { PetLocalSuggestion } from '../../../webview/src/pet/pet-event-policy';

function suggestion(kind: PetLocalSuggestion['kind']): PetLocalSuggestion {
  return {
    kind,
    message: '建议内容',
    reason: '测试原因',
    importance: 'medium',
    cooldownMs: 1000,
  };
}

describe('pet brain suggestion cards', () => {
  it('maps structure suggestions to confirmed mindmap actions', () => {
    const card = buildPetSuggestionCard(suggestion('mindmap_structure'));

    expect(card?.reason).toBe('测试原因');
    expect(card?.actions[0]).toMatchObject({
      type: 'create_mindmap',
      label: '新建导图',
      risk: 'low',
      permission: 'create',
    });
    expect(card?.actions).toHaveLength(2);
    expect(card?.actions[0].confirmText).toContain('创建');
    expect(card?.actions[0].reason).toContain('导图');
  });

  it('maps output organization, error recovery and rest to bounded actions', () => {
    const outputCard = buildPetSuggestionCard(suggestion('organize_outputs'));
    expect(outputCard?.actions.map(action => action.type)).toEqual(['create_note', 'create_mindmap']);
    expect(buildPetSuggestionCard(suggestion('recover_error'))?.actions[0]).toMatchObject({
      type: 'open_ai_settings',
      permission: 'open_panel',
    });
    expect(buildPetSuggestionCard(suggestion('rest'))?.actions[0]).toMatchObject({
      type: 'open_pet_settings',
      permission: 'open_panel',
    });
  });

  it('uses memory profile to adapt action order and suggestion tone', () => {
    const noteFirst = buildPetSuggestionCard(suggestion('mindmap_structure'), {
      memorySummary: {
        profile: {
          frequentNodeTypes: ['markdown_note'],
          suggestionActivity: 'quiet',
          displayMode: 'canvas-follow',
          suggestionStats: { shown: 5, accepted: 0, later: 4, muted: 1 },
        },
      },
    });

    expect(noteFirst?.actions[0].type).toBe('create_note');
    expect(noteFirst?.preferenceHint).toContain('低打扰');

    const signals = derivePetPreferenceSignals({
      memorySummary: {
        profile: {
          frequentNodeTypes: ['mindmap'],
          suggestionStats: { shown: 4, accepted: 3, later: 0, muted: 0 },
        },
      },
    });
    expect(signals.prefersMindmap).toBe(true);
    expect(signals.acceptanceRate).toBeGreaterThan(0.5);
  });
});
