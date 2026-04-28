import { describe, expect, it } from 'vitest';
import { buildPetGrowthMilestones, getPetGrowthSummary, getPetWorkRhythmSummary } from '../../../src/core/pet-growth';

describe('pet growth summary', () => {
  it('marks companion abilities and pet unlocks by level', () => {
    const milestones = buildPetGrowthMilestones(5);

    expect(milestones.find(milestone => milestone.id === 'canvas-follow')?.unlocked).toBe(true);
    expect(milestones.find(milestone => milestone.id === 'local-memory')?.unlocked).toBe(false);
    expect(milestones.find(milestone => milestone.id === 'pet-crab')?.unlocked).toBe(true);
    expect(milestones.find(milestone => milestone.id === 'pet-cockatiel')?.unlocked).toBe(false);
  });

  it('returns stage, next milestone and progress without gating existing features', () => {
    const summary = getPetGrowthSummary({
      level: 5,
      exp: 850,
      totalWorkMinutes: 90,
      currentSessionStart: new Date(Date.now() - 65 * 60_000).toISOString(),
    });

    expect(summary.stageLabel).toBe('画布整理伙伴');
    expect(summary.nextMilestone?.id).toBe('local-memory');
    expect(summary.unlockedMilestones.length).toBeGreaterThan(0);
    expect(summary.workRhythm.rhythmLabel).toBe('稳定专注');
  });

  it('summarizes short and long work rhythm safely', () => {
    const now = Date.parse('2026-04-28T08:00:00.000Z');
    expect(getPetWorkRhythmSummary({
      totalWorkMinutes: 125,
      currentSessionStart: '2026-04-28T07:45:00.000Z',
    }, now)).toMatchObject({
      totalWorkHours: 2,
      currentSessionMinutes: 15,
      rhythmLabel: '刚开始进入状态',
    });

    expect(getPetWorkRhythmSummary({
      totalWorkMinutes: 300,
      currentSessionStart: '2026-04-28T05:30:00.000Z',
    }, now).rhythmLabel).toBe('长时段深度工作');
  });
});
