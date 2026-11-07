import { describe, it, expect, beforeAll } from 'vitest';
import { buildContainer, type Container } from '../container';
import { seedAll } from '../data/seed';
import { env } from '../config/env';
import { canAccessChurch } from './access-control';
import { canAccessPerson } from './person.service';
import { isAppError } from '../core/errors/app-error';
import type { Actor } from '../core/entities/user';
import type { Person } from '../core/entities/person';

/**
 * A1 (Phase C, 7 Nov 2026): the access truth table, pinned BEFORE the scope switches were merged
 * into access-control.ts. Every role × target is run through the predicates and through the real
 * service paths that use them: the offline queue's replay targets (POST /checkin → checkIn,
 * /attendance → signEvent), search, note add/forCamper and revealContact. The snapshots were
 * generated on the pre-A1 code and must not change.
 */

if (env.PERSISTENCE !== 'memory' || env.DATABASE_URL) {
  throw new Error('access-policy.a1.test.ts must run with PERSISTENCE=memory and no DATABASE_URL');
}

const base = { churchName: null, displayName: 'T', genderScope: null } as const;
const ACTORS: Record<string, Actor> = {
  admin: { ...base, id: 'x-admin', role: 'admin', churchId: null, zone: null },
  director: { ...base, id: 'x-dir', role: 'director', churchId: null, zone: null },
  firstAid: { ...base, id: 'x-fa', role: 'firstAid', churchId: null, zone: null },
  prayer: { ...base, id: 'x-pr', role: 'prayer', churchId: null, zone: null },
  zoneYellow: { ...base, id: 'x-zy', role: 'zoneLeader', churchId: null, zone: 'Yellow' },
  zoneNull: { ...base, id: 'x-zn', role: 'zoneLeader', churchId: null, zone: null },
  church: { ...base, id: 'x-c', role: 'church', churchId: 'pc1', zone: 'Yellow' },
  churchBoys: { ...base, id: 'x-cb', role: 'church', churchId: 'pc1', zone: 'Yellow', genderScope: 'male' },
  churchGirls: { ...base, id: 'x-cg', role: 'church', churchId: 'pc1', zone: 'Yellow', genderScope: 'female' },
} as Record<string, Actor>;

const NOW = '2026-11-07T00:00:00.000Z';
type T = { churchId: string; zone: string; gender: Person['gender']; lifecycle: Person['lifecycle']; atCamp: boolean; signOutHistory?: unknown[] };
const TARGETS: Record<string, T> = {
  ownM_arrived: { churchId: 'pc1', zone: 'Yellow', gender: 'male', lifecycle: 'arrived', atCamp: true },
  ownF_arrived: { churchId: 'pc1', zone: 'Yellow', gender: 'female', lifecycle: 'arrived', atCamp: true },
  ownOther_arrived: { churchId: 'pc1', zone: 'Yellow', gender: 'other' as Person['gender'], lifecycle: 'arrived', atCamp: true },
  ownM_registered: { churchId: 'pc1', zone: 'Yellow', gender: 'male', lifecycle: 'registered', atCamp: false },
  ownF_signedOut: { churchId: 'pc1', zone: 'Yellow', gender: 'female', lifecycle: 'checked_out', atCamp: false },
  ownM_cancelled: { churchId: 'pc1', zone: 'Yellow', gender: 'male', lifecycle: 'cancelled', atCamp: false },
  // T-2 (Tom, 7 Nov): cancelled after arriving (sent home): firstAid/prayer keep 'full' reach.
  ownM_sentHome: { churchId: 'pc1', zone: 'Yellow', gender: 'male', lifecycle: 'cancelled', atCamp: false,
    signOutHistory: [{ id: 'so-sh', type: 'in', leaderName: 'L', authorId: 'x', timestamp: NOW }] },
  sameZoneM_arrived: { churchId: 'pc2', zone: 'Yellow', gender: 'male', lifecycle: 'arrived', atCamp: true },
  sameZoneF_registered: { churchId: 'pc2', zone: 'Yellow', gender: 'female', lifecycle: 'registered', atCamp: false },
  otherZoneF_arrived: { churchId: 'pc3', zone: 'Blue', gender: 'female', lifecycle: 'arrived', atCamp: true },
  otherZoneM_registered: { churchId: 'pc3', zone: 'Blue', gender: 'male', lifecycle: 'registered', atCamp: false },
};

let c: Container;
beforeAll(async () => {
  c = await buildContainer();
  await seedAll(c);
  const contact = (n: string) => ({ primary: { name: n + 'P', phone: '0411 111 111' }, backup: { name: n + 'B', phone: '0422 222 222' } });
  for (const [id, zone] of [['pc1', 'Yellow'], ['pc2', 'Yellow'], ['pc3', 'Blue']] as const) {
    await c.repos.churches.save({ id, name: id, zone, contacts: { male: contact('m'), female: contact('f') }, createdAt: NOW, updatedAt: NOW } as never);
  }
  for (const [id, t] of Object.entries(TARGETS)) {
    await c.repos.people.save({
      id, firstName: 'Zq' + id.replace(/_/g, ''), lastName: 'Policy', kind: 'student', churchName: t.churchId,
      grade: '10', medicalConditions: [], dietaryRequirements: [], consents: {}, checkInHistory: [], signOutHistory: [],
      parentPhone: '0400 000 000', createdAt: NOW, updatedAt: NOW, ...t,
    } as unknown as Person);
  }
});

const outcome = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e) { return isAppError(e) ? String(e.statusCode) : 'throw'; }
};

/** One line per actor: target=result, so a snapshot diff names the exact cell that moved. */
async function table(fn: (a: Actor, id: string, t: T) => Promise<string> | string) {
  const out: Record<string, string> = {};
  for (const [an, a] of Object.entries(ACTORS)) {
    const cells: string[] = [];
    for (const [tn, t] of Object.entries(TARGETS)) cells.push(`${tn}=${await fn(a, tn, t)}`);
    out[an] = cells.join(' ');
  }
  return out;
}

describe('A1 access truth table (pinned pre-refactor)', () => {
  it('canAccessPerson', async () => {
    expect(await table((a, _id, t) => (canAccessPerson(a, t) ? 'Y' : '-'))).toMatchInlineSnapshot(`
      {
        "admin": "ownM_arrived=Y ownF_arrived=Y ownOther_arrived=Y ownM_registered=Y ownF_signedOut=Y ownM_cancelled=Y ownM_sentHome=Y sameZoneM_arrived=Y sameZoneF_registered=Y otherZoneF_arrived=Y otherZoneM_registered=Y",
        "church": "ownM_arrived=Y ownF_arrived=Y ownOther_arrived=Y ownM_registered=Y ownF_signedOut=Y ownM_cancelled=Y ownM_sentHome=Y sameZoneM_arrived=- sameZoneF_registered=- otherZoneF_arrived=- otherZoneM_registered=-",
        "churchBoys": "ownM_arrived=Y ownF_arrived=- ownOther_arrived=Y ownM_registered=Y ownF_signedOut=- ownM_cancelled=Y ownM_sentHome=Y sameZoneM_arrived=- sameZoneF_registered=- otherZoneF_arrived=- otherZoneM_registered=-",
        "churchGirls": "ownM_arrived=- ownF_arrived=Y ownOther_arrived=Y ownM_registered=- ownF_signedOut=Y ownM_cancelled=- ownM_sentHome=- sameZoneM_arrived=- sameZoneF_registered=- otherZoneF_arrived=- otherZoneM_registered=-",
        "director": "ownM_arrived=Y ownF_arrived=Y ownOther_arrived=Y ownM_registered=Y ownF_signedOut=Y ownM_cancelled=Y ownM_sentHome=Y sameZoneM_arrived=Y sameZoneF_registered=Y otherZoneF_arrived=Y otherZoneM_registered=Y",
        "firstAid": "ownM_arrived=Y ownF_arrived=Y ownOther_arrived=Y ownM_registered=Y ownF_signedOut=Y ownM_cancelled=Y ownM_sentHome=Y sameZoneM_arrived=Y sameZoneF_registered=Y otherZoneF_arrived=Y otherZoneM_registered=Y",
        "prayer": "ownM_arrived=Y ownF_arrived=Y ownOther_arrived=Y ownM_registered=Y ownF_signedOut=Y ownM_cancelled=Y ownM_sentHome=Y sameZoneM_arrived=Y sameZoneF_registered=Y otherZoneF_arrived=Y otherZoneM_registered=Y",
        "zoneNull": "ownM_arrived=- ownF_arrived=- ownOther_arrived=- ownM_registered=- ownF_signedOut=- ownM_cancelled=- ownM_sentHome=- sameZoneM_arrived=- sameZoneF_registered=- otherZoneF_arrived=- otherZoneM_registered=-",
        "zoneYellow": "ownM_arrived=Y ownF_arrived=Y ownOther_arrived=Y ownM_registered=Y ownF_signedOut=Y ownM_cancelled=Y ownM_sentHome=Y sameZoneM_arrived=Y sameZoneF_registered=Y otherZoneF_arrived=- otherZoneM_registered=-",
      }
    `);
  });

  it('canAccessChurch (target church + its zone, and with the zone unknown)', async () => {
    expect(await table((a, _id, t) =>
      `${canAccessChurch(a, t.churchId, t.zone) ? 'Y' : '-'}${canAccessChurch(a, t.churchId) ? 'Y' : '-'}`,
    )).toMatchInlineSnapshot(`
      {
        "admin": "ownM_arrived=YY ownF_arrived=YY ownOther_arrived=YY ownM_registered=YY ownF_signedOut=YY ownM_cancelled=YY ownM_sentHome=YY sameZoneM_arrived=YY sameZoneF_registered=YY otherZoneF_arrived=YY otherZoneM_registered=YY",
        "church": "ownM_arrived=YY ownF_arrived=YY ownOther_arrived=YY ownM_registered=YY ownF_signedOut=YY ownM_cancelled=YY ownM_sentHome=YY sameZoneM_arrived=-- sameZoneF_registered=-- otherZoneF_arrived=-- otherZoneM_registered=--",
        "churchBoys": "ownM_arrived=YY ownF_arrived=YY ownOther_arrived=YY ownM_registered=YY ownF_signedOut=YY ownM_cancelled=YY ownM_sentHome=YY sameZoneM_arrived=-- sameZoneF_registered=-- otherZoneF_arrived=-- otherZoneM_registered=--",
        "churchGirls": "ownM_arrived=YY ownF_arrived=YY ownOther_arrived=YY ownM_registered=YY ownF_signedOut=YY ownM_cancelled=YY ownM_sentHome=YY sameZoneM_arrived=-- sameZoneF_registered=-- otherZoneF_arrived=-- otherZoneM_registered=--",
        "director": "ownM_arrived=YY ownF_arrived=YY ownOther_arrived=YY ownM_registered=YY ownF_signedOut=YY ownM_cancelled=YY ownM_sentHome=YY sameZoneM_arrived=YY sameZoneF_registered=YY otherZoneF_arrived=YY otherZoneM_registered=YY",
        "firstAid": "ownM_arrived=YY ownF_arrived=YY ownOther_arrived=YY ownM_registered=YY ownF_signedOut=YY ownM_cancelled=YY ownM_sentHome=YY sameZoneM_arrived=YY sameZoneF_registered=YY otherZoneF_arrived=YY otherZoneM_registered=YY",
        "prayer": "ownM_arrived=YY ownF_arrived=YY ownOther_arrived=YY ownM_registered=YY ownF_signedOut=YY ownM_cancelled=YY ownM_sentHome=YY sameZoneM_arrived=YY sameZoneF_registered=YY otherZoneF_arrived=YY otherZoneM_registered=YY",
        "zoneNull": "ownM_arrived=-- ownF_arrived=-- ownOther_arrived=-- ownM_registered=-- ownF_signedOut=-- ownM_cancelled=-- ownM_sentHome=-- sameZoneM_arrived=-- sameZoneF_registered=-- otherZoneF_arrived=-- otherZoneM_registered=--",
        "zoneYellow": "ownM_arrived=Y- ownF_arrived=Y- ownOther_arrived=Y- ownM_registered=Y- ownF_signedOut=Y- ownM_cancelled=Y- ownM_sentHome=Y- sameZoneM_arrived=Y- sameZoneF_registered=Y- otherZoneF_arrived=-- otherZoneM_registered=--",
      }
    `);
  });

  it('checkIn (POST /checkin, the queued path)', async () => {
    expect(await table((a, id) => outcome(c.services.person.checkIn(a, id, {
      sessionId: '2026-11-07~am', type: 'in', timestamp: NOW, leaderName: 'T',
    } as never)))).toMatchInlineSnapshot(`
      {
        "admin": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=400 ownF_signedOut=400 ownM_cancelled=400 ownM_sentHome=400 sameZoneM_arrived=ok sameZoneF_registered=400 otherZoneF_arrived=ok otherZoneM_registered=400",
        "church": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=400 ownF_signedOut=400 ownM_cancelled=400 ownM_sentHome=400 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "churchBoys": "ownM_arrived=ok ownF_arrived=404 ownOther_arrived=ok ownM_registered=400 ownF_signedOut=404 ownM_cancelled=400 ownM_sentHome=400 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "churchGirls": "ownM_arrived=404 ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=400 ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "director": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=400 ownF_signedOut=400 ownM_cancelled=400 ownM_sentHome=400 sameZoneM_arrived=ok sameZoneF_registered=400 otherZoneF_arrived=ok otherZoneM_registered=400",
        "firstAid": "ownM_arrived=403 ownF_arrived=403 ownOther_arrived=403 ownM_registered=403 ownF_signedOut=403 ownM_cancelled=403 ownM_sentHome=403 sameZoneM_arrived=403 sameZoneF_registered=403 otherZoneF_arrived=403 otherZoneM_registered=403",
        "prayer": "ownM_arrived=403 ownF_arrived=403 ownOther_arrived=403 ownM_registered=403 ownF_signedOut=403 ownM_cancelled=403 ownM_sentHome=403 sameZoneM_arrived=403 sameZoneF_registered=403 otherZoneF_arrived=403 otherZoneM_registered=403",
        "zoneNull": "ownM_arrived=404 ownF_arrived=404 ownOther_arrived=404 ownM_registered=404 ownF_signedOut=404 ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "zoneYellow": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=400 ownF_signedOut=400 ownM_cancelled=400 ownM_sentHome=400 sameZoneM_arrived=ok sameZoneF_registered=400 otherZoneF_arrived=404 otherZoneM_registered=404",
      }
    `);
  });

  it('signEvent sign-out (/attendance/sign-out)', async () => {
    expect(await table((a, id) => outcome(c.services.person.signEvent(a, id, {
      type: 'out', timestamp: NOW, leaderName: 'T', reason: 'test',
    } as never)))).toMatchInlineSnapshot(`
      {
        "admin": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
        "church": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "churchBoys": "ownM_arrived=ok ownF_arrived=404 ownOther_arrived=ok ownM_registered=ok ownF_signedOut=404 ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "churchGirls": "ownM_arrived=404 ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "director": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
        "firstAid": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
        "prayer": "ownM_arrived=403 ownF_arrived=403 ownOther_arrived=403 ownM_registered=403 ownF_signedOut=403 ownM_cancelled=403 ownM_sentHome=403 sameZoneM_arrived=403 sameZoneF_registered=403 otherZoneF_arrived=403 otherZoneM_registered=403",
        "zoneNull": "ownM_arrived=404 ownF_arrived=404 ownOther_arrived=404 ownM_registered=404 ownF_signedOut=404 ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "zoneYellow": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=404 otherZoneM_registered=404",
      }
    `);
  });

  it('signEvent sign-in in pre-camp: only director/admin pass the camp-not-started gate', async () => {
    await c.repos.settings.patchSingleton({ campMode: 'pre-camp' });
    const res: Record<string, string> = {};
    for (const [an, a] of Object.entries(ACTORS)) {
      // A cancelled target: whoever passes the pre-camp gate stops at the cancelled 400 instead,
      // so nothing is written and the message names which gate fired.
      try { await c.services.person.signEvent(a, 'ownM_cancelled', { type: 'in', timestamp: NOW, leaderName: 'T' } as never); res[an] = 'ok'; }
      catch (e) { res[an] = isAppError(e) ? `${e.statusCode} ${e.message}` : 'throw'; }
    }
    expect(res).toMatchInlineSnapshot(`
      {
        "admin": "400 Cannot sign in a cancelled person",
        "church": "400 Camp has not started yet, so nobody can be signed in.",
        "churchBoys": "400 Camp has not started yet, so nobody can be signed in.",
        "churchGirls": "404 Person not found",
        "director": "400 Cannot sign in a cancelled person",
        "firstAid": "400 Camp has not started yet, so nobody can be signed in.",
        "prayer": "403 Role 'prayer' cannot perform 'attendance:write'",
        "zoneNull": "404 Person not found",
        "zoneYellow": "400 Camp has not started yet, so nobody can be signed in.",
      }
    `);
  });

  it('person.get', async () => {
    expect(await table((a, id) => outcome(c.services.person.get(a, id)))).toMatchInlineSnapshot(`
      {
        "admin": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
        "church": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "churchBoys": "ownM_arrived=ok ownF_arrived=404 ownOther_arrived=ok ownM_registered=ok ownF_signedOut=404 ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "churchGirls": "ownM_arrived=404 ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "director": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
        "firstAid": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
        "prayer": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
        "zoneNull": "ownM_arrived=404 ownF_arrived=404 ownOther_arrived=404 ownM_registered=404 ownF_signedOut=404 ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "zoneYellow": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=ok ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=404 otherZoneM_registered=404",
      }
    `);
  });

  it('search: F=full hit, L=limited (locate), -=absent', async () => {
    const res: Record<string, Record<string, string>> = {};
    for (const [an, a] of Object.entries(ACTORS)) {
      res[an] = {};
      try {
        for (const r of await c.services.search.search(a, 'Policy')) res[an]![r.camper.id] = r.limited ? 'L' : 'F';
      } catch (e) { res[an]!['*'] = isAppError(e) ? String(e.statusCode) : 'throw'; }
    }
    expect(await table((a, id) => {
      const an = Object.entries(ACTORS).find(([, x]) => x === a)![0];
      return res[an]!['*'] ?? res[an]![id] ?? '-';
    })).toMatchInlineSnapshot(`
      {
        "admin": "ownM_arrived=F ownF_arrived=F ownOther_arrived=F ownM_registered=- ownF_signedOut=F ownM_cancelled=- ownM_sentHome=- sameZoneM_arrived=F sameZoneF_registered=- otherZoneF_arrived=F otherZoneM_registered=-",
        "church": "ownM_arrived=F ownF_arrived=F ownOther_arrived=F ownM_registered=- ownF_signedOut=F ownM_cancelled=- ownM_sentHome=- sameZoneM_arrived=L sameZoneF_registered=- otherZoneF_arrived=L otherZoneM_registered=-",
        "churchBoys": "ownM_arrived=F ownF_arrived=L ownOther_arrived=F ownM_registered=- ownF_signedOut=L ownM_cancelled=- ownM_sentHome=- sameZoneM_arrived=L sameZoneF_registered=- otherZoneF_arrived=L otherZoneM_registered=-",
        "churchGirls": "ownM_arrived=L ownF_arrived=F ownOther_arrived=F ownM_registered=- ownF_signedOut=F ownM_cancelled=- ownM_sentHome=- sameZoneM_arrived=L sameZoneF_registered=- otherZoneF_arrived=L otherZoneM_registered=-",
        "director": "ownM_arrived=F ownF_arrived=F ownOther_arrived=F ownM_registered=- ownF_signedOut=F ownM_cancelled=- ownM_sentHome=- sameZoneM_arrived=F sameZoneF_registered=- otherZoneF_arrived=F otherZoneM_registered=-",
        "firstAid": "ownM_arrived=F ownF_arrived=F ownOther_arrived=F ownM_registered=F ownF_signedOut=F ownM_cancelled=- ownM_sentHome=F sameZoneM_arrived=F sameZoneF_registered=F otherZoneF_arrived=F otherZoneM_registered=F",
        "prayer": "ownM_arrived=F ownF_arrived=F ownOther_arrived=F ownM_registered=F ownF_signedOut=F ownM_cancelled=- ownM_sentHome=F sameZoneM_arrived=F sameZoneF_registered=F otherZoneF_arrived=F otherZoneM_registered=F",
        "zoneNull": "ownM_arrived=L ownF_arrived=L ownOther_arrived=L ownM_registered=- ownF_signedOut=L ownM_cancelled=- ownM_sentHome=- sameZoneM_arrived=L sameZoneF_registered=- otherZoneF_arrived=L otherZoneM_registered=-",
        "zoneYellow": "ownM_arrived=F ownF_arrived=F ownOther_arrived=F ownM_registered=- ownF_signedOut=F ownM_cancelled=- ownM_sentHome=- sameZoneM_arrived=F sameZoneF_registered=- otherZoneF_arrived=L otherZoneM_registered=-",
      }
    `);
  });

  it('note.forCamper', async () => {
    expect(await table((a, id) => outcome(c.services.note.forCamper(a, id)))).toMatchInlineSnapshot(`
      {
        "admin": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=ok sameZoneF_registered=404 otherZoneF_arrived=ok otherZoneM_registered=404",
        "church": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "churchBoys": "ownM_arrived=ok ownF_arrived=404 ownOther_arrived=ok ownM_registered=404 ownF_signedOut=404 ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "churchGirls": "ownM_arrived=404 ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "director": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=ok sameZoneF_registered=404 otherZoneF_arrived=ok otherZoneM_registered=404",
        "firstAid": "ownM_arrived=403 ownF_arrived=403 ownOther_arrived=403 ownM_registered=403 ownF_signedOut=403 ownM_cancelled=403 ownM_sentHome=403 sameZoneM_arrived=403 sameZoneF_registered=403 otherZoneF_arrived=403 otherZoneM_registered=403",
        "prayer": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
        "zoneNull": "ownM_arrived=404 ownF_arrived=404 ownOther_arrived=404 ownM_registered=404 ownF_signedOut=404 ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        "zoneYellow": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=ok sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
      }
    `);
  });

  it('note.add (category by role)', async () => {
    const cat = (a: Actor) => (a.role === 'firstAid' ? 'firstaid' : a.role === 'prayer' ? 'prayer' : 'note');
    expect(await table((a, id) => outcome(c.services.note.add(a, { camperId: id, body: 'x', category: cat(a) }))))
      .toMatchInlineSnapshot(`
        {
          "admin": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=ok sameZoneF_registered=404 otherZoneF_arrived=ok otherZoneM_registered=404",
          "church": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
          "churchBoys": "ownM_arrived=ok ownF_arrived=404 ownOther_arrived=ok ownM_registered=404 ownF_signedOut=404 ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
          "churchGirls": "ownM_arrived=404 ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
          "director": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=ok sameZoneF_registered=404 otherZoneF_arrived=ok otherZoneM_registered=404",
          "firstAid": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
          "prayer": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=ok ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=ok sameZoneM_arrived=ok sameZoneF_registered=ok otherZoneF_arrived=ok otherZoneM_registered=ok",
          "zoneNull": "ownM_arrived=404 ownF_arrived=404 ownOther_arrived=404 ownM_registered=404 ownF_signedOut=404 ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=404 sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
          "zoneYellow": "ownM_arrived=ok ownF_arrived=ok ownOther_arrived=ok ownM_registered=404 ownF_signedOut=ok ownM_cancelled=404 ownM_sentHome=404 sameZoneM_arrived=ok sameZoneF_registered=404 otherZoneF_arrived=404 otherZoneM_registered=404",
        }
      `);
  });

  it('revealContact: parent vs leader', async () => {
    expect(await table(async (a, id) =>
      `${await outcome(c.services.search.revealContact(a, id, 'parent'))}/${await outcome(c.services.search.revealContact(a, id, `${TARGETS[id]!.gender === 'female' ? 'female' : 'male'}-primary`))}`,
    )).toMatchInlineSnapshot(`
      {
        "admin": "ownM_arrived=ok/ok ownF_arrived=ok/ok ownOther_arrived=ok/ok ownM_registered=ok/ok ownF_signedOut=ok/ok ownM_cancelled=ok/ok ownM_sentHome=ok/ok sameZoneM_arrived=ok/ok sameZoneF_registered=ok/ok otherZoneF_arrived=ok/ok otherZoneM_registered=ok/ok",
        "church": "ownM_arrived=ok/ok ownF_arrived=ok/ok ownOther_arrived=ok/ok ownM_registered=ok/ok ownF_signedOut=ok/ok ownM_cancelled=ok/ok ownM_sentHome=ok/ok sameZoneM_arrived=404/ok sameZoneF_registered=404/404 otherZoneF_arrived=404/ok otherZoneM_registered=404/404",
        "churchBoys": "ownM_arrived=ok/ok ownF_arrived=404/ok ownOther_arrived=ok/ok ownM_registered=ok/ok ownF_signedOut=404/ok ownM_cancelled=ok/ok ownM_sentHome=ok/ok sameZoneM_arrived=404/ok sameZoneF_registered=404/404 otherZoneF_arrived=404/ok otherZoneM_registered=404/404",
        "churchGirls": "ownM_arrived=404/ok ownF_arrived=ok/ok ownOther_arrived=ok/ok ownM_registered=404/404 ownF_signedOut=ok/ok ownM_cancelled=404/404 ownM_sentHome=404/404 sameZoneM_arrived=404/ok sameZoneF_registered=404/404 otherZoneF_arrived=404/ok otherZoneM_registered=404/404",
        "director": "ownM_arrived=ok/ok ownF_arrived=ok/ok ownOther_arrived=ok/ok ownM_registered=ok/ok ownF_signedOut=ok/ok ownM_cancelled=ok/ok ownM_sentHome=ok/ok sameZoneM_arrived=ok/ok sameZoneF_registered=ok/ok otherZoneF_arrived=ok/ok otherZoneM_registered=ok/ok",
        "firstAid": "ownM_arrived=ok/ok ownF_arrived=ok/ok ownOther_arrived=ok/ok ownM_registered=ok/ok ownF_signedOut=ok/ok ownM_cancelled=ok/ok ownM_sentHome=ok/ok sameZoneM_arrived=ok/ok sameZoneF_registered=ok/ok otherZoneF_arrived=ok/ok otherZoneM_registered=ok/ok",
        "prayer": "ownM_arrived=403/403 ownF_arrived=403/403 ownOther_arrived=403/403 ownM_registered=403/403 ownF_signedOut=403/403 ownM_cancelled=403/403 ownM_sentHome=403/403 sameZoneM_arrived=403/403 sameZoneF_registered=403/403 otherZoneF_arrived=403/403 otherZoneM_registered=403/403",
        "zoneNull": "ownM_arrived=404/ok ownF_arrived=404/ok ownOther_arrived=404/ok ownM_registered=404/404 ownF_signedOut=404/ok ownM_cancelled=404/404 ownM_sentHome=404/404 sameZoneM_arrived=404/ok sameZoneF_registered=404/404 otherZoneF_arrived=404/ok otherZoneM_registered=404/404",
        "zoneYellow": "ownM_arrived=ok/ok ownF_arrived=ok/ok ownOther_arrived=ok/ok ownM_registered=ok/ok ownF_signedOut=ok/ok ownM_cancelled=ok/ok ownM_sentHome=ok/ok sameZoneM_arrived=ok/ok sameZoneF_registered=ok/ok otherZoneF_arrived=404/ok otherZoneM_registered=404/404",
      }
    `);
  });
});
