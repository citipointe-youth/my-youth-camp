import { describe, it, expect, beforeEach } from 'vitest';
import { makeAccountService, type AccountService } from './account.service';
import {
  InMemoryUserRepository,
  InMemoryChurchRepository,
  InMemoryPersonRepository,
} from '../repositories/in-memory';
import type { Actor, User } from '../core/entities/user';
import type { Church } from '../core/entities/church';
import type { Person } from '../core/entities/person';
import { hashPassword } from '../utils/crypto';
import { UnauthorizedError } from '../core/errors/app-error';

// ---------------------------------------------------------------------------
// AccountService.updateChurch — church rename propagation.
// A Person carries a denormalized `churchName` snapshot alongside `churchId`
// (person.ts). Renaming a church must re-stamp that snapshot on every attached
// person, otherwise rosters/exports keep showing the old name. Edge case, but
// the fix is cheap and keeps the two name copies consistent.
// ---------------------------------------------------------------------------

const NOW = '2026-01-01T00:00:00.000Z';

function admin(): Actor {
  return { id: 'u', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'admin' };
}

function church(over: Partial<Church> = {}): Church {
  return {
    id: 'c1',
    name: 'Victory Church',
    zone: 'Yellow',
    contacts: {
      male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
      female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'p',
    firstName: 'Ada',
    lastName: 'Lovelace',
    gender: 'female',
    kind: 'youth',
    churchId: 'c1',
    churchName: 'Victory Church',
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
    lifecycle: 'registered',
    atCamp: false,
    checkInHistory: [],
    signOutHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('AccountService.updateChurch — rename propagation', () => {
  let users: InMemoryUserRepository;
  let churches: InMemoryChurchRepository;
  let people: InMemoryPersonRepository;
  let svc: AccountService;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    churches = new InMemoryChurchRepository();
    people = new InMemoryPersonRepository();
    await Promise.all([users.init(), churches.init(), people.init()]);
    await churches.save(church({ id: 'c1', name: 'Victory Church' }));
    await churches.save(church({ id: 'c2', name: 'Grace Point' }));
    await people.save(person({ id: 'p1', churchId: 'c1', churchName: 'Victory Church' }));
    await people.save(person({ id: 'p2', churchId: 'c1', churchName: 'Victory Church' }));
    await people.save(person({ id: 'p3', churchId: 'c2', churchName: 'Grace Point' }));
    svc = makeAccountService(users, churches, people);
  });

  it('re-stamps churchName on every person attached to the renamed church', async () => {
    await svc.updateChurch(admin(), 'c1', { name: 'Victory Community Church' });

    const p1 = await people.findById('p1');
    const p2 = await people.findById('p2');
    expect(p1?.churchName).toBe('Victory Community Church');
    expect(p2?.churchName).toBe('Victory Community Church');
  });

  it('leaves people attached to other churches untouched', async () => {
    await svc.updateChurch(admin(), 'c1', { name: 'Victory Community Church' });

    const p3 = await people.findById('p3');
    expect(p3?.churchName).toBe('Grace Point');
  });

  it('does not rewrite people when the update does not change the name', async () => {
    await svc.updateChurch(admin(), 'c1', { contactPhone: '0400000000' });

    const p1 = await people.findById('p1');
    expect(p1?.churchName).toBe('Victory Church');
    expect(p1?.updatedAt).toBe(NOW); // untouched
  });
});

// ---------------------------------------------------------------------------
// mustChangePassword — 2026-07-11 public-repo privacy audit follow-up.
// setPassword (admin reset) must flag the account; only a successful
// self-service changeOwnPassword clears it.
// ---------------------------------------------------------------------------

describe('AccountService — mustChangePassword', () => {
  let users: InMemoryUserRepository;
  let svc: AccountService;
  let leader: User;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    const churches = new InMemoryChurchRepository();
    const people = new InMemoryPersonRepository();
    await Promise.all([users.init(), churches.init(), people.init()]);
    leader = await users.save({
      id: 'u-leader', firstName: 'Grace', lastName: 'Point', username: 'gracepoint', role: 'church',
      churchId: null, churchName: null, zone: null, status: 'active',
      passwordHash: await hashPassword('correcthorse1'),
      createdAt: NOW, updatedAt: NOW,
    });
    svc = makeAccountService(users, churches, people);
  });

  it('setPassword (admin reset) flags mustChangePassword', async () => {
    await svc.setPassword(admin(), { userId: leader.id, password: 'newtemp123' });
    const updated = await users.findById(leader.id);
    expect(updated?.mustChangePassword).toBe(true);
  });

  it('changeOwnPassword clears mustChangePassword on a successful self-change', async () => {
    await svc.setPassword(admin(), { userId: leader.id, password: 'newtemp123' });
    const actor: Actor = { id: leader.id, role: 'church', churchId: null, churchName: null, zone: null, displayName: 'gracepoint' };
    await svc.changeOwnPassword(actor, { currentPassword: 'newtemp123', newPassword: 'ownchoice1' });
    const updated = await users.findById(leader.id);
    expect(updated?.mustChangePassword).toBe(false);
  });

  it('changeOwnPassword rejects the wrong current password and leaves the flag untouched', async () => {
    await svc.setPassword(admin(), { userId: leader.id, password: 'newtemp123' });
    const actor: Actor = { id: leader.id, role: 'church', churchId: null, churchName: null, zone: null, displayName: 'gracepoint' };
    await expect(
      svc.changeOwnPassword(actor, { currentPassword: 'wrongpassword', newPassword: 'ownchoice1' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    const unchanged = await users.findById(leader.id);
    expect(unchanged?.mustChangePassword).toBe(true);
  });

  it('createUser defaults mustChangePassword to false (admin-created accounts are not gated)', async () => {
    const created = await svc.createUser(admin(), {
      firstName: 'New', lastName: 'Leader', username: 'newleader', role: 'church', password: 'longenoughpw',
    });
    const stored = await users.findById(created.id);
    expect(stored?.mustChangePassword).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// previewAccount — admin account preview (2026-07-15). Validates that only an
// admin can preview, and only an active NON-admin target.
// ---------------------------------------------------------------------------

describe('AccountService.previewAccount', () => {
  let users: InMemoryUserRepository;
  let svc: AccountService;

  async function seedTarget(over: Partial<User>): Promise<User> {
    return users.save({
      id: 'u', firstName: 'Vic', lastName: 'Tory', username: 'victory', role: 'church',
      churchId: 'ch1', churchName: 'Victory', zone: 'Yellow', status: 'active',
      passwordHash: 'x', createdAt: NOW, updatedAt: NOW, ...over,
    });
  }

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    const churches = new InMemoryChurchRepository();
    const people = new InMemoryPersonRepository();
    await Promise.all([users.init(), churches.init(), people.init()]);
    svc = makeAccountService(users, churches, people);
  });

  it('rejects a non-admin actor', async () => {
    await seedTarget({ id: 'c1' });
    const nonAdmin: Actor = { id: 'c1', role: 'church', churchId: 'ch1', churchName: 'Victory', zone: 'Yellow', displayName: 'Church' };
    await expect(svc.previewAccount(nonAdmin, 'c1')).rejects.toThrow();
  });

  it('throws NotFound for a missing id', async () => {
    await expect(svc.previewAccount(admin(), 'nope')).rejects.toThrow(/not found/i);
  });

  it('rejects an admin target', async () => {
    await seedTarget({ id: 'a2', role: 'admin', username: 'admin2' });
    await expect(svc.previewAccount(admin(), 'a2')).rejects.toThrow(/admin/i);
  });

  it('rejects an inactive target', async () => {
    await seedTarget({ id: 'c1', status: 'inactive' });
    await expect(svc.previewAccount(admin(), 'c1')).rejects.toThrow(/not active/i);
  });

  it('returns a SafeUser (no passwordHash) for each non-admin role', async () => {
    for (const role of ['church', 'zoneLeader', 'director', 'firstAid'] as const) {
      const id = 'id_' + role;
      await seedTarget({ id, role, username: 'u_' + role });
      const safe = await svc.previewAccount(admin(), id);
      expect(safe.id).toBe(id);
      expect((safe as Record<string, unknown>).passwordHash).toBeUndefined();
    }
  });
});
