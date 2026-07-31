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
import { hashPassword, verifyPassword } from '../utils/crypto';
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

  // ── listChurches delegates to canAccessChurch (fixed 2026-07-30) ───────────────────
  //
  // It used to hand-roll the rule: special-case admin/director/zoneLeader, then fall
  // through to `c.id === actor.churchId` for everyone else. firstAid landed in that
  // fall-through and has NO churchId, so the comparison was always false and first aid got
  // an EMPTY list — while the canonical canAccessChurch grants firstAid every church, as it
  // does for people, notifications and accommodation. Nothing covered it, which is how it
  // survived; these are the tests that were missing.

  it('firstAid sees every church (was empty — the drifted hand-rolled copy)', async () => {
    const firstAid: Actor = { id: 'fa', role: 'firstAid', churchId: null, churchName: null, zone: null, displayName: 'First Aid' };
    const out = await svc.listChurches(firstAid);
    expect(out.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('a church login still sees only its own church', async () => {
    const chActor: Actor = { id: 'u1', role: 'church', churchId: 'c1', churchName: 'Victory Church', zone: 'Yellow', displayName: 'Victory' };
    const out = await svc.listChurches(chActor);
    expect(out.map((c) => c.id)).toEqual(['c1']);
  });

  it('a zoneLeader still sees only its own zone', async () => {
    await churches.save(church({ id: 'c3', name: 'Blue Church', zone: 'Blue' }));
    const zl: Actor = { id: 'z', role: 'zoneLeader', churchId: null, churchName: null, zone: 'Blue', displayName: 'ZL' };
    const out = await svc.listChurches(zl);
    expect(out.map((c) => c.id)).toEqual(['c3']);
  });

  it('admin and director still see every church', async () => {
    const director: Actor = { id: 'd', role: 'director', churchId: null, churchName: null, zone: null, displayName: 'Director' };
    expect((await svc.listChurches(admin())).length).toBe(2);
    expect((await svc.listChurches(director)).length).toBe(2);
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

// ---------------------------------------------------------------------------
// Feature 2 + 6 — gender-scoped church accounts (b-/g-) + memorable passwords.
// ---------------------------------------------------------------------------

describe('AccountService — gender-scoped church accounts', () => {
  let users: InMemoryUserRepository;
  let churches: InMemoryChurchRepository;
  let people: InMemoryPersonRepository;
  let svc: AccountService;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    churches = new InMemoryChurchRepository();
    people = new InMemoryPersonRepository();
    await Promise.all([users.init(), churches.init(), people.init()]);
    svc = makeAccountService(users, churches, people);
  });

  it('createChurchWithAccount creates BOTH gender-scoped logins with memorable passwords', async () => {
    const res = await svc.createChurchWithAccount(admin(), {
      churchName: 'Victory Church',
      zone: 'Yellow',
      accountUsername: 'victory',
    });
    expect(res.users).toHaveLength(2);
    const all = await users.findAll();
    const churchUsers = all.filter((u) => u.role === 'church');
    expect(churchUsers).toHaveLength(2);
    const male = churchUsers.find((u) => u.genderScope === 'male');
    const female = churchUsers.find((u) => u.genderScope === 'female');
    expect(male?.username).toBe('b-victory');
    expect(female?.username).toBe('g-victory');
    // Memorable Word.### passwords in the credentials, and they actually authenticate.
    expect(res.credentials).toHaveLength(2);
    for (const c of res.credentials) {
      expect(c.password).toMatch(/^[A-Z][a-z]+\.\d{3}$/);
    }
    const maleCred = res.credentials.find((c) => c.gender === 'male');
    expect(maleCred?.username).toBe('b-victory');
    expect(await verifyPassword(maleCred!.password, male!.passwordHash!)).toBe(true);
    // No mustChangePassword flag on these (they are the real passwords).
    expect(male?.mustChangePassword).toBeFalsy();
  });

  it('slugifies the church name when no username base is supplied', async () => {
    await svc.createChurchWithAccount(admin(), { churchName: "St Mary's Youth", zone: 'Blue' });
    const churchUsers = (await users.findAll()).filter((u) => u.role === 'church');
    expect(churchUsers.map((u) => u.username).sort()).toEqual(['b-st-mary-s-youth', 'g-st-mary-s-youth']);
  });

  it('splitChurchAccounts creates missing gender logins and retires the legacy combined login (idempotent)', async () => {
    // A pre-existing church with an OLD combined login (no gender scope).
    const c = church({ id: 'c1', name: 'Grace Point', zone: 'Black' });
    await churches.save(c);
    await users.save({
      id: 'legacy', firstName: 'Grace', lastName: 'Point', username: 'gracepoint', role: 'church',
      churchId: 'c1', churchName: 'Grace Point', zone: 'Black', status: 'active',
      passwordHash: await hashPassword('oldpassword'), createdAt: NOW, updatedAt: NOW,
    });

    const r1 = await svc.splitChurchAccounts(admin());
    expect(r1.churches).toBe(1);
    expect(r1.retired).toBe(1);
    expect(r1.created).toHaveLength(2);

    const after = await users.findAll();
    expect(after.find((u) => u.id === 'legacy')).toBeUndefined(); // legacy retired
    const churchUsers = after.filter((u) => u.role === 'church');
    expect(churchUsers).toHaveLength(2);
    expect(churchUsers.map((u) => u.genderScope).sort()).toEqual(['female', 'male']);

    // Idempotent: a second run creates nothing and retires nothing.
    const r2 = await svc.splitChurchAccounts(admin());
    expect(r2.created).toHaveLength(0);
    expect(r2.retired).toBe(0);
    expect((await users.findAll()).filter((u) => u.role === 'church')).toHaveLength(2);
  });

  it('randomizeChurchPasswords resets every church login and returns export rows', async () => {
    await svc.createChurchWithAccount(admin(), { churchName: 'Victory', zone: 'Yellow', accountUsername: 'victory' });
    const before = (await users.findAll()).filter((u) => u.role === 'church').map((u) => u.passwordHash);

    const rows = await svc.randomizeChurchPasswords(admin());
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.gender).sort()).toEqual(['female', 'male']);
    for (const r of rows) {
      expect(r.password).toMatch(/^[A-Z][a-z]+\.\d{3}$/);
      expect(r.church).toBe('Victory');
    }
    // Hashes changed; the new passwords authenticate; no mustChangePassword set.
    const after = (await users.findAll()).filter((u) => u.role === 'church');
    expect(after.map((u) => u.passwordHash).sort()).not.toEqual(before.sort());
    for (const u of after) {
      const row = rows.find((r) => r.username === u.username)!;
      expect(await verifyPassword(row.password, u.passwordHash!)).toBe(true);
      expect(u.mustChangePassword).toBeFalsy();
    }
  });

  it('randomizeChurchPasswords also back-fills gender accounts for a church that has none', async () => {
    await churches.save(church({ id: 'c9', name: 'Northside', zone: 'Red' }));
    const rows = await svc.randomizeChurchPasswords(admin());
    expect(rows).toHaveLength(2);
    const churchUsers = (await users.findAll()).filter((u) => u.role === 'church');
    expect(churchUsers.map((u) => u.username).sort()).toEqual(['b-northside', 'g-northside']);
  });
});
