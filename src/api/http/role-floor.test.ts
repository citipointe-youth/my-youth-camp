import { describe, it, expect, beforeAll } from 'vitest';
import { buildContainer, type Container } from '../../container';
import { seedAll } from '../../data/seed';
import { env } from '../../config/env';
import { isAppError } from '../../core/errors/app-error';
import type { Actor } from '../../core/entities/user';
import type { Person } from '../../core/entities/person';
import type { UserRole } from '../../core/types/enums';
import { buildRoutes } from './router';
import type { HttpRequest } from './types';

/**
 * Route floor for the two lowest roles (`prayer`, `firstAid`). Every authenticated route is called
 * once per role with an empty body. It passes only if the route answers 403 or 404, or is on the
 * explicit allowlist below (routes the role is meant to reach). Anything else, including a 400 that
 * fires before any permission check, or a 2xx we did not list, fails and names the route.
 *
 * Added after the 4 Nov 2026 security review. Access is NOT changed here: the prayer login keeps
 * medical access by owner ruling, so `GET /campers`, `GET /campers/:id` and `GET /search*` stay on
 * the allowlist for prayer. A new route that either role can reach has to be added on purpose.
 *
 * Limits: the handler is called directly (no HTTP, no token), memory persistence only. Params that
 * name a person use one seeded person; any other param is a made-up id, so a route that looks the
 * thing up before checking the role would answer 404 and pass. This catches a missing check on
 * routes that check first; the per-service tests cover the rest.
 */

// Memory only. Never run this against a real database.
if (env.PERSISTENCE !== 'memory' || env.DATABASE_URL) {
  throw new Error('role-floor.test.ts must run with PERSISTENCE=memory and no DATABASE_URL');
}

type Role = Extract<UserRole, 'prayer' | 'firstAid'>;
const ROLES: Role[] = ['prayer', 'firstAid'];

// "<role> <METHOD> <path>" -> why the role may reach it.
const ALLOW: Record<string, string> = {
  'prayer GET /home': 'home tiles for every login',
  'firstAid GET /home': 'home tiles for every login',
  'prayer GET /auth/me': 'own session',
  'firstAid GET /auth/me': 'own session',
  'prayer POST /auth/logout': 'own session',
  'firstAid POST /auth/logout': 'own session',
  'prayer POST /accounts/me/password': 'own password (checks the body, not a permission)',
  'firstAid POST /accounts/me/password': 'own password (checks the body, not a permission)',
  'prayer GET /schedule': 'read-only schedule',
  'firstAid GET /schedule': 'read-only schedule',
  'prayer GET /notifications': 'own feed',
  'firstAid GET /notifications': 'own feed',
  'prayer GET /devotional/:day': 'read-only content',
  'firstAid GET /devotional/:day': 'read-only content',
  'prayer GET /push/config': 'own device alerts',
  'firstAid GET /push/config': 'own device alerts',
  'prayer POST /push/subscribe': 'own device alerts',
  'firstAid POST /push/subscribe': 'own device alerts',
  'prayer DELETE /push/subscribe': 'own device alerts',
  'firstAid DELETE /push/subscribe': 'own device alerts',
  'prayer POST /push/label': 'own device alerts',
  'firstAid POST /push/label': 'own device alerts',
  'prayer POST /push/test': 'own device alerts',
  'firstAid POST /push/test': 'own device alerts',
  // camper:read (both roles). Prayer keeps medical access by owner ruling 2026-11-04.
  'prayer GET /campers': 'camper:read (prayer keeps medical access: owner ruling)',
  'firstAid GET /campers': 'camper:read',
  'prayer GET /campers/:id': 'camper:read (prayer keeps medical access: owner ruling)',
  'firstAid GET /campers/:id': 'camper:read',
  'prayer GET /search': 'camper:read',
  'firstAid GET /search': 'camper:read',
  'prayer GET /search/contacts/:camperId': 'camper:read',
  'firstAid GET /search/contacts/:camperId': 'camper:read',
  'prayer GET /accounts/churches': 'canAccessChurch grants every church (REPORTED 4 Nov: no permission check)',
  'firstAid GET /accounts/churches': 'canAccessChurch grants every church (REPORTED 4 Nov: no permission check)',
  'prayer GET /checkin/sessions': 'session labels only, no person data',
  'firstAid GET /checkin/sessions': 'session labels only, no person data',
  'prayer GET /checkin/sessions/current': 'session labels only, no person data',
  'firstAid GET /checkin/sessions/current': 'session labels only, no person data',
  'prayer GET /checkin/sessions/allowed': 'tells the SPA which roster is writable',
  'firstAid GET /checkin/sessions/allowed': 'tells the SPA which roster is writable',
  'prayer GET /notifications/scheduled': 'REPORTED 4 Nov: no permission check',
  'firstAid GET /notifications/scheduled': 'REPORTED 4 Nov: no permission check',
  'firstAid POST /campers/:id/reveal-medicare': 'camper:read:sensitive (audited reveal)',
  'firstAid POST /attendance/sign-in': 'attendance:write',
  'firstAid POST /import/offline-signin': 'attendance:write (bulk sign-in from the paper sheet)',
  'firstAid POST /attendance/sign-out': 'attendance:write',
  // note:*:firstaid / note:*:prayer / note:read:student
  'prayer GET /notes/prayer': 'note:read:prayer',
  'prayer GET /notes/camper/:camperId': 'note:read:student',
  'firstAid GET /notes/firstaid': 'note:read:firstaid',
};

// Bodies for routes that validate the body before they check the role. An empty body would stop them
// at a 400 and hide a missing check.
const BODIES: Record<string, unknown> = {
  'POST /admin/mode': { campMode: 'at-camp' },
  'POST /admin/new-year': { year: 2099 },
  'POST /attendance/sign-in': { camperId: 'floor-person-1' },
  'POST /attendance/sign-out': { camperId: 'floor-person-1' },
  'POST /checkin': { camperId: 'floor-person-1', sessionId: '2026-09-28~pm', type: 'in' },
  'POST /notes': { camperId: 'floor-person-1', body: 'floor test' },
  'POST /notifications': { scope: 'camp', title: 'floor', body: 'floor test' },
  'POST /import/offline-signin': { csvData: 'a,b\n1,2' },
};

const NOW = '2026-09-01T00:00:00.000Z';
const PERSON_ID = 'floor-person-1';

function actorFor(role: Role): Actor {
  return { id: `floor-${role}`, role, churchId: null, churchName: null, zone: null, displayName: role };
}

// Person routes get the seeded person; every other param is a made-up id.
function fillParams(path: string): Record<string, string> {
  const personRoute = /^\/(campers|registrants|notes\/camper|search)/.test(path);
  const out: Record<string, string> = {};
  for (const m of path.matchAll(/:(\w+)/g)) {
    const name = m[1]!;
    out[name] = name === 'day' ? '1' : personRoute && /^(id|camperId)$/.test(name) ? PERSON_ID : 'floor-unknown-id';
  }
  return out;
}

let container: Container;

beforeAll(async () => {
  container = await buildContainer();
  await seedAll(container);
  const st = await container.repos.settings.getSingleton();
  await container.repos.settings.saveSingleton({ ...st!, checkInDays: ['2026-09-28'] }); // so /checkin has a real session
  await container.repos.people.save({
    id: PERSON_ID, firstName: 'Floor', lastName: 'Test', kind: 'student', churchId: 'floor-church', churchName: 'Floor',
    zone: 'Yellow', gender: 'female', grade: '10', lifecycle: 'arrived', atCamp: true,
    medicalConditions: [], dietaryRequirements: [], consents: {}, checkInHistory: [], signOutHistory: [],
    createdAt: NOW, updatedAt: NOW,
  } as unknown as Person);
});

describe('role floor: prayer and firstAid', () => {
  it('every authenticated route is 403/404 or on the allowlist', async () => {
    const routes = buildRoutes(container.services).filter((r) => r.auth);
    expect(routes.length).toBeGreaterThan(80);
    const bad: string[] = [];
    const reached = new Set<string>();
    for (const role of ROLES) {
      for (const r of routes) {
        const key = `${role} ${r.method} ${r.path}`;
        const req: HttpRequest = {
          ctx: { actor: actorFor(role), token: 'floor' }, params: fillParams(r.path), query: {}, body: BODIES[`${r.method} ${r.path}`] ?? {},
        };
        let outcome: string;
        try {
          if ('bufferHandler' in r) await r.bufferHandler(req); else await r.handler(req);
          outcome = 'ok';
        } catch (e) {
          outcome = isAppError(e) ? String(e.statusCode) : `throw:${(e as Error).name}`;
        }
        if (outcome === '403' || outcome === '404') continue;
        reached.add(key);
        if (!ALLOW[key]) bad.push(`${key} -> ${outcome}`);
      }
    }
    for (const k of Object.keys(ALLOW)) if (!reached.has(k)) bad.push(`${k}: allowlisted but now 403/404, drop it from ALLOW`);
    expect(bad).toEqual([]);
  });
});
