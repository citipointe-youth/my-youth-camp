import { describe, it, expect, beforeAll } from 'vitest';
import { toIncident, incidentColumns } from './supabase.incidents';
import type { Incident } from '../../core/entities/incident';

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

  it('reads a legacy plaintext summary (rollout tolerance)', () => {
    const row: Record<string, unknown> = {
      id: 'inc_legacy', summary: 'legacy plaintext summary', severity: 'low',
      created_by_id: 'u_1', created_by_name: 'Admin', created_by_role: 'admin',
      zone: null, created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(toIncident(row).summary).toBe('legacy plaintext summary');
  });
});
