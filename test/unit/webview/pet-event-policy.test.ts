import { describe, expect, it } from 'vitest';
import {
  createPetCanvasEvent,
  getPetEventImportance,
  normalizePetCanvasEventType,
  pickPetLocalSuggestion,
  trimPetEventHistory,
  type PetCanvasEvent,
} from '../../../webview/src/pet/pet-event-policy';

describe('pet event policy', () => {
  it('normalizes legacy canvas event names to unified event types', () => {
    expect(normalizePetCanvasEventType('nodeAdded')).toBe('node_added');
    expect(normalizePetCanvasEventType('nodeDeleted')).toBe('node_deleted');
    expect(normalizePetCanvasEventType('aiDone')).toBe('tool_run_completed');
    expect(normalizePetCanvasEventType('aiError')).toBe('tool_run_failed');
    expect(getPetEventImportance('aiError')).toBe('high');
  });

  it('suggests structure after several added nodes', () => {
    const now = 1_000_000;
    const events: PetCanvasEvent[] = [
      createPetCanvasEvent('node_added', {}, now - 10_000),
      createPetCanvasEvent('node_added', {}, now - 5_000),
      createPetCanvasEvent('node_added', {}, now),
    ];

    const suggestion = pickPetLocalSuggestion({ event: events[2], recentEvents: events, now });

    expect(suggestion?.kind).toBe('mindmap_structure');
    expect(suggestion?.message).toContain('导图');
  });

  it('suggests error recovery only after repeated failures', () => {
    const now = 2_000_000;
    const first = createPetCanvasEvent('tool_run_failed', {}, now - 20_000);
    const second = createPetCanvasEvent('tool_run_failed', {}, now);

    expect(pickPetLocalSuggestion({ event: first, recentEvents: [first], now: first.createdAt })).toBeNull();

    const suggestion = pickPetLocalSuggestion({ event: second, recentEvents: [first, second], now });
    expect(suggestion?.kind).toBe('recover_error');
    expect(suggestion?.importance).toBe('high');
  });

  it('respects per-kind cooldown and trims old events', () => {
    const now = 3_000_000;
    const events = [
      createPetCanvasEvent('node_added', {}, now - 20 * 60_000),
      createPetCanvasEvent('node_added', {}, now - 9_000),
      createPetCanvasEvent('node_added', {}, now - 5_000),
      createPetCanvasEvent('node_added', {}, now),
    ];

    expect(trimPetEventHistory(events, now, 10 * 60_000)).toHaveLength(3);
    expect(pickPetLocalSuggestion({
      event: events[3],
      recentEvents: events,
      now,
      lastSuggestionByKind: { mindmap_structure: now - 60_000 },
    })).toBeNull();
  });

  it('suppresses proactive suggestions when activity is off', () => {
    const now = 4_000_000;
    const events = [
      createPetCanvasEvent('node_added', {}, now - 10_000),
      createPetCanvasEvent('node_added', {}, now - 5_000),
      createPetCanvasEvent('node_added', {}, now),
    ];

    expect(pickPetLocalSuggestion({
      event: events[2],
      recentEvents: events,
      now,
      activity: 'off',
    })).toBeNull();
  });
});
