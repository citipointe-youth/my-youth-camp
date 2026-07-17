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
