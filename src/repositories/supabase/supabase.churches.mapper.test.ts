import { describe, it, expect } from 'vitest';
import { toChurch, churchColumns } from './supabase.churches';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'c1', name: 'Citipointe', zone: 'north', contact_phone: null,
  accommodation_override: null, accommodation_per_registration: false,
  contacts: null, created_at: created, updated_at: updated, ...over,
});

describe('churches mapper', () => {
  it('converts Date timestamps to ISO strings', () => {
    const c = toChurch(row());
    expect(c.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(c.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('defaults nullable fields', () => {
    const c = toChurch(row());
    expect(c.contactPhone).toBeUndefined();
    expect(c.accommodationOverride).toBeNull();
    expect(c.accommodationPerRegistration).toBe(false);
    expect(c.contacts.male.primary).toEqual({ name: '', phone: '' });
    expect(c.contacts.female.backup).toEqual({ name: '', phone: '' });
  });
  it('round-trips row -> toChurch -> churchColumns', () => {
    const r = row({ contact_phone: '0400', accommodation_per_registration: true });
    const cols = churchColumns(toChurch(r));
    expect(cols['name']).toBe('Citipointe');
    expect(cols['contact_phone']).toBe('0400');
    expect(cols['accommodation_per_registration']).toBe(true);
    expect(Array.isArray(cols['contacts'])).toBe(false);
    expect(typeof cols['contacts']).toBe('object');
  });
});
