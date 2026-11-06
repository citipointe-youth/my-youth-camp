import { describe, it, expect } from 'vitest';
import { makeCamperController } from './camper.controller';
import type { PersonService } from '../../services/person.service';
import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';
import type { HttpRequest } from '../http/types';

/**
 * A-6 (ruling Q4, 7 Nov 2026): payment, refund, discount and blue-card fields (plus the verbatim
 * `registrationType` ticket text, IA OQ-17) are nulled in the `/campers` DTO for firstAid and
 * prayer ONLY. Church (Q4, standing) and the oversight roles are unchanged. Tested on the
 * serialised response because that is what leaves the server.
 */

const STRIPPED = [
  'amountPaidOverride', 'refundAmount', 'refundedAt', 'registrationType', 'registrationCost',
  'discountCode', 'discountAmount', 'blueCardNumber', 'blueCardExpiry',
] as const;
const MONEY = /SECRETCODE|SECRETTIER|BLUE999|2030-01-01|"registrationCost":111|"discountAmount":222|"amountPaidOverride":333|"refundAmount":444/;

function actor(role: Actor['role']): Actor {
  return {
    id: 'a1', role, churchId: role === 'church' ? 'c1' : null,
    churchName: role === 'church' ? 'Victory' : null, zone: null, displayName: 'Someone',
  };
}

const p = {
  id: 'p1', firstName: 'Ivy', lastName: 'Thompson', kind: 'student', churchId: 'c1', churchName: 'Victory',
  zone: 'Yellow', gender: 'female', grade: '10', lifecycle: 'arrived', atCamp: true,
  medicalConditions: [], dietaryRequirements: [],
  consents: { medical: { granted: true } },
  registrationType: 'SECRETTIER', registrationCost: 111, discountCode: 'SECRETCODE', discountAmount: 222,
  amountPaidOverride: 333, refundAmount: 444, refundedAt: '2026-01-01T00:00:00.000Z',
  blueCardNumber: 'BLUE999', blueCardExpiry: '2030-01-01',
  checkInHistory: [], signOutHistory: [],
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as Person;

const ctrl = makeCamperController({
  person: {
    listCampers: async () => [p],
    list: async () => [p],
    getProfile: async () => ({ ...p, age: 16, lastSignOut: null }),
  } as unknown as PersonService,
});

const req = (a: Actor, query: Record<string, string> = {}): HttpRequest =>
  ({ ctx: { actor: a, token: 't' }, params: { id: 'p1' }, query, body: {} });

type Row = Record<string, unknown>;
const calls: Array<[string, (a: Actor) => Promise<Row>]> = [
  ['GET /campers', async (a) => ((await ctrl.list(req(a))) as unknown as Row[])[0]!],
  ['GET /campers?scope=all', async (a) => ((await ctrl.list(req(a, { scope: 'all' }))) as unknown as Row[])[0]!],
  ['GET /campers/:id', async (a) => (await ctrl.get(req(a))) as Row],
];

describe('/campers money and blue-card strip by role (A-6)', () => {
  for (const [name, call] of calls) {
    for (const role of ['firstAid', 'prayer'] as const) {
      it(`${name}: ${role} gets every field nulled, keys kept`, async () => {
        const out = await call(actor(role));
        expect(JSON.stringify(out)).not.toMatch(MONEY);
        for (const k of STRIPPED) expect(out[k], k).toBeNull();
      });
    }
    for (const role of ['church', 'zoneLeader', 'director', 'admin'] as const) {
      it(`${name}: ${role} is unchanged`, async () => {
        const out = await call(actor(role));
        expect(out['discountCode']).toBe('SECRETCODE');
        expect(out['registrationType']).toBe('SECRETTIER');
        expect(out['registrationCost']).toBe(111);
        expect(out['blueCardNumber']).toBe('BLUE999');
        expect(out['refundAmount']).toBe(444);
      });
    }
  }
});
