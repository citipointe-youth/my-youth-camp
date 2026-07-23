import { describe, it, expect, beforeEach } from 'vitest';
import { makeNotificationService } from './notification.service';
import {
  InMemoryNotificationRepository,
  InMemoryPersonRepository,
  InMemoryChurchRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import type { Notification } from '../core/entities/notification';

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return { id: 'u1', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
}

let notifs: InMemoryNotificationRepository;
let svc: ReturnType<typeof makeNotificationService>;

beforeEach(async () => {
  notifs = new InMemoryNotificationRepository();
  const persons = new InMemoryPersonRepository();
  const churches = new InMemoryChurchRepository();
  await notifs.init();
  await persons.init();
  await churches.init();
  svc = makeNotificationService(notifs, persons, churches);
});

function leadersOnlyCampNotice(): Notification {
  return {
    id: 'notif-inc-1',
    scope: 'camp',
    zone: null,
    churchId: null,
    priority: 'urgent',
    title: 'Incident logged',
    body: 'sensitive summary about a minor',
    senderId: 'z1',
    senderName: 'Zone Yellow',
    senderRole: 'zoneLeader',
    leadersOnly: true,
    audienceEstimate: 0,
    expiresAt: null,
    createdAt: new Date().toISOString(),
  };
}

describe('notification.service — leadersOnly feed filtering', () => {
  it('a leaders-only camp notice is hidden from church and firstAid feeds', async () => {
    await notifs.save(leadersOnlyCampNotice());
    for (const role of ['church', 'firstAid'] as const) {
      const feed = await svc.feed(actor(role, { churchId: 'c1', zone: 'Yellow' }));
      expect(feed.map((n) => n.id)).not.toContain('notif-inc-1');
    }
  });

  it('a leaders-only camp notice IS visible to zoneLeader, director and admin', async () => {
    await notifs.save(leadersOnlyCampNotice());
    for (const role of ['zoneLeader', 'director', 'admin'] as const) {
      const feed = await svc.feed(actor(role, { zone: 'Yellow' }));
      expect(feed.map((n) => n.id)).toContain('notif-inc-1');
    }
  });

  it('a normal camp notice is still visible to church (leadersOnly defaults off)', async () => {
    const normal = { ...leadersOnlyCampNotice(), id: 'notif-normal', leadersOnly: false, title: 'Welcome' };
    await notifs.save(normal);
    const feed = await svc.feed(actor('church', { churchId: 'c1' }));
    expect(feed.map((n) => n.id)).toContain('notif-normal');
  });
});

describe('notification.service — scheduled notices (item 9)', () => {
  const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  async function schedule(over: Partial<Notification> = {}) {
    return svc.send(
      actor('director', { id: 'd1', displayName: 'Dir' }),
      { scope: 'camp', priority: 'normal', title: 'Later', body: 'body', scheduledFor: future(), ...over },
    );
  }

  it('a future-scheduled notice is withheld from every audience feed until due', async () => {
    await schedule();
    for (const role of ['church', 'zoneLeader', 'director', 'admin'] as const) {
      const feed = await svc.feed(actor(role, { zone: 'Yellow' }));
      expect(feed.map((n) => n.title)).not.toContain('Later');
    }
  });

  it('a scheduled notice whose time has passed appears in the feed', async () => {
    await svc.send(actor('director', { id: 'd1' }), { scope: 'camp', title: 'Due', body: 'b', scheduledFor: past() });
    const feed = await svc.feed(actor('church', { churchId: 'c1' }));
    expect(feed.map((n) => n.title)).toContain('Due');
  });

  it('scheduled() lists a creator\'s own pending notices; director/admin see all', async () => {
    const zActor = actor('zoneLeader', { id: 'z9', zone: 'Yellow' });
    await svc.send(zActor, { scope: 'zone', zone: 'Yellow', title: 'Zmine', body: 'b', scheduledFor: future() });
    await schedule({ title: 'DirOne' }); // sender d1

    const zList = await svc.scheduled(zActor);
    expect(zList.map((n) => n.title)).toEqual(['Zmine']); // only own

    const adminList = await svc.scheduled(actor('admin', { id: 'a1' }));
    expect(adminList.map((n) => n.title).sort()).toEqual(['DirOne', 'Zmine']);
  });

  it('a creator can edit and delete their own scheduled notice', async () => {
    const zActor = actor('zoneLeader', { id: 'z9', zone: 'Yellow' });
    const n = await svc.send(zActor, { scope: 'zone', zone: 'Yellow', title: 'Old', body: 'b', scheduledFor: future() });
    const edited = await svc.update(zActor, n.id, { title: 'New', scheduledFor: future() });
    expect(edited.title).toBe('New');
    await svc.remove(zActor, n.id);
    expect(await svc.scheduled(actor('admin', { id: 'a1' }))).toHaveLength(0);
  });

  it('a zoneLeader cannot edit a notice they did not create', async () => {
    const n = await schedule({ title: 'DirOwned' }); // sender d1
    const other = actor('zoneLeader', { id: 'zX', zone: 'Blue' });
    await expect(svc.update(other, n.id, { title: 'hijack' })).rejects.toThrow();
  });
});
