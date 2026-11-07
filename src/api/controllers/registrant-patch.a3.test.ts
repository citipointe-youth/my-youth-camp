import { describe, it, expect } from 'vitest';
import { makeRegistrantController } from './registrant.controller';
import { makePersonService } from '../../services/person.service';
import { InMemoryPersonRepository } from '../../repositories/in-memory';
import { isAppError } from '../../core/errors/app-error';
import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';

/**
 * A3 (Phase C, 7 Nov 2026): PATCH /registrants/:id body → stored Person, pinned BEFORE the
 * interpreter moved from the controller into PersonService. Bodies are the ones the SPA sends
 * (index.html markReg, indivSave, status, refund, needsReview, _stuSavePlan, church move) plus
 * the legacy aliases and keys that must be dropped. Snapshots were generated on the pre-A3 code.
 */

const NOW = '2026-09-01T00:00:00.000Z';
const ACTORS: Record<string, Actor> = {
  church: { id: 'u-c', role: 'church', churchId: 'c1', churchName: 'Victory', zone: 'Yellow', displayName: 'Church' },
  director: { id: 'u-d', role: 'director', churchId: null, churchName: null, zone: null, displayName: 'Dir' },
  admin: { id: 'u-a', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin' },
};

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'p1', firstName: 'Ivy', lastName: 'Thompson', kind: 'youth', churchId: 'c1', churchName: 'Victory',
    zone: 'Yellow', gender: 'female', grade: 10, lifecycle: 'registered', atCamp: false,
    medicalConditions: ['old'], dietaryRequirements: ['old'], consents: {}, checkInHistory: [], signOutHistory: [],
    blueCardNumber: null, parentGuardianName: 'Dad', createdAt: NOW, updatedAt: NOW, ...over,
  } as unknown as Person;
}

const BODIES: Array<[string, Record<string, unknown>, Partial<Person>?]> = [
  ['blueCard on', { blueCardCollected: true }],
  ['blueCard on keeps number', { blueCardCollected: true }, { blueCardNumber: 'BC9' }],
  ['blueCard off', { blueCardCollected: false }, { blueCardNumber: 'BC9' }],
  ['blueCard number wins', { blueCardNumber: 'X1', blueCardCollected: false, blueCardExpiry: '2027-01-01' }],
  ['indivSave', { accommodationOverride: 'classroom', amountPaidOverride: '120' }],
  ['indivSave clear', { accommodationOverride: null, amountPaidOverride: null }, { accommodationOverride: 'tent', amountPaidOverride: 5 } as Partial<Person>],
  ['cancel', { status: 'cancelled' }],
  ['uncancel', { status: 'registered' }, { lifecycle: 'cancelled', cancelledAt: NOW } as Partial<Person>],
  ['refund', { refundAmount: 50 }],
  ['review', { needsReview: false, needsReviewReason: null }, { needsReview: true, needsReviewReason: 'x' } as Partial<Person>],
  ['stuSavePlan', { firstName: 'Ava', lastName: 'Lee', gender: 'male', grade: 11, medical: 'asthma', dietary: 'vegan' }],
  ['blank medical', { medical: '', dietary: null }],
  ['church move', { churchId: 'c2', churchName: 'Grace', zone: 'Yellow' }],
  ['aliases', { parentName: 'Mum', kind: 'leader', accommodationKind: 'tent' }],
  ['money', { discountAmount: 10, amountPaid: 200, feesAmount: 1, taxAmount: 2, ticketNumber: 'T1', invoiceNumber: 'I1' }],
  ['dropped keys', { otherMedications: 'x', atCamp: true, checkInHistory: [{}], groupId: 'g', email: 'e@x' }],
  ['bad override', { accommodationOverride: 'bogus' }],
  ['negative refund', { refundAmount: -1 }],
  ['blank name', { firstName: ' ' }],
];

const PICK = [
  'firstName', 'lastName', 'gender', 'grade', 'kind', 'churchId', 'churchName', 'zone', 'lifecycle', 'atCamp',
  'medicalConditions', 'dietaryRequirements', 'parentGuardianName', 'blueCardNumber', 'blueCardExpiry',
  'accommodationKind', 'accommodationKindRaw', 'accommodationOverride', 'amountPaidOverride', 'refundAmount',
  'refundedAt', 'cancelledAt', 'needsReview', 'needsReviewReason', 'discountAmount', 'amountPaid', 'feesAmount',
  'taxAmount', 'ticketNumber', 'invoiceNumber', 'otherMedications', 'groupId', 'email', 'signOutHistory',
] as const;

async function run(actor: Actor, body: Record<string, unknown>, seed?: Partial<Person>): Promise<string> {
  const repo = new InMemoryPersonRepository();
  await repo.init();
  await repo.save(person(seed));
  const ctl = makeRegistrantController({ person: makePersonService(repo) });
  try {
    await ctl.update({ ctx: { actor, token: 't' }, params: { id: 'p1' }, query: {}, body });
  } catch (e) {
    return isAppError(e) ? `${e.statusCode}` : `throw ${(e as Error).name}`;
  }
  const stored = (await repo.findById('p1'))! as unknown as Record<string, unknown>;
  const before = person(seed) as unknown as Record<string, unknown>;
  const changed = PICK.filter((k) => JSON.stringify(stored[k]) !== JSON.stringify(before[k]))
    .map((k) => `${k}=${JSON.stringify(stored[k]).replace(/"20\d\d-[^"]+Z"/g, '<ts>')}`);
  return changed.join(' ') || '(no change)';
}

describe('A3 PATCH /registrants/:id body → stored person (pinned pre-refactor)', () => {
  it('every SPA body × church/director/admin', async () => {
    const out: Record<string, string> = {};
    for (const [name, body, seed] of BODIES) {
      for (const [an, a] of Object.entries(ACTORS)) out[`${name} / ${an}`] = await run(a, body, seed);
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "aliases / admin": "kind="leader" parentGuardianName="Mum" accommodationKind="tent" accommodationKindRaw="tent"",
        "aliases / church": "kind="leader" parentGuardianName="Mum" accommodationKind="tent" accommodationKindRaw="tent"",
        "aliases / director": "kind="leader" parentGuardianName="Mum" accommodationKind="tent" accommodationKindRaw="tent"",
        "bad override / admin": "400",
        "bad override / church": "400",
        "bad override / director": "400",
        "blank medical / admin": "medicalConditions=[] dietaryRequirements=[]",
        "blank medical / church": "medicalConditions=[] dietaryRequirements=[]",
        "blank medical / director": "medicalConditions=[] dietaryRequirements=[]",
        "blank name / admin": "throw ZodError",
        "blank name / church": "throw ZodError",
        "blank name / director": "throw ZodError",
        "blueCard number wins / admin": "blueCardNumber="X1" blueCardExpiry="2027-01-01"",
        "blueCard number wins / church": "blueCardNumber="X1" blueCardExpiry="2027-01-01"",
        "blueCard number wins / director": "blueCardNumber="X1" blueCardExpiry="2027-01-01"",
        "blueCard off / admin": "blueCardNumber=null",
        "blueCard off / church": "blueCardNumber=null",
        "blueCard off / director": "blueCardNumber=null",
        "blueCard on / admin": "blueCardNumber="collected"",
        "blueCard on / church": "blueCardNumber="collected"",
        "blueCard on / director": "blueCardNumber="collected"",
        "blueCard on keeps number / admin": "(no change)",
        "blueCard on keeps number / church": "(no change)",
        "blueCard on keeps number / director": "(no change)",
        "cancel / admin": "lifecycle="cancelled" cancelledAt=<ts>",
        "cancel / church": "lifecycle="cancelled" cancelledAt=<ts>",
        "cancel / director": "lifecycle="cancelled" cancelledAt=<ts>",
        "church move / admin": "churchId="c2" churchName="Grace"",
        "church move / church": "(no change)",
        "church move / director": "churchId="c2" churchName="Grace"",
        "dropped keys / admin": "(no change)",
        "dropped keys / church": "(no change)",
        "dropped keys / director": "(no change)",
        "indivSave / admin": "accommodationOverride="classroom" amountPaidOverride=120",
        "indivSave / church": "accommodationOverride="classroom" amountPaidOverride=120",
        "indivSave / director": "accommodationOverride="classroom" amountPaidOverride=120",
        "indivSave clear / admin": "accommodationOverride=null amountPaidOverride=null",
        "indivSave clear / church": "accommodationOverride=null amountPaidOverride=null",
        "indivSave clear / director": "accommodationOverride=null amountPaidOverride=null",
        "money / admin": "discountAmount=10 amountPaid=200 feesAmount=1 taxAmount=2 ticketNumber="T1" invoiceNumber="I1"",
        "money / church": "discountAmount=10 amountPaid=200 feesAmount=1 taxAmount=2 ticketNumber="T1" invoiceNumber="I1"",
        "money / director": "discountAmount=10 amountPaid=200 feesAmount=1 taxAmount=2 ticketNumber="T1" invoiceNumber="I1"",
        "negative refund / admin": "400",
        "negative refund / church": "400",
        "negative refund / director": "400",
        "refund / admin": "refundAmount=50 refundedAt=<ts>",
        "refund / church": "refundAmount=50 refundedAt=<ts>",
        "refund / director": "refundAmount=50 refundedAt=<ts>",
        "review / admin": "needsReview=false needsReviewReason=null",
        "review / church": "needsReview=false needsReviewReason=null",
        "review / director": "needsReview=false needsReviewReason=null",
        "stuSavePlan / admin": "firstName="Ava" lastName="Lee" gender="male" grade=11 medicalConditions=["asthma"] dietaryRequirements=["vegan"]",
        "stuSavePlan / church": "firstName="Ava" lastName="Lee" grade=11 medicalConditions=["asthma"] dietaryRequirements=["vegan"]",
        "stuSavePlan / director": "firstName="Ava" lastName="Lee" gender="male" grade=11 medicalConditions=["asthma"] dietaryRequirements=["vegan"]",
        "uncancel / admin": "lifecycle="registered" cancelledAt=null",
        "uncancel / church": "lifecycle="registered" cancelledAt=null",
        "uncancel / director": "lifecycle="registered" cancelledAt=null",
      }
    `);
  });
});

describe('A3 PersonService interface', () => {
  async function svc() {
    const repo = new InMemoryPersonRepository();
    await repo.init();
    await repo.save(person());
    return { repo, svc: makePersonService(repo) };
  }

  it('update itself refuses a bad override or a negative/non-finite amount (was controller-only)', async () => {
    const { svc: s } = await svc();
    for (const patch of [{ accommodationOverride: 'bogus' }, { refundAmount: -1 }, { amountPaidOverride: Number.NaN }]) {
      await expect(s.update(ACTORS.admin!, 'p1', patch as Partial<Person>)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('patch maps the wire aliases and drops unknown keys', async () => {
    const { repo, svc: s } = await svc();
    await s.patch(ACTORS.admin!, 'p1', { status: 'cancelled', medical: 'asthma', otherMedications: 'x' });
    const p = (await repo.findById('p1'))!;
    expect(p).toMatchObject({ lifecycle: 'cancelled', medicalConditions: ['asthma'] });
    expect(p.otherMedications).toBeUndefined();
  });

  it('a role without registrant:write now gets 403 before any body check (was 400 first)', async () => {
    const { svc: s } = await svc();
    const firstAid = { ...ACTORS.admin!, role: 'firstAid' } as Actor;
    await expect(s.patch(firstAid, 'p1', { accommodationOverride: 'bogus' })).rejects.toMatchObject({ statusCode: 403 });
  });
});
