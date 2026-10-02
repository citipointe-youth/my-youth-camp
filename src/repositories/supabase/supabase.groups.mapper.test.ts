import { describe, it, expect } from 'vitest';
import { toGroup, groupCols } from './supabase.groups';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'g1', name: 'Group A', church_id: 'c1', zone: 'north', leader_id: 'u1',
  camper_ids: null, created_at: created, updated_at: updated, ...over,
});

describe('groups mapper', () => {
  it('converts Date timestamps to ISO strings', () => {
    const g = toGroup(row());
    expect(g.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(g.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('defaults null camper_ids to an empty array', () => {
    const g = toGroup(row());
    expect(g.camperIds).toEqual([]);
  });
  it('round-trips camperIds as a plain array (not a string)', () => {
    const r = row({ camper_ids: ['p1', 'p2'] });
    const cols = groupCols(toGroup(r));
    expect(Array.isArray(cols['camper_ids'])).toBe(true);
    expect(cols['camper_ids']).toEqual(['p1', 'p2']);
    expect(cols['name']).toBe('Group A');
  });
});
