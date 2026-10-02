import { describe, it, expect } from 'vitest';
import { toDev, devCols } from './supabase.devotionals';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'd1', day: '2026-09-28', verse: 'John 3:16', reference: 'John',
  reflection: 'God so loved', prayer: 'Thank you', created_at: created, updated_at: updated, ...over,
});

describe('devotionals mapper', () => {
  it('converts Date timestamps to ISO strings', () => {
    const d = toDev(row());
    expect(d.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(d.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('maps all fields straight through', () => {
    const d = toDev(row());
    expect(d.verse).toBe('John 3:16');
    expect(d.reference).toBe('John');
    expect(d.reflection).toBe('God so loved');
    expect(d.prayer).toBe('Thank you');
  });
  it('round-trips every field through devCols', () => {
    const r = row();
    const cols = devCols(toDev(r));
    expect(cols['id']).toBe('d1');
    expect(cols['day']).toBe('2026-09-28');
    expect(cols['verse']).toBe('John 3:16');
    expect(cols['reference']).toBe('John');
    expect(cols['reflection']).toBe('God so loved');
    expect(cols['prayer']).toBe('Thank you');
  });
});
