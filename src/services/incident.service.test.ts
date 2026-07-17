import { describe, it, expect, beforeEach } from 'vitest';
import { makeIncidentService } from './incident.service';
import { InMemoryIncidentRepository, InMemoryNotificationRepository } from '../repositories/in-memory';
import { ForbiddenError, NotFoundError } from '../core/errors/app-error';
import type { Actor } from '../core/entities/user';

function actor(role: Actor['role'], over: Partial<Actor> = {}): Actor {
  return { id: 'u1', role, churchId: null, churchName: null, zone: null, displayName: role, ...over };
}

let incidents: InMemoryIncidentRepository;
let notifs: InMemoryNotificationRepository;
let svc: ReturnType<typeof makeIncidentService>;

beforeEach(async () => {
  incidents = new InMemoryIncidentRepository();
  notifs = new InMemoryNotificationRepository();
  await incidents.init();
  await notifs.init();
  svc = makeIncidentService(incidents, notifs);
});

describe('incident.service — RBAC', () => {
  it('zoneLeader, director and admin can log incidents', async () => {
    for (const role of ['zoneLeader', 'director', 'admin'] as const) {
      const inc = await svc.log(actor(role), { summary: `by ${role}`, severity: 'low' });
      expect(inc.severity).toBe('low');
      expect(inc.createdByRole).toBe(role);
    }
  });

  it('church and firstAid cannot log or list incidents', async () => {
    for (const role of ['church', 'firstAid'] as const) {
      await expect(svc.log(actor(role), { summary: 'x', severity: 'low' })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.list(actor(role))).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe('incident.service — logging', () => {
  it('validates input (rejects empty summary / bad severity)', async () => {
    await expect(svc.log(actor('admin'), { summary: '', severity: 'low' })).rejects.toBeTruthy();
    await expect(svc.log(actor('admin'), { summary: 'ok', severity: 'medium' })).rejects.toBeTruthy();
  });

  it('defaults zone to the logging leader’s zone when not supplied', async () => {
    const inc = await svc.log(actor('zoneLeader', { zone: 'Yellow' }), { summary: 'fell over', severity: 'low' });
    expect(inc.zone).toBe('Yellow');
  });

  it('an explicit zone overrides the actor zone', async () => {
    const inc = await svc.log(actor('admin', { zone: 'Blue' }), { summary: 'x', severity: 'low', zone: 'Red' });
    expect(inc.zone).toBe('Red');
  });

  it('LOW severity records the incident WITHOUT raising a notification', async () => {
    await svc.log(actor('admin'), { summary: 'minor scrape', severity: 'low' });
    expect(await notifs.findAll()).toHaveLength(0);
    expect(await incidents.findRecent()).toHaveLength(1);
  });

  it('HIGH severity ALSO raises a camp-wide urgent notification including the summary', async () => {
    await svc.log(actor('zoneLeader', { zone: 'Yellow' }), { summary: 'serious injury — ambulance called', severity: 'high' });
    const feed = await notifs.findAll();
    expect(feed).toHaveLength(1);
    expect(feed[0]!.scope).toBe('camp'); // reaches all leaders/directors/admins via the shared feed
    expect(feed[0]!.priority).toBe('urgent');
    expect(feed[0]!.body).toBe('serious injury — ambulance called'); // summary included
    expect(feed[0]!.title).toContain('Yellow');
    expect(feed[0]!.leadersOnly).toBe(true); // hidden from church/firstAid feeds (summary can describe a minor)
  });

  it('list() returns incidents newest-first', async () => {
    await svc.log(actor('admin'), { summary: 'first', severity: 'low' });
    await new Promise((r) => setTimeout(r, 2));
    await svc.log(actor('admin'), { summary: 'second', severity: 'low' });
    const list = await svc.list(actor('director'));
    expect(list.map((i) => i.summary)).toEqual(['second', 'first']);
  });
});

describe('incident.service — deletion (append-only)', () => {
  it('admin and director may delete; zoneLeader may not', async () => {
    const inc = await svc.log(actor('admin'), { summary: 'x', severity: 'low' });
    await expect(svc.remove(actor('zoneLeader'), inc.id)).rejects.toBeInstanceOf(ForbiddenError);
    const res = await svc.remove(actor('director'), inc.id);
    expect(res.ok).toBe(true);
    expect(await incidents.findRecent()).toHaveLength(0);
  });

  it('deleting a missing incident throws NotFound', async () => {
    await expect(svc.remove(actor('admin'), 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
