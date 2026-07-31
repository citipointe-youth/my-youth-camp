import { describe, it, expect, beforeEach } from 'vitest';
import { makeRevealAuditService } from './reveal-audit.service';
import {
  InMemoryRevealAuditRepository,
  InMemoryUserRepository,
} from '../repositories/in-memory/in-memory.repositories';
import type { Actor, User } from '../core/entities/user';
import type { Person } from '../core/entities/person';

const actor: Actor = {
  id: 'u-boys',
  role: 'church',
  churchId: 'c1',
  churchName: 'Victory Church',
  zone: 'Yellow',
  displayName: 'Victory Church',
  genderScope: 'male',
};

const person = {
  id: 'p1',
  firstName: 'Ivy',
  lastName: 'Thompson',
  churchName: 'Victory Church',
} as Pick<Person, 'id' | 'firstName' | 'lastName' | 'churchName'>;

function user(over: Partial<User>): User {
  return {
    id: 'u-boys',
    username: 'b-victory',
    role: 'church',
    displayName: 'Victory Church',
    churchId: 'c1',
    zone: 'Yellow',
    active: true,
    passwordHash: null,
    createdAt: new Date().toISOString(),
    ...over,
  } as User;
}

describe('reveal audit service', () => {
  let repo: InMemoryRevealAuditRepository;
  let users: InMemoryUserRepository;

  beforeEach(async () => {
    repo = new InMemoryRevealAuditRepository();
    users = new InMemoryUserRepository();
    await Promise.all([repo.init(), users.init()]);
    await users.save(user({}));
  });

  it('records who revealed, whose record, and when — but never a revealed value', async () => {
    const svc = makeRevealAuditService(repo, users);
    const row = await svc.record(actor, { kind: 'medicare', person, initials: ' SD ' });

    expect(row).not.toBeNull();
    expect(row!.kind).toBe('medicare');
    expect(row!.personName).toBe('Ivy Thompson');
    expect(row!.churchName).toBe('Victory Church');
    expect(row!.actorId).toBe('u-boys');
    expect(row!.actorInitials).toBe('SD'); // trimmed
    expect(row!.contactRole).toBeNull();
    expect(row!.createdAt).toBeTruthy();

    // The point of the whole feature: no field can carry the number that was revealed.
    // If someone adds one, this fails and they have to justify it.
    expect(Object.keys(row!).sort()).toEqual(
      [
        'actorId', 'actorInitials', 'actorRole', 'actorUsername', 'churchName',
        'contactRole', 'createdAt', 'id', 'kind', 'personId', 'personName',
      ].sort(),
    );
  });

  it('resolves the ACCOUNT username, not the display name', async () => {
    // A church displayName is the church name and is identical for the b- and g- logins, so
    // recording it alone could not answer "which login revealed this".
    const svc = makeRevealAuditService(repo, users);
    const row = await svc.record(actor, { kind: 'medicare', person });
    expect(row!.actorUsername).toBe('b-victory');
  });

  it('falls back to the display name when the user lookup is unavailable', async () => {
    const svc = makeRevealAuditService(repo); // no user repo
    const row = await svc.record(actor, { kind: 'medicare', person });
    expect(row!.actorUsername).toBe('Victory Church');
  });

  it('never throws when the write fails — the reveal must not be blocked by the audit', async () => {
    const broken = {
      ...new InMemoryRevealAuditRepository(),
      save: async () => {
        throw new Error('db down');
      },
    } as unknown as InMemoryRevealAuditRepository;
    const svc = makeRevealAuditService(broken, users);
    await expect(svc.record(actor, { kind: 'medicare', person })).resolves.toBeNull();
  });

  it('keeps the contact slot on a contact reveal and lists newest-first', async () => {
    const svc = makeRevealAuditService(repo, users);
    await svc.record(actor, { kind: 'parent-contact', person, contactRole: 'parent' });
    await svc.record(actor, { kind: 'leader-contact', person, contactRole: 'male-primary' });

    const all = await svc.list();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.contactRole)).toContain('male-primary');
    expect(all.map((r) => r.kind).sort()).toEqual(['leader-contact', 'parent-contact']);
  });
});
