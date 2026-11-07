/**
 * Supabase person writes, checked against a recording fake `sql` (no live DB, ruling Q13 c).
 * Pins the statement text and order the P3 presence seam relies on; the semantics are pinned by
 * the shared contract (src/repositories/contract/person.contract.ts) run on the in-memory adapter.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SupabasePersonRepository } from './supabase.people';
import type { Person } from '../../core/entities/person';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

type Helper = { helper: true; obj: unknown; cols: string[] };
type Stmt = { text: string; values: unknown[]; inTx: boolean };

/**
 * Fake postgres.js: tagged-template calls are recorded statements, plain calls are helpers.
 * `answer(text)` supplies the rows a statement returns. Statements outside `begin` are flagged
 * (`inTx: false`) so a test can prove a transaction never reaches for a second connection.
 */
function fakeSql(answer: (text: string) => unknown[] = () => []) {
  const stmts: Stmt[] = [];
  let begins = 0;
  const make = (inTx: boolean) => {
    const c = (first: unknown, ...rest: unknown[]) => {
      if (Array.isArray(first) && 'raw' in first) {
        const text = (first as string[]).join('?');
        stmts.push({ text, values: rest, inTx });
        return Promise.resolve(answer(text));
      }
      return { helper: true, obj: first, cols: rest as string[] } as Helper;
    };
    c.json = (v: unknown) => ({ json: v });
    return c;
  };
  const tx = make(true);
  const sql = Object.assign(make(false), {
    begin: async <R>(fn: (t: typeof tx) => Promise<R>) => { begins++; return fn(tx); },
  });
  return { sql, stmts, begins: () => begins };
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
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, first_name: 'Ada', last_name: 'L', gender: 'female', kind: 'youth', church_id: 'c1', church_name: 'V',
  zone: 'Yellow', payment_status: 'unpaid', lifecycle: 'arrived', at_camp: true, cancelled_at: null,
  created_at: new Date(now), updated_at: new Date(now), ...over,
});
const words = (s: Stmt, n = 3) => s.text.trim().split(/\s+/).slice(0, n).join(' ');
const flat = (s: Stmt) => s.text.replace(/\s+/g, ' ').trim();
const entry = { id: 'ci2', sessionId: '2026-09-28~pm', sessionLabel: 'Mon PM', type: 'in' as const, leaderId: 'AB', timestamp: now };

function updateSetCols(stmts: Stmt[]): string[] {
  const upsert = stmts.find((s) => s.text.includes('insert into people'))!;
  return (upsert.values[1] as Helper).cols;
}

describe('SupabasePersonRepository save/saveMany (B-1, P3)', () => {
  it('the UPDATE set holds no presence column; the insert has them; one transaction', async () => {
    for (const write of [
      (r: SupabasePersonRepository) => r.save(person()),
      (r: SupabasePersonRepository) => r.saveMany([person()]),
    ]) {
      const f = fakeSql();
      await write(new SupabasePersonRepository(f.sql as never));
      const cols = updateSetCols(f.stmts);
      for (const c of ['at_camp', 'lifecycle', 'cancelled_at']) expect(cols).not.toContain(c);
      expect(cols).toEqual(expect.arrayContaining(['updated_at', 'first_name', 'refunded_at']));
      const inserted = (f.stmts[0]!.values[0] as Helper).obj as Record<string, unknown>;
      expect(inserted).toMatchObject({ at_camp: true, lifecycle: 'arrived' });
      expect(flat(f.stmts[0]!)).toContain('returning (xmax = 0) as inserted');
      expect(f.begins()).toBe(1);
      expect(f.stmts.every((s) => s.inTx)).toBe(true);
    }
  });

  it('an UPDATE (xmax <> 0) writes no history rows, so a stale save cannot resurrect cleared history', async () => {
    const f = fakeSql((t) => (t.includes('insert into people') ? [{ inserted: false }] : []));
    await new SupabasePersonRepository(f.sql as never).save(person({ checkInHistory: [entry],
      signOutHistory: [{ id: 'so1', type: 'in', leaderName: 'AB', authorId: 'u', timestamp: now }] }));
    expect(f.stmts.map((s) => words(s))).toEqual(['insert into people']);
  });

  it('an INSERT writes its history rows after the upsert, check-ins through the B-5 guard', async () => {
    const f = fakeSql((t) => (t.includes('insert into people') ? [{ inserted: true }] : []));
    await new SupabasePersonRepository(f.sql as never).save(person({ checkInHistory: [entry],
      signOutHistory: [{ id: 'so1', type: 'in', leaderName: 'AB', authorId: 'u', timestamp: now }] }));
    expect(f.stmts.map((s) => words(s))).toEqual(['insert into people', 'insert into check_in_history', 'insert into sign_out_history']);
    const ci = flat(f.stmts[1]!);
    expect(ci).toContain('where h.person_id = v.person_id and h.session_id = v.session_id');
    expect(ci).toContain('order by h."timestamp" desc, h.id desc limit 1');
    expect(ci).toContain('is distinct from v.type');
    expect(ci).toContain('on conflict (id) do nothing');
    expect(f.stmts[1]!.values[0]).toEqual({ json: [{ id: 'ci2', person_id: 'p1', session_id: '2026-09-28~pm',
      session_label: 'Mon PM', type: 'in', leader_id: 'AB', timestamp: now }] });
    expect(f.stmts[2]!.text).not.toContain('distinct');
  });
});

describe('SupabasePersonRepository presence seam (P3)', () => {
  const answer = (t: string) => (t.includes('from people where id in') ? [row('p1')] : []);

  it('transition: lock, load histories, update presence, append one row — all on the transaction', async () => {
    const f = fakeSql(answer);
    const out = await new SupabasePersonRepository(f.sql as never).transition('p1', (cur) => ({
      atCamp: cur.atCamp, lifecycle: cur.lifecycle, appendCheckIn: entry, updatedAt: '2026-01-02T00:00:00.000Z',
    }));
    expect(f.begins()).toBe(1);
    expect(f.stmts.every((s) => s.inTx)).toBe(true);
    expect(f.stmts.map((s) => flat(s))).toEqual([
      'select * from people where id in ? order by id for update',
      'select * from check_in_history where person_id in ? order by timestamp, id',
      'select * from sign_out_history where person_id in ? order by timestamp, id',
      'update people set ? where id = ?',
      expect.stringContaining('insert into check_in_history'),
    ]);
    const set = (f.stmts[3]!.values[0] as Helper).obj as Record<string, unknown>;
    expect(set).toEqual({ at_camp: true, lifecycle: 'arrived', updated_at: '2026-01-02T00:00:00.000Z' });
    expect(out.checkInHistory.map((e) => e.id)).toEqual(['ci2']);
  });

  it('transition: cancelled_at only when the write carries it; a sign event goes to sign_out_history', async () => {
    const f = fakeSql(answer);
    await new SupabasePersonRepository(f.sql as never).transition('p1', () => ({
      atCamp: false, lifecycle: 'cancelled', cancelledAt: now, updatedAt: now,
      appendSignEvent: { id: 'so9', type: 'out', leaderName: 'A', authorId: 'u', reason: 'Registration cancelled', timestamp: now },
    }));
    const set = (f.stmts.find((s) => flat(s).startsWith('update people'))!.values[0] as Helper).obj as Record<string, unknown>;
    expect(set).toMatchObject({ cancelled_at: now, at_camp: false, lifecycle: 'cancelled' });
    expect(f.stmts.map((s) => words(s)).at(-1)).toBe('insert into sign_out_history');
  });

  it('transition: a null decision runs no write; a missing row is a 404', async () => {
    const f = fakeSql(answer);
    await new SupabasePersonRepository(f.sql as never).transition('p1', () => null);
    expect(f.stmts.some((s) => /^(update|insert)/.test(flat(s)))).toBe(false);
    await expect(new SupabasePersonRepository(fakeSql().sql as never).transition('x', () => null)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('transitionMany: one transaction, rows locked in id order, de-duplicated ids', async () => {
    const f = fakeSql((t) => (t.includes('from people where id in') ? [row('a'), row('b')] : []));
    await new SupabasePersonRepository(f.sql as never).transitionMany(['b', 'a', 'b'], () => null);
    expect(f.begins()).toBe(1);
    expect(flat(f.stmts[0]!)).toBe('select * from people where id in ? order by id for update');
    expect((f.stmts[0]!.values[0] as Helper).obj).toEqual(['b', 'a']);
  });

  it('clearPresence: presence UPDATE (with the history exists tests) before both DELETEs, one transaction', async () => {
    const f = fakeSql((t) => (t.includes('update people') ? [{ id: 'a' }, { id: 'b' }] : []));
    expect(await new SupabasePersonRepository(f.sql as never).clearPresence(now)).toBe(2);
    expect(f.begins()).toBe(1);
    const [upd, d1, d2] = f.stmts.map((s) => flat(s));
    expect(upd).toContain("lifecycle = case when lifecycle in ('cancelled', 'registered') then lifecycle else 'registered' end");
    expect(upd).toContain('where at_camp or exists (select 1 from check_in_history h where h.person_id = people.id) or exists (select 1 from sign_out_history s where s.person_id = people.id) returning id');
    expect([d1, d2]).toEqual(['delete from check_in_history', 'delete from sign_out_history']);
    expect(f.stmts[0]!.values).toEqual([now]);
  });
});
