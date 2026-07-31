import { describe, it, expect, beforeEach } from 'vitest';
import { makeAccountService, type AccountService } from './account.service';
import {
  InMemoryUserRepository,
  InMemoryChurchRepository,
  InMemoryPersonRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import type { Church } from '../core/entities/church';
import { ForbiddenError } from '../core/errors/app-error';

/**
 * A church login can set its OWN church's four ministry leader contacts (2026-07-31).
 * These are the numbers first aid rings, so the scoping matters more than the feature does.
 */

const NOW = '2026-01-01T00:00:00.000Z';

function blankContacts(): Church['contacts'] {
  return {
    male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
    female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
  };
}

function church(over: Partial<Church> = {}): Church {
  return {
    id: 'c1',
    name: 'Victory Church',
    zone: 'Yellow',
    contacts: blankContacts(),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function churchActor(churchId: string, genderScope: 'male' | 'female' = 'male'): Actor {
  return {
    id: `u-${churchId}-${genderScope}`,
    role: 'church',
    churchId,
    churchName: 'Victory Church',
    zone: 'Yellow',
    displayName: 'Victory Church',
    genderScope,
  };
}

const adminActor: Actor = {
  id: 'u-admin', role: 'admin', churchId: null, churchName: null, zone: null, displayName: 'admin',
};
const firstAidActor: Actor = {
  id: 'u-fa', role: 'firstAid', churchId: null, churchName: null, zone: null, displayName: 'First Aid',
};

const FILLED: Church['contacts'] = {
  male: {
    primary: { name: 'Sam Diaz', phone: '0411 111 111' },
    backup: { name: 'Rob Lee', phone: '0411 222 222' },
  },
  female: {
    primary: { name: 'Jo Park', phone: '0411 333 333' },
    backup: { name: 'Kim Ng', phone: '0411 444 444' },
  },
};

describe('updateChurchContacts', () => {
  let churches: InMemoryChurchRepository;
  let svc: AccountService;

  beforeEach(async () => {
    const users = new InMemoryUserRepository();
    churches = new InMemoryChurchRepository();
    const people = new InMemoryPersonRepository();
    await Promise.all([users.init(), churches.init(), people.init()]);
    await churches.save(church());
    await churches.save(church({ id: 'c2', name: 'Noosa Church' }));
    svc = makeAccountService(users, churches, people);
  });

  it('a church login sets all four of its own contacts', async () => {
    const saved = await svc.updateChurchContacts(churchActor('c1'), 'c1', { contacts: FILLED });
    expect(saved.contacts.male.primary.name).toBe('Sam Diaz');
    expect(saved.contacts.female.backup.phone).toBe('0411 444 444');
  });

  it('the girls login can set the boys contacts too (owner chose all four)', async () => {
    const saved = await svc.updateChurchContacts(churchActor('c1', 'female'), 'c1', {
      contacts: FILLED,
    });
    expect(saved.contacts.male.primary.name).toBe('Sam Diaz');
  });

  it('refuses another church — the capability is not the gate on its own', async () => {
    await expect(
      svc.updateChurchContacts(churchActor('c1'), 'c2', { contacts: FILLED }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('refuses a role without the capability', async () => {
    await expect(
      svc.updateChurchContacts(firstAidActor, 'c1', { contacts: FILLED }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('admin can set any church', async () => {
    const saved = await svc.updateChurchContacts(adminActor, 'c2', { contacts: FILLED });
    expect(saved.contacts.female.primary.name).toBe('Jo Park');
  });

  it('writes ONLY contacts — a church cannot smuggle a rename or a re-zone through it', async () => {
    const saved = await svc.updateChurchContacts(churchActor('c1'), 'c1', {
      contacts: FILLED,
      name: 'Hijacked Church',
      zone: 'Red',
      accommodationOverride: 'classroom',
    });
    expect(saved.name).toBe('Victory Church');
    expect(saved.zone).toBe('Yellow');
    expect(saved.accommodationOverride).toBeUndefined();
  });
});
