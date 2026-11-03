import { describe, it, expect, vi } from 'vitest';
import { makeSearchService } from './search.service';
import { makeNotificationService } from './notification.service';
import { mapPaymentStatus } from './ticket-import.service';
import {
  InMemoryChurchRepository,
  InMemoryNotificationRepository,
  InMemoryPersonRepository,
  InMemorySettingsRepository,
  InMemoryUserRepository,
} from '../repositories/in-memory';
import type { Person } from '../core/entities/person';
import type { Church } from '../core/entities/church';
import type { User, Actor } from '../core/entities/user';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';

// QA batch 3 (4 Nov 2026). Item numbers are from the coordinator's batch 3 list.
const now = '2026-01-01T00:00:00.000Z';
const actor = (role: Actor['role'], over: Partial<Actor> = {}): Actor =>
  ({ id: 'me', role, churchId: null, churchName: null, zone: null, displayName: 'T', ...over });

describe('item 2: Call primary on a cross-church search hit', () => {
  function person(over: Partial<Person>): Person {
    return {
      id: 'p', firstName: 'Zed', lastName: 'Q', gender: 'male', kind: 'youth',
      churchId: 'c2', churchName: 'Grace', zone: 'Blue', medicalConditions: [], dietaryRequirements: [],
      consents: { medical: { granted: false, timestamp: null }, media: { granted: false, timestamp: null }, supervision: { granted: false, timestamp: null } },
      paymentStatus: 'unpaid', needsReview: false, lifecycle: 'arrived', atCamp: true,
      parentPhone: '0499111222', checkInHistory: [], signOutHistory: [], createdAt: now, updatedAt: now,
      ...over,
    };
  }
  const church = (id: string): Church => ({
    id, name: 'Grace', zone: 'Blue',
    contacts: {
      male: { primary: { name: 'Sam', phone: '0411000001' }, backup: { name: '', phone: '' } },
      female: { primary: { name: 'Jo', phone: '0411000002' }, backup: { name: '', phone: '' } },
    },
  } as Church);
  const victory = actor('church', { churchId: 'c1', churchName: 'Victory', zone: 'Yellow', genderScope: 'female' } as Partial<Actor>);
  async function setup() {
    const people = new InMemoryPersonRepository();
    const churches = new InMemoryChurchRepository();
    await churches.save(church('c2'));
    await people.save(person({ id: 'here' }));
    await people.save(person({ id: 'notyet', lifecycle: 'registered', atCamp: false }));
    const record = vi.fn(async () => {});
    return { svc: makeSearchService(people, churches, { record } as never), record };
  }
  it('a church login gets the real leader number, and the reveal is audited', async () => {
    const { svc, record } = await setup();
    const c = await svc.revealContact(victory, 'here', 'male-primary', { initials: 'QA' });
    expect(c.phone).toBe('0411000001');
    expect(record).toHaveBeenCalledWith(victory, expect.objectContaining({ kind: 'leader-contact', contactRole: 'male-primary', initials: 'QA' }));
  });
  it('a zone leader outside the zone gets it too', async () => {
    const { svc } = await setup();
    const zl = actor('zoneLeader', { zone: 'Yellow' });
    expect((await svc.revealContact(zl, 'here', 'male-primary')).phone).toBe('0411000001');
  });
  it('the parent number stays out of reach across churches', async () => {
    const { svc, record } = await setup();
    await expect(svc.revealContact(victory, 'here', 'parent')).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });
  it('someone search would not show stays refused', async () => {
    const { svc } = await setup();
    await expect(svc.revealContact(victory, 'notyet', 'male-primary')).rejects.toThrow();
  });
  it('a role not offered for this person stays refused', async () => {
    const { svc } = await setup();
    await expect(svc.revealContact(victory, 'here', 'male-backup')).rejects.toThrow();
  });
});

describe('item 3a: ticket status is kept for Free and Refunded', () => {
  it.each([['Free', 'free'], ['refunded', 'refunded'], ['Paid', 'paid'], ['Pending', 'unpaid'], ['Part Paid', 'deposit']])('%s becomes %s', (raw, want) => {
    expect(mapPaymentStatus(raw)).toBe(want);
  });
  it('an unknown status is still left unchanged', () => {
    expect(mapPaymentStatus('Partially refunded')).toBeNull();
  });
});

describe('item 8: recipient count on a sent notice', () => {
  const user = (id: string, role: User['role'], over: Partial<User> = {}): User =>
    ({ id, username: id, role, firstName: id, lastName: '', status: 'active', churchId: null, zone: null, createdAt: now, updatedAt: now, ...over } as User);
  const settings = { id: SETTINGS_ID, campName: 'C', campMode: 'at-camp', churchLoginLocked: false, zoneLeaderLoginLocked: false } as CampSettings;
  async function setup() {
    const users = new InMemoryUserRepository();
    const repo = new InMemorySettingsRepository();
    await repo.saveSingleton(settings);
    for (const u of [
      user('me', 'admin'), user('dir', 'director'), user('fa', 'firstAid'), user('pr', 'prayer'),
      user('blue', 'church', { churchId: 'c1', zone: 'Blue' }),
      user('yel', 'church', { churchId: 'c2', zone: 'Yellow' }),
      user('off', 'church', { churchId: 'c3', zone: 'Blue', status: 'inactive' }),
    ]) await users.save(u);
    return makeNotificationService(new InMemoryNotificationRepository(), undefined, { users, settings: repo });
  }
  const send = (over: object) => ({ priority: 'normal', title: 't', body: 'b', ...over });
  it('camp-wide counts active church and leadership logins, not the sender, first aid or prayer', async () => {
    const r = await (await setup()).send(actor('admin'), send({ scope: 'camp' }));
    expect(r.recipientLogins).toBe(3); // dir, blue, yel
  });
  it('a zone notice counts that zone plus director', async () => {
    const r = await (await setup()).send(actor('admin'), send({ scope: 'zone', zone: 'Blue' }));
    expect(r.recipientLogins).toBe(2); // dir, blue
  });
  it('a scheduled notice has no count yet', async () => {
    const r = await (await setup()).send(actor('admin'), send({ scope: 'camp', scheduledFor: '2099-01-01T00:00:00.000Z' }));
    expect(r.recipientLogins).toBeUndefined();
  });
});
