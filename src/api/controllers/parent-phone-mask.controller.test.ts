import { describe, it, expect } from 'vitest';
import { makeCamperController } from './camper.controller';
import type { PersonService } from '../../services/person.service';
import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';
import type { HttpRequest } from '../http/types';

/**
 * The parent/guardian phone is masked at the DTO boundary for the roles listed in
 * `PARENT_PHONE_MASKED_ROLES` — `firstAid` since 2026-07-17, and **`church` since
 * 2026-08-03** (owner request).
 *
 * ⚠ WHY THIS IS TESTED AT THE CONTROLLER AND NOT THE SPA. The point of masking is not that
 * the number is hidden on screen — it is that seeing it REQUIRES the audited reveal endpoint,
 * which writes a `parent-contact` row to `reveal_audit` and lands in the compliance
 * workbook's "Sensitive Reveals" sheet. If the real number still travels in the `/campers`
 * JSON, a client-side blur is decoration: the value is one devtools tap away AND, far worse,
 * no audit row is ever written because nothing forced the reveal call. A regression here is
 * silent and invisible in the UI, which is exactly why it needs a test.
 */

const PARENT = '0411928301';

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return {
    id: 'a1',
    role,
    churchId: role === 'church' ? 'c1' : null,
    churchName: role === 'church' ? 'Victory' : null,
    zone: null,
    displayName: 'Someone',
    ...over,
  };
}

function person(): Person {
  return {
    id: 'p1',
    firstName: 'Ivy',
    lastName: 'Thompson',
    kind: 'student',
    churchId: 'c1',
    churchName: 'Victory',
    zone: 'Yellow',
    gender: 'female',
    grade: '10',
    lifecycle: 'arrived',
    atCamp: true,
    parentPhone: PARENT,
    parentGuardianName: 'Robin Thompson',
    medicalConditions: [],
    dietaryRequirements: [],
    consents: { medical: { granted: true }, photo: { granted: true } },
    checkInHistory: [],
    signOutHistory: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as unknown as Person;
}

function controller() {
  const p = person();
  const personSvc = {
    listCampers: async () => [p],
    list: async () => [p],
    getProfile: async () => ({ ...p, age: 16, lastSignOut: null }),
  } as unknown as PersonService;
  return makeCamperController({ person: personSvc });
}

function req(a: Actor): HttpRequest {
  return { ctx: { actor: a, token: 't' }, params: { id: 'p1' }, query: {}, body: {} };
}

describe('parent phone masking at the DTO boundary', () => {
  for (const role of ['church', 'firstAid'] as const) {
    it(`MASKS the parent phone for ${role} in the list response`, async () => {
      const out = (await controller().list(req(actor(role)))) as Array<{ parentPhone: string | null }>;
      expect(out[0]?.parentPhone).not.toBe(PARENT);
      expect(out[0]?.parentPhone).toContain('*');
    });

    it(`MASKS the parent phone for ${role} in the detail response`, async () => {
      const out = (await controller().get(req(actor(role)))) as { parentPhone: string | null };
      expect(out.parentPhone).not.toBe(PARENT);
      expect(out.parentPhone).toContain('*');
    });

    it(`never leaks the full ${role} parent number anywhere in the serialized detail DTO`, async () => {
      // Belt and braces: a future field that echoes the raw number would defeat the mask
      // without failing the assertions above.
      const out = await controller().get(req(actor(role)));
      expect(JSON.stringify(out)).not.toContain(PARENT);
    });
  }

  for (const role of ['admin', 'director', 'zoneLeader'] as const) {
    it(`leaves the parent phone in cleartext for ${role} (oversight roles are unaffected)`, async () => {
      const out = (await controller().get(req(actor(role)))) as { parentPhone: string | null };
      expect(out.parentPhone).toBe(PARENT);
    });
  }
});
