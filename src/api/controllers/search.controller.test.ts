import { describe, it, expect, beforeEach } from 'vitest';
import { makeSearchController } from './search.controller';
import { makeSearchService } from '../../services/search.service';
import { InMemoryPersonRepository, InMemoryChurchRepository } from '../../repositories/in-memory';
import type { Person } from '../../core/entities/person';
import type { Church } from '../../core/entities/church';
import type { Actor } from '../../core/entities/user';
import type { HttpRequest } from '../http/types';

/**
 * BRK-3 / BRK-5 (QA 2026-11-03), tested on the serialised response because that is what leaves
 * the server. A hit outside the actor's scope carries only the allow-listed fields; a hit inside
 * it still has the parent number masked for the roles with an audited reveal.
 */

const now = '2026-01-01T00:00:00.000Z';
const PARENT = '0499111222';

function person(over: Partial<Person>): Person {
  return {
    id: 'p',
    firstName: 'Zed',
    lastName: 'Walker',
    gender: 'male',
    kind: 'youth',
    grade: 9,
    churchId: 'c2',
    churchName: 'Grace',
    zone: 'Blue',
    medicalConditions: ['Asthma'],
    dietaryRequirements: [],
    consents: { medical: { granted: true, timestamp: now } },
    paymentStatus: 'paid',
    needsReview: false,
    lifecycle: 'arrived',
    atCamp: true,
    parentGuardianName: 'Robin Walker',
    parentPhone: PARENT,
    registrationCost: 111,
    registrationType: 'SECRETTIER',
    blueCardNumber: 'BLUE999',
    blueCardExpiry: '2030-01-01',
    discountCode: 'SECRETCODE',
    discountAmount: 222,
    amountPaidOverride: 333,
    refundAmount: 444,
    refundedAt: now,
    checkInHistory: [{ id: 'ci1', sessionId: 'SECRETSESSION', type: 'in', leaderName: 'SECRETLEADER', authorId: 'u9', timestamp: now }],
    signOutHistory: [{ id: 'so1', type: 'out', leaderName: 'SECRETLEADER', reason: 'SECRETREASON', authorId: 'u9', timestamp: now }],
    createdAt: now,
    updatedAt: now,
    ...over,
  } as unknown as Person;
}

const graceChurch = {
  id: 'c2',
  name: 'Grace',
  zone: 'Blue',
  contacts: {
    male: { primary: { name: 'Sam Leader', phone: '0411000001' }, backup: { name: '', phone: '' } },
    female: { primary: { name: 'Pat Leader', phone: '0411000002' }, backup: { name: '', phone: '' } },
  },
  createdAt: now,
  updatedAt: now,
} as unknown as Church;

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
}
function req(a: Actor): HttpRequest {
  return { ctx: { actor: a, token: 't' }, params: {}, query: { q: 'Zed' }, body: {} };
}

let ctrl: ReturnType<typeof makeSearchController>;
beforeEach(async () => {
  const people = new InMemoryPersonRepository();
  await people.init();
  const churches = new InMemoryChurchRepository();
  await churches.init();
  await churches.save(graceChurch);
  await people.save(person({ id: 'zed' }));
  ctrl = makeSearchController({ search: makeSearchService(people, churches) });
});

const hit = async (a: Actor) => {
  const out = (await ctrl.search(req(a))) as unknown as Array<{ camper: Record<string, unknown>; contacts: Array<{ name: string }> }>;
  expect(out).toHaveLength(1);
  return out[0]!;
};

describe("GET /search: a hit outside the actor's scope", () => {
  const outsiders: Array<[string, Actor]> = [
    ['another church', actor('church', { churchId: 'c1', churchName: 'Victory', zone: 'Yellow' })],
    ['another zone', actor('zoneLeader', { zone: 'Yellow' })],
    ['the other half of its own church', actor('church', { churchId: 'c2', churchName: 'Grace', zone: 'Blue', genderScope: 'female' })],
  ];

  for (const [name, a] of outsiders) {
    it(`${name}: only the allow-listed fields leave the server`, async () => {
      const r = await hit(a);
      expect(Object.keys(r.camper).sort()).toEqual(
        ['churchId', 'churchName', 'firstName', 'fullName', 'gender', 'grade', 'id', 'kind', 'lastName', 'zone'].sort(),
      );
      expect(JSON.stringify(r.camper)).not.toMatch(/SECRET|111|222|333|444|Asthma|Robin/);
      expect(JSON.stringify(r)).not.toContain(PARENT);
    });

    it(`${name}: the leader contacts the screen needs are kept`, async () => {
      expect((await hit(a)).contacts.map((c) => c.name)).toEqual(['Sam Leader', 'Pat Leader']);
    });
  }
});

describe("GET /search: a hit inside the actor's scope", () => {
  for (const [role, a] of [
    ['church', actor('church', { churchId: 'c2', churchName: 'Grace', zone: 'Blue' })],
    ['firstAid', actor('firstAid')],
  ] as const) {
    it(`${role}: full card data, parent number masked`, async () => {
      const r = await hit(a);
      expect(r.camper['medicalConditions']).toEqual(['Asthma']);
      expect(r.camper['parentPhone']).toBe('0499****22');
      expect(JSON.stringify(r)).not.toContain(PARENT);
    });
  }

  for (const [role, a] of [
    ['zoneLeader', actor('zoneLeader', { zone: 'Blue' })],
    ['director', actor('director')],
    ['admin', actor('admin')],
  ] as const) {
    it(`${role}: parent number stays plain`, async () => {
      expect((await hit(a)).camper['parentPhone']).toBe(PARENT);
    });
  }
});

// A-6 (Q4, 7 Nov 2026): money and blue-card fields stop at the DTO for firstAid and prayer.
const MONEY = /SECRETCODE|SECRETTIER|BLUE999|2030-01-01|"registrationCost":111|"discountAmount":222|"amountPaidOverride":333|"refundAmount":444/;
describe('GET /search: payment, refund, discount and blue-card fields by role (A-6)', () => {
  for (const [role, a] of [
    ['firstAid', actor('firstAid')],
    ['prayer', actor('prayer')],
  ] as const) {
    it(`${role}: all nulled, keys kept`, async () => {
      const r = await hit(a);
      expect(JSON.stringify(r.camper)).not.toMatch(MONEY);
      for (const k of ['amountPaidOverride', 'refundAmount', 'refundedAt', 'registrationType', 'registrationCost', 'discountCode', 'discountAmount', 'blueCardNumber', 'blueCardExpiry']) {
        expect(r.camper[k]).toBeNull();
      }
    });
  }

  for (const [role, a] of [
    ['church', actor('church', { churchId: 'c2', churchName: 'Grace', zone: 'Blue' })],
    ['zoneLeader', actor('zoneLeader', { zone: 'Blue' })],
    ['director', actor('director')],
    ['admin', actor('admin')],
  ] as const) {
    it(`${role}: unchanged`, async () => {
      const r = await hit(a);
      expect(r.camper['discountCode']).toBe('SECRETCODE');
      expect(r.camper['registrationType']).toBe('SECRETTIER');
      expect(r.camper['registrationCost']).toBe(111);
      expect(r.camper['blueCardNumber']).toBe('BLUE999');
    });
  }
});
