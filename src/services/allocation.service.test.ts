import { describe, it, expect } from 'vitest';
import { makeAllocationService } from './allocation.service';
import { InMemoryPersonRepository, InMemoryChurchRepository, InMemoryAllocationOverrideRepository } from '../repositories/in-memory';
import { UNALLOCATED_CHURCH_ID, UNALLOCATED_CHURCH_NAME } from './church-allocation';
import type { Person } from '../core/entities/person';
import type { Church } from '../core/entities/church';
import type { Actor } from '../core/entities/user';

const admin: Actor = { id: 'u1', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'Admin' };
const church: Actor = { id: 'u2', role: 'church', churchId: 'c1', churchName: 'Grace', zone: 'Blue', displayName: 'Grace' };

function person(over: Partial<Person>): Person {
  return {
    id: 'p1', firstName: 'John', lastName: 'Smith', gender: 'male', kind: 'youth',
    churchId: UNALLOCATED_CHURCH_ID, churchName: UNALLOCATED_CHURCH_NAME, zone: '',
    medicalConditions: [], dietaryRequirements: [], mobile: '0411928301',
    churchUnlistedNote: 'Hope Church, Ps Josh', consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null }, supervision: { granted: false, timestamp: null } },
    paymentStatus: 'unpaid', needsReview: false, lifecycle: 'registered', atCamp: false,
    checkInHistory: [], signOutHistory: [], createdAt: 't', updatedAt: 't', ...over,
  } as Person;
}

function grace(): Church {
  return {
    id: 'c1', name: 'Grace Point', zone: 'Blue',
    contacts: { male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } }, female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } } },
    createdAt: 't', updatedAt: 't',
  } as Church;
}

async function setup() {
  const people = new InMemoryPersonRepository(); await people.init();
  const churches = new InMemoryChurchRepository(); await churches.init();
  const overrides = new InMemoryAllocationOverrideRepository(); await overrides.init();
  await churches.save(grace());
  const svc = makeAllocationService(people, churches, overrides);
  return { people, churches, overrides, svc };
}

describe('allocation service', () => {
  it('lists unallocated registrants', async () => {
    const { people, svc } = await setup();
    await people.save(person({}));
    await people.save(person({ id: 'p2', churchId: 'c1', churchName: 'Grace Point' }));
    const un = await svc.listUnallocated(admin);
    expect(un.map((r) => r.id)).toEqual(['p1']);
    expect(un[0]!.churchUnlistedNote).toContain('Hope');
  });

  it('allocates an unallocated person and records an override', async () => {
    const { people, overrides, svc } = await setup();
    await people.save(person({}));
    const dto = await svc.allocate(admin, { personId: 'p1', churchId: 'c1' });
    expect(dto.kind).toBe('unallocated');
    const p = await people.findById('p1');
    expect(p!.churchId).toBe('c1');
    expect(p!.churchName).toBe('Grace Point');
    expect(p!.zone).toBe('Blue');
    expect(await overrides.findByPersonId('p1')).not.toBeNull();
  });

  it('records an override (kind=override) when reassigning a real church, keeping the original formChurch', async () => {
    const { people, svc } = await setup();
    await people.save(person({ churchId: 'cX', churchName: 'Wrong Church', zone: 'Red' }));
    const dto = await svc.allocate(admin, { personId: 'p1', churchId: 'c1' });
    expect(dto.kind).toBe('override');
    expect(dto.formChurch).toBe('Wrong Church');
  });

  it('undo of an unallocated allocation returns the person to the sentinel', async () => {
    const { people, svc } = await setup();
    await people.save(person({}));
    const dto = await svc.allocate(admin, { personId: 'p1', churchId: 'c1' });
    await svc.removeOverride(admin, dto.id);
    const p = await people.findById('p1');
    expect(p!.churchId).toBe(UNALLOCATED_CHURCH_ID);
    expect(await svc.listOverrides(admin)).toEqual([]);
  });

  it('forbids church logins', async () => {
    const { svc } = await setup();
    await expect(svc.listUnallocated(church)).rejects.toThrow();
    await expect(svc.allocate(church, { personId: 'p1', churchId: 'c1' })).rejects.toThrow();
  });

  it('rejects allocating to the sentinel church', async () => {
    const { people, svc } = await setup();
    await people.save(person({}));
    await expect(svc.allocate(admin, { personId: 'p1', churchId: UNALLOCATED_CHURCH_ID })).rejects.toThrow();
  });

  // Fix round 3 — the previous mapper-level test hand-typed the `??` vs `!== undefined` logic
  // instead of calling the real allocate(), so reverting the source fix would leave it passing.
  // This calls the real service and observes the real saved Person.
  it('does not bake a null-raw individual override into accommodationKindRaw on allocate', async () => {
    const { people, svc } = await setup(); // church 'c1' (Grace Point) has NO accommodationOverride
    await people.save(person({
      accommodationKind: 'classroom',       // resolved (an individual override applies)
      accommodationKindRaw: null,           // genuinely empty raw column
      accommodationOverride: 'classroom',
    }));
    await svc.allocate(admin, { personId: 'p1', churchId: 'c1' });
    const p = await people.findById('p1');
    expect(p!.accommodationKindRaw).toBeNull(); // NOT 'classroom' — the bug this guards against
    expect(p!.accommodationKind).toBeNull();
    expect(p!.accommodationOverride).toBe('classroom'); // untouched by allocation.service
  });
});
