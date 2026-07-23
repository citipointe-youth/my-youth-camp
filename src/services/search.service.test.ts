import { describe, it, expect, beforeEach } from 'vitest';
import { makeSearchService } from './search.service';
import { InMemoryPersonRepository, InMemoryChurchRepository } from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Church } from '../core/entities/church';
import type { Actor } from '../core/entities/user';

// ---------------------------------------------------------------------------
// search.service — Bug 1 (2026-07-17): the Student Info masked-contact reveal was swapped.
// Leader contacts are now shown PLAINLY (resolveContacts returns them unmasked, no reveal
// needed); the parent/guardian number is now the one masked + gated behind revealContact
// (a synthetic 'parent' contact role). The general "Other churches" search() path is
// untouched — it must keep masking leader contacts, since that screen's reveal flow is a
// separate feature.
// ---------------------------------------------------------------------------

function person(over: Partial<Person> = {}): Person {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'p1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    gender: 'female',
    kind: 'youth',
    churchId: 'c1',
    churchName: 'Victory',
    zone: 'Yellow',
    medicalConditions: [],
    dietaryRequirements: [],
    consents: {
      medical: { granted: false, timestamp: null },
      media: { granted: false, timestamp: null },
      supervision: { granted: false, timestamp: null },
    },
    paymentStatus: 'unpaid',
    needsReview: false,
    lifecycle: 'arrived',
    atCamp: true,
    checkInHistory: [],
    signOutHistory: [],
    createdAt: now,
    updatedAt: now,
    parentGuardianName: 'Grace Lovelace',
    parentPhone: '0499111222',
    ...over,
  };
}

function church(over: Partial<Church> = {}): Church {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'c1',
    name: 'Victory',
    zone: 'Yellow',
    contacts: {
      male: {
        primary: { name: 'Sam Male', phone: '0411000001' },
        backup: { name: '', phone: '' },
      },
      female: {
        primary: { name: 'Pat Female', phone: '0411000002' },
        backup: { name: '', phone: '' },
      },
    },
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
}

let people: InMemoryPersonRepository;
let churches: InMemoryChurchRepository;
let svc: ReturnType<typeof makeSearchService>;

beforeEach(async () => {
  people = new InMemoryPersonRepository();
  await people.init();
  churches = new InMemoryChurchRepository();
  await churches.init();
  await churches.save(church());
  await people.save(person());
  svc = makeSearchService(people, churches);
});

describe('search.service: resolveContacts (Student Info)', () => {
  it('returns the ministry leader contact UNMASKED (plain phone, no reveal needed)', async () => {
    const contacts = await svc.resolveContacts(actor('firstAid'), 'p1');
    const leader = contacts.find((c) => c.role === 'female-primary');
    expect(leader).toBeDefined();
    expect(leader?.phone).toBe('0411000002'); // raw, not maskPhone()'d
  });

  it('returns the parent/guardian contact MASKED, as a synthetic "parent" role', async () => {
    const contacts = await svc.resolveContacts(actor('firstAid'), 'p1');
    const parent = contacts.find((c) => c.role === 'parent');
    expect(parent).toBeDefined();
    expect(parent?.name).toBe('Grace Lovelace');
    expect(parent?.phone).toBe('0499****22'); // maskPhone() shape: first 4 + **** + last 2
  });

  it('omits the parent contact when the person has no parentPhone', async () => {
    await people.save(person({ id: 'p2', parentPhone: null }));
    const contacts = await svc.resolveContacts(actor('firstAid'), 'p2');
    expect(contacts.find((c) => c.role === 'parent')).toBeUndefined();
  });
});

describe('search.service: revealContact("parent") — audited parent reveal', () => {
  it('reveals the real parent phone number, gated on camper:read:sensitive', async () => {
    const revealed = await svc.revealContact(actor('firstAid'), 'p1', 'parent');
    expect(revealed.phone).toBe('0499111222');
    expect(revealed.name).toBe('Grace Lovelace');
  });

  it('throws NotFoundError when the person has no parent phone to reveal', async () => {
    await people.save(person({ id: 'p3', parentPhone: null }));
    await expect(svc.revealContact(actor('firstAid'), 'p3', 'parent')).rejects.toThrow();
  });

  it('still reveals a church leader contact by role (unrelated existing path, unaffected)', async () => {
    const revealed = await svc.revealContact(actor('firstAid'), 'p1', 'female-primary');
    expect(revealed.phone).toBe('0411000002');
  });
});

describe('search.service: search() — general "Other churches" lookup stays masked', () => {
  it('masks leader phone numbers in search results (unaffected by the Bug 1 swap)', async () => {
    const results = await svc.search(actor('firstAid'), 'Ada');
    const match = results.find((r) => r.camper.id === 'p1');
    expect(match).toBeDefined();
    const leader = match?.contacts.find((c) => c.role === 'female-primary');
    expect(leader?.phone).toBe('0411****02');
  });
});

describe('search.service: search() — church "All churches" cross-scope (items 6/10)', () => {
  it('a gender-scoped church login finds other-gender / other-church campers, sensitive data REDACTED', async () => {
    await people.save(
      person({
        id: 'pOther',
        firstName: 'Zed',
        churchId: 'c2',
        churchName: 'Grace',
        zone: 'Blue',
        gender: 'male',
        medicalConditions: ['Asthma'],
        dietaryRequirements: ['Nuts'],
        parentPhone: '0400999888',
      }),
    );
    const boys = actor('church', { churchId: 'c1', churchName: 'Victory', zone: 'Yellow', genderScope: 'male' });

    // p1 is female of the SAME church (other gender → outside this login's scope).
    const ada = (await svc.search(boys, 'Ada')).find((r) => r.camper.id === 'p1');
    expect(ada).toBeDefined(); // item 10: visible despite being the other gender
    expect(ada?.camper.parentPhone ?? null).toBeNull(); // item 6: redacted
    expect(ada?.camper.medicalConditions).toEqual([]); // item 6: redacted

    // pOther belongs to another church entirely.
    const zed = (await svc.search(boys, 'Zed')).find((r) => r.camper.id === 'pOther');
    expect(zed).toBeDefined();
    expect(zed?.camper.medicalConditions).toEqual([]);
    expect(zed?.camper.dietaryRequirements).toEqual([]);
    expect(zed?.camper.parentPhone ?? null).toBeNull();
  });

  it('does NOT redact a camper within the login’s own church + gender scope', async () => {
    await people.save(
      person({
        id: 'pMine',
        firstName: 'Ben',
        gender: 'male',
        churchId: 'c1',
        churchName: 'Victory',
        zone: 'Yellow',
        medicalConditions: ['EpiPen'],
        parentPhone: '0400111000',
      }),
    );
    const boys = actor('church', { churchId: 'c1', churchName: 'Victory', zone: 'Yellow', genderScope: 'male' });
    const ben = (await svc.search(boys, 'Ben')).find((r) => r.camper.id === 'pMine');
    expect(ben?.camper.medicalConditions).toEqual(['EpiPen']); // full detail for own scope
    expect(ben?.camper.parentPhone).toBe('0400111000');
  });
});
