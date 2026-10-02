import { describe, it, expect } from 'vitest';
import { toZone, zoneCols } from './supabase.zones';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'z1', name: 'north', label: 'North Zone', color_hex: '#ff0000',
  leader_ids: null, created_at: created, updated_at: updated, ...over,
});

describe('zones mapper', () => {
  it('converts Date timestamps to ISO strings', () => {
    const z = toZone(row());
    expect(z.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(z.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('defaults null leader_ids to an empty array', () => {
    const z = toZone(row());
    expect(z.leaderIds).toEqual([]);
  });
  it('colorHex/label round-trip, leaderIds stays a plain array', () => {
    const r = row({ leader_ids: ['u1', 'u2'] });
    const cols = zoneCols(toZone(r));
    expect(cols['color_hex']).toBe('#ff0000');
    expect(cols['label']).toBe('North Zone');
    expect(Array.isArray(cols['leader_ids'])).toBe(true);
    expect(cols['leader_ids']).toEqual(['u1', 'u2']);
  });
});
