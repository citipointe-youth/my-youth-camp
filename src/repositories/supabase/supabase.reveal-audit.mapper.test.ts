import { describe, it, expect } from 'vitest';
import { toRevealAudit, revealAuditColumns } from './supabase.reveal-audit';

const created = new Date('2026-09-01T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ra1', kind: 'medicare', person_id: 'p1', person_name: null, church_name: null,
  actor_id: 'u1', actor_username: null, actor_role: 'church', actor_initials: null,
  contact_role: null, created_at: created, ...over,
});

describe('reveal-audit mapper', () => {
  it('defaults null name/username/initials fields to empty strings', () => {
    const a = toRevealAudit(row());
    expect(a.personName).toBe('');
    expect(a.churchName).toBe('');
    expect(a.actorUsername).toBe('');
    expect(a.actorInitials).toBe('');
  });
  it('contact_role null stays null; created_at Date converts to ISO', () => {
    const a = toRevealAudit(row());
    expect(a.contactRole).toBeNull();
    expect(a.createdAt).toBe('2026-09-01T00:00:00.000Z');
  });
  it('privacy guard: the written columns never carry a sensitive-looking key', () => {
    const cols = revealAuditColumns(toRevealAudit(row({ person_name: 'John', church_name: 'Citipointe', actor_username: 'admin', actor_initials: 'JD' })));
    const bad = Object.keys(cols).filter((k) => /value|number|phone|medicare|email/i.test(k));
    expect(bad).toEqual([]);
  });
});
