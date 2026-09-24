import { describe, it, expect } from 'vitest';
import { toClassroomFreeze } from './supabase.classroom-freeze';

describe('toClassroomFreeze', () => {
  it('maps a real row (timestamptz arrives as a Date, snapshot as an object)', () => {
    const f = toClassroomFreeze({
      id: 'freeze', frozen_at: new Date('2026-09-25T00:00:00Z'), frozen_by: 'Director',
      snapshot: { eligibleChurchIds: ['c1'], shapes: { 'c1|male': { split: false } }, baselines: { 'c1|male': 25 } },
    });
    expect(f).toEqual({
      id: 'freeze', frozenAt: '2026-09-25T00:00:00.000Z', frozenBy: 'Director',
      eligibleChurchIds: ['c1'], shapes: { 'c1|male': { split: false } }, baselines: { 'c1|male': 25 },
    });
  });

  it('refuses a double-encoded (string) snapshot rather than reading it as empty', () => {
    expect(() => toClassroomFreeze({ id: 'freeze', frozen_at: new Date(), frozen_by: '', snapshot: '{"baselines":{}}' })).toThrow(/malformed/);
  });
});
