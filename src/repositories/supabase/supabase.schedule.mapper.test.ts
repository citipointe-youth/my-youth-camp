import { describe, it, expect } from 'vitest';
import { toItem, itemCols } from './supabase.schedule';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 's1', day: '2026-09-28', start_time: '08:00', end_time: '09:00',
  title: 'Breakfast', location: 'Hall', type: 'meal',
  created_at: created, updated_at: updated, ...over,
});

describe('schedule mapper', () => {
  it('converts Date timestamps to ISO strings', () => {
    const i = toItem(row());
    expect(i.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(i.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('defaults null end_time/location to undefined', () => {
    const i = toItem(row({ end_time: null, location: null }));
    expect(i.endTime).toBeUndefined();
    expect(i.location).toBeUndefined();
  });
  it('round-trips row -> toItem -> itemCols, including id/day/title/type', () => {
    const r = row();
    const cols = itemCols(toItem(r));
    expect(cols['id']).toBe('s1');
    expect(cols['day']).toBe('2026-09-28');
    expect(cols['title']).toBe('Breakfast');
    expect(cols['type']).toBe('meal');
    expect(cols['end_time']).toBe('09:00');
    expect(cols['location']).toBe('Hall');
  });
  it('writes null (not undefined) for missing end_time/location', () => {
    const cols = itemCols(toItem(row({ end_time: null, location: null })));
    expect(cols['end_time']).toBeNull();
    expect(cols['location']).toBeNull();
  });
});
