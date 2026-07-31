import { describe, it, expect, beforeEach } from 'vitest';
import { makeAccountService, findOriginalAdmin, type AccountService } from './account.service';
import {
  InMemoryUserRepository,
  InMemoryChurchRepository,
  InMemoryPersonRepository,
} from '../repositories/in-memory';
import type { Actor, User } from '../core/entities/user';
import { ForbiddenError } from '../core/errors/app-error';

/**
 * Secondary admin accounts (2026-07-31). The original admin — the earliest-created one — is
 * the recovery account and must survive every path that could otherwise remove it.
 */

function admin(id = 'u-original'): Actor {
  return { id, role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'admin' };
}

function user(over: Partial<User>): User {
  return {
    id: 'u-original',
    firstName: 'Platform',
    lastName: 'Admin',
    username: 'admin',
    role: 'admin',
    churchId: null,
    churchName: null,
    zone: null,
    status: 'active',
    passwordHash: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as User;
}

describe('secondary admin accounts', () => {
  let users: InMemoryUserRepository;
  let svc: AccountService;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    const churches = new InMemoryChurchRepository();
    const people = new InMemoryPersonRepository();
    await Promise.all([users.init(), churches.init(), people.init()]);
    await users.save(user({}));
    svc = makeAccountService(users, churches, people);
  });

  it('picks the EARLIEST-created admin as the original, not the seed id', async () => {
    await users.save(
      user({ id: 'u-second', username: 'admin2', createdAt: '2026-05-05T00:00:00.000Z' }),
    );
    const original = findOriginalAdmin(await users.findAll());
    expect(original?.id).toBe('u-original');
  });

  it('breaks a createdAt tie deterministically by id', () => {
    const a = user({ id: 'b-later-id' });
    const b = user({ id: 'a-earlier-id' });
    expect(findOriginalAdmin([a, b])?.id).toBe('a-earlier-id');
    expect(findOriginalAdmin([b, a])?.id).toBe('a-earlier-id');
  });

  it('an admin CAN now be created through the API', async () => {
    const created = await svc.createUser(admin(), {
      firstName: 'Second',
      lastName: 'Admin',
      username: 'admin2',
      role: 'admin',
      password: 'sixchars',
    });
    expect(created.role).toBe('admin');
  });

  it('a secondary admin can create further admins', async () => {
    const second = await svc.createUser(admin(), {
      firstName: 'Second',
      lastName: 'Admin',
      username: 'admin2',
      role: 'admin',
      password: 'sixchars',
    });
    const third = await svc.createUser(admin(second.id), {
      firstName: 'Third',
      lastName: 'Admin',
      username: 'admin3',
      role: 'admin',
      password: 'sixchars',
    });
    expect(third.role).toBe('admin');
  });

  it('an existing account can be PROMOTED to admin', async () => {
    const dir = await svc.createUser(admin(), {
      firstName: 'Dee',
      lastName: 'Rector',
      username: 'director2',
      role: 'director',
      password: 'sixchars',
    });
    const promoted = await svc.updateUser(admin(), dir.id, { role: 'admin' });
    expect(promoted.role).toBe('admin');
  });

  // --- the three protections on the original ---------------------------------

  it('refuses to DELETE the original admin', async () => {
    await expect(svc.deleteUser(admin(), 'u-original')).rejects.toThrow(ForbiddenError);
  });

  it('refuses to DEACTIVATE the original admin', async () => {
    await expect(svc.toggleStatus(admin(), 'u-original')).rejects.toThrow(ForbiddenError);
  });

  it('refuses to DEMOTE the original admin', async () => {
    await expect(svc.updateUser(admin(), 'u-original', { role: 'director' })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('protects the original even from a SECOND admin', async () => {
    const second = await svc.createUser(admin(), {
      firstName: 'Second',
      lastName: 'Admin',
      username: 'admin2',
      role: 'admin',
      password: 'sixchars',
    });
    await expect(svc.deleteUser(admin(second.id), 'u-original')).rejects.toThrow(ForbiddenError);
  });

  it('a SECONDARY admin can be deleted, deactivated and demoted', async () => {
    const second = await svc.createUser(admin(), {
      firstName: 'Second',
      lastName: 'Admin',
      username: 'admin2',
      role: 'admin',
      password: 'sixchars',
    });
    const off = await svc.toggleStatus(admin(), second.id);
    expect(off.status).toBe('inactive');
    const demoted = await svc.updateUser(admin(), second.id, { role: 'director' });
    expect(demoted.role).toBe('director');
    await expect(svc.deleteUser(admin(), second.id)).resolves.toEqual({ deleted: second.id });
  });
});
