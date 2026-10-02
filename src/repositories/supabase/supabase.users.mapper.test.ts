import { describe, it, expect } from 'vitest';
import { toUser, userColumns } from './supabase.users';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'u1', first_name: 'Jane', last_name: 'Doe', username: 'janedoe',
  mobile: null, role: 'church', church_id: 'c1', church_name: 'Citipointe', zone: 'north',
  gender_scope: null, is_dual_gender_login: null, status: 'active',
  password_hash: 'hash123', must_change_password: null, login_history: null,
  created_at: created, updated_at: updated, ...over,
});

describe('users mapper', () => {
  it('converts Date timestamps to ISO strings', () => {
    const u = toUser(row());
    expect(u.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(u.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
  it('defaults nullable fields', () => {
    const u = toUser(row());
    expect(u.mobile).toBeUndefined();
    expect(u.genderScope).toBeNull();
    expect(u.isDualGenderLogin).toBe(false);
    expect(u.mustChangePassword).toBe(false);
    expect(u.loginHistory).toEqual([]);
  });
  it('round-trips with ?? null for mobile/church_id/church_name/zone/gender_scope/password_hash, and login_history stays a plain array', () => {
    const r = row({ mobile: null, church_id: null, church_name: null, zone: null, gender_scope: null, password_hash: null, login_history: ['2026-09-01T00:00:00.000Z'] });
    const cols = userColumns(toUser(r));
    expect(cols['mobile']).toBeNull();
    expect(cols['church_id']).toBeNull();
    expect(cols['church_name']).toBeNull();
    expect(cols['zone']).toBeNull();
    expect(cols['gender_scope']).toBeNull();
    expect(cols['password_hash']).toBeNull();
    expect(Array.isArray(cols['login_history'])).toBe(true);
    expect(cols['login_history']).toEqual(['2026-09-01T00:00:00.000Z']);
  });
});
