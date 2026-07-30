import { describe, it, expect, beforeAll } from 'vitest';
import { toIncident, incidentColumns, SupabaseIncidentRepository } from './supabase.incidents';
import type { Incident } from '../../core/entities/incident';
import type { SqlClient } from './client';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

function sampleIncident(): Incident {
  return {
    id: 'inc_1',
    summary: 'Camper A disclosed a safeguarding concern about a leader.',
    severity: 'high',
    createdById: 'u_1', createdByName: 'Zone Leader', createdByRole: 'zoneLeader',
    zone: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('incidents mapper encryption', () => {
  it('encrypts the summary on write (never stores plaintext)', () => {
    const cols = incidentColumns(sampleIncident());
    expect(String(cols['summary']).startsWith('v1.')).toBe(true);
    expect(cols['summary']).not.toContain('safeguarding'); // plaintext must not leak into the column
    expect(cols['severity']).toBe('high'); // non-sensitive columns untouched
    expect(cols['zone']).toBe('Yellow');
  });

  it('round-trips the summary through toIncident', () => {
    const cols = incidentColumns(sampleIncident());
    const row = { ...cols, created_at: new Date(cols['created_at'] as string) };
    const inc = toIncident(row);
    expect(inc.summary).toBe('Camper A disclosed a safeguarding concern about a leader.');
    expect(inc.severity).toBe('high');
    expect(inc.zone).toBe('Yellow');
    expect(inc.createdByRole).toBe('zoneLeader');
  });

  it('carries occurred_at both ways, and null when it was never recorded', () => {
    const cols = incidentColumns({ ...sampleIncident(), occurredAt: '2026-01-01T09:30:00.000Z' });
    expect(cols['occurred_at']).toBe('2026-01-01T09:30:00.000Z');
    const row = {
      ...cols,
      created_at: new Date(cols['created_at'] as string),
      occurred_at: new Date(cols['occurred_at'] as string), // `pg` hands back a Date
    };
    expect(toIncident(row).occurredAt).toBe('2026-01-01T09:30:00.000Z');

    // Optional: an incident logged without it maps to null in both directions.
    const bare = incidentColumns(sampleIncident());
    expect(bare['occurred_at']).toBeNull();
    expect(toIncident({ ...bare, created_at: new Date(bare['created_at'] as string) }).occurredAt).toBeNull();
  });

  it('writes occurred_at in the on-conflict do-update list too (recurring bug class)', async () => {
    // A column present in incidentColumns but missing from `do update set` silently never
    // persists on an update. Assert against the real SQL the repository emits.
    const seen: string[] = [];
    // `sql` is used both as a tagged template AND as `sql(columnsObject)` (the column-spread
    // helper), so the fake has to answer to both call shapes.
    const sql = (first: unknown, ...rest: unknown[]) => {
      if (Array.isArray(first)) {
        seen.push((first as unknown as string[]).join('?'));
        return Promise.resolve([] as Record<string, unknown>[]);
      }
      void rest;
      return first; // sql(obj) — the column list
    };
    const repo = new SupabaseIncidentRepository(sql as unknown as SqlClient);
    await repo.save(sampleIncident());
    const insert = seen.find((s) => s.includes('insert into incidents'))!;
    expect(insert).toContain('on conflict');
    expect(insert).toContain('occurred_at = excluded.occurred_at');
  });

  it('reads a legacy plaintext summary (rollout tolerance)', () => {
    const row: Record<string, unknown> = {
      id: 'inc_legacy', summary: 'legacy plaintext summary', severity: 'low',
      created_by_id: 'u_1', created_by_name: 'Admin', created_by_role: 'admin',
      zone: null, created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(toIncident(row).summary).toBe('legacy plaintext summary');
  });
});
