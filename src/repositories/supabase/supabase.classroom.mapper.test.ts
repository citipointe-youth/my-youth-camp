import { describe, it, expect } from 'vitest';
import { toRoom, roomCols } from './supabase.classroom';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'r1', name: 'Room 1', capacity: 20, created_at: created, updated_at: updated, ...over,
});

describe('classroom mapper', () => {
  it('converts Date timestamps to ISO strings', () => {
    const r = toRoom(row());
    expect(r.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(r.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('maps name/capacity straight through', () => {
    const r = toRoom(row());
    expect(r.name).toBe('Room 1');
    expect(r.capacity).toBe(20);
  });
  it('round-trips id/name/capacity through roomCols', () => {
    const cols = roomCols(toRoom(row()));
    expect(cols['id']).toBe('r1');
    expect(cols['name']).toBe('Room 1');
    expect(cols['capacity']).toBe(20);
  });
});
