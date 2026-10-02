import { describe, it, expect } from 'vitest';
import { toAlloc, allocCols } from './supabase.allocation';

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a1', room_id: 'r1', church_id: 'c1', gender: 'male', n: 5,
  bracket: null, seq: null, ...over,
});

describe('allocation mapper', () => {
  it('bracket/seq default to null', () => {
    const a = toAlloc(row());
    expect(a.bracket).toBeNull();
    expect(a.seq).toBeNull();
  });
  it('maps room_id/church_id/gender/n straight through', () => {
    const a = toAlloc(row());
    expect(a.roomId).toBe('r1');
    expect(a.churchId).toBe('c1');
    expect(a.gender).toBe('male');
    expect(a.n).toBe(5);
  });
  it('round-trips bracket/seq both ways (null and set)', () => {
    const nullCols = allocCols(toAlloc(row()));
    expect(nullCols['bracket']).toBeNull();
    expect(nullCols['seq']).toBeNull();
    const r = row({ bracket: '7-9', seq: 2 });
    const setCols = allocCols(toAlloc(r));
    expect(setCols['bracket']).toBe('7-9');
    expect(setCols['seq']).toBe(2);
    expect(setCols['id']).toBe('a1');
  });
});
