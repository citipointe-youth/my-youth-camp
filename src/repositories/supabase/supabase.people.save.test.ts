/**
 * Supabase person writes, checked against a recording fake `sql` (no live DB, ruling Q13 c).
 * Pins which columns the ON CONFLICT update sets (B-1).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SupabasePersonRepository } from './supabase.people';
import type { Person } from '../../core/entities/person';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

type Helper = { helper: true; obj: unknown; cols: string[] };
type Stmt = { text: string; values: unknown[] };

/** Fake postgres.js: tagged-template calls are recorded statements, plain calls are helpers. */
function fakeSql() {
  const stmts: Stmt[] = [];
  const tx = (first: unknown, ...rest: unknown[]) => {
    if (Array.isArray(first) && 'raw' in first) {
      stmts.push({ text: (first as string[]).join('?'), values: rest });
      return Promise.resolve([]);
    }
    return { helper: true, obj: first, cols: rest as string[] } as Helper;
  };
  const sql = { begin: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) };
  return { sql, stmts };
}

const now = '2026-01-01T00:00:00.000Z';
const person = (over: Partial<Person> = {}): Person => ({
  id: 'p1', firstName: 'Ada', lastName: 'L', gender: 'female', kind: 'youth', churchId: 'c1',
  churchName: 'V', zone: 'Yellow', medicalConditions: [], dietaryRequirements: [],
  consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null },
    supervision: { granted: false, timestamp: null } },
  paymentStatus: 'unpaid', needsReview: false, lifecycle: 'arrived', atCamp: true,
  checkInHistory: [], signOutHistory: [], createdAt: now, updatedAt: now, ...over,
} as Person);

function updateSetCols(stmts: Stmt[]): string[] {
  const upsert = stmts.find((s) => s.text.includes('insert into people'))!;
  return (upsert.values[1] as Helper).cols;
}

describe('SupabasePersonRepository presence columns (B-1)', () => {
  it('a plain save/saveMany leaves at_camp and lifecycle out of the UPDATE set (insert still has them)', async () => {
    for (const write of [
      (r: SupabasePersonRepository) => r.save(person()),
      (r: SupabasePersonRepository) => r.saveMany([person()]),
    ]) {
      const { sql, stmts } = fakeSql();
      await write(new SupabasePersonRepository(sql as never));
      const cols = updateSetCols(stmts);
      expect(cols).not.toContain('at_camp');
      expect(cols).not.toContain('lifecycle');
      expect(cols).toContain('updated_at');
      const inserted = (stmts[0]!.values[0] as Helper).obj as Record<string, unknown>;
      expect(inserted).toMatchObject({ at_camp: true, lifecycle: 'arrived' });
    }
  });

  it('a presence save/saveMany includes at_camp and lifecycle in the UPDATE set', async () => {
    for (const write of [
      (r: SupabasePersonRepository) => r.save(person(), { presence: true }),
      (r: SupabasePersonRepository) => r.saveMany([person()], { presence: true }),
    ]) {
      const { sql, stmts } = fakeSql();
      await write(new SupabasePersonRepository(sql as never));
      expect(updateSetCols(stmts)).toEqual(expect.arrayContaining(['at_camp', 'lifecycle', 'first_name']));
    }
  });
});
