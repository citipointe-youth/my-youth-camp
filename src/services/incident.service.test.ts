import { describe, it, expect, beforeEach } from 'vitest';
import { makeIncidentService, INCIDENT_ALERT_TTL_HOURS } from './incident.service';
import { InMemoryIncidentRepository, InMemoryNotificationRepository } from '../repositories/in-memory';
import { ForbiddenError, NotFoundError } from '../core/errors/app-error';
import type { Actor } from '../core/entities/user';
import { ZONE_NAMES } from '../core/types/enums';

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

  it('HIGH severity alert EXPIRES 12 hours after it is raised (was permanent)', async () => {
    const before = Date.now();
    await svc.log(actor('admin'), { summary: 'serious', severity: 'high' });
    const after = Date.now();
    const [notif] = await notifs.findAll();
    expect(notif!.expiresAt).toBeTruthy(); // was `null` — prod accumulated permanent urgent rows
    const expires = new Date(notif!.expiresAt!).getTime();
    const ttlMs = INCIDENT_ALERT_TTL_HOURS * 60 * 60 * 1000;
    expect(INCIDENT_ALERT_TTL_HOURS).toBe(12);
    expect(expires).toBeGreaterThanOrEqual(before + ttlMs);
    expect(expires).toBeLessThanOrEqual(after + ttlMs);
    // It is exactly TTL hours after the notice's own createdAt.
    expect(expires - new Date(notif!.createdAt).getTime()).toBe(ttlMs);
  });

  it('the 12h expiry actually drops the alert out of findActive() once it passes', async () => {
    await svc.log(actor('admin'), { summary: 'serious', severity: 'high' });
    expect(await notifs.findActive()).toHaveLength(1); // still actionable now
    // Fast-forward past the TTL: findActive already filters on expiresAt, no new logic needed.
    const [notif] = await notifs.findAll();
    await notifs.save({ ...notif!, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await notifs.findActive()).toHaveLength(0);
    expect(await notifs.findAll()).toHaveLength(1); // the row itself survives; only the feed drops it
  });

  it('list() returns incidents newest-first', async () => {
    await svc.log(actor('admin'), { summary: 'first', severity: 'low' });
    await new Promise((r) => setTimeout(r, 2));
    await svc.log(actor('admin'), { summary: 'second', severity: 'low' });
    const list = await svc.list(actor('director'));
    expect(list.map((i) => i.summary)).toEqual(['second', 'first']);
  });
});

describe('incident.service — zone is validated against the zone enum (2026-07-30)', () => {
  it('accepts each of the four real zone names', async () => {
    for (const zone of ZONE_NAMES) {
      const inc = await svc.log(actor('admin'), { summary: 'x', severity: 'low', zone });
      expect(inc.zone).toBe(zone);
    }
  });

  it('REJECTS a zone that is not one of the four (a typo used to mis-file the record)', async () => {
    for (const bad of ['Yelow', 'yellow', 'Green', 'Purple Zone', '']) {
      await expect(
        svc.log(actor('admin'), { summary: 'x', severity: 'low', zone: bad }),
      ).rejects.toBeTruthy();
    }
    expect(await incidents.findRecent()).toHaveLength(0); // nothing was written
  });

  it('a zone leader may STILL file against a zone that is not their own (owner-approved)', async () => {
    // Validation constrains WHICH values are legal, never WHO may file against WHICH zone.
    const inc = await svc.log(actor('zoneLeader', { zone: 'Yellow' }), {
      summary: 'camper from Black zone found in our area',
      severity: 'low',
      zone: 'Black',
    });
    expect(inc.zone).toBe('Black');
  });

  it('omitting zone entirely with no actor zone leaves it null', async () => {
    const inc = await svc.log(actor('admin'), { summary: 'x', severity: 'low' });
    expect(inc.zone).toBeNull();
  });

  it('an explicit null zone falls back to the actor zone (.nullish, not .optional)', async () => {
    const inc = await svc.log(actor('zoneLeader', { zone: 'Red' }), {
      summary: 'x', severity: 'low', zone: null,
    });
    expect(inc.zone).toBe('Red');
  });
});

describe('incident.service — optional occurredAt (2026-07-30, migration 0019)', () => {
  it('records occurredAt when supplied', async () => {
    const when = '2026-07-29T22:15:00.000Z';
    const inc = await svc.log(actor('admin'), { summary: 'x', severity: 'low', occurredAt: when });
    expect(inc.occurredAt).toBe(when);
    expect((await incidents.findRecent())[0]!.occurredAt).toBe(when);
  });

  it('an incident logged WITHOUT occurredAt is completely valid (null, no warning)', async () => {
    const inc = await svc.log(actor('admin'), { summary: 'no time recorded', severity: 'low' });
    expect(inc.occurredAt).toBeNull();
    expect(await incidents.findRecent()).toHaveLength(1);
  });

  it('an EXPLICIT null occurredAt is accepted — .nullish() regression guard', async () => {
    // The SPA sends explicit nulls; `.optional()` would reject this with "Validation failed".
    const inc = await svc.log(actor('admin'), {
      summary: 'explicit null', severity: 'low', occurredAt: null,
    });
    expect(inc.occurredAt).toBeNull();
  });

  it('rejects a non-ISO / ambiguous wall-clock occurredAt', async () => {
    // A bare wall-clock string parsed server-side is the UTC-vs-Brisbane bug (lands 10h out).
    for (const bad of ['yesterday', '2026-07-29', '2026-07-29T22:15', 123 as unknown as string]) {
      await expect(
        svc.log(actor('admin'), { summary: 'x', severity: 'low', occurredAt: bad }),
      ).rejects.toBeTruthy();
    }
  });

  it('accepts an ISO instant with a +10:00 offset (Brisbane)', async () => {
    const inc = await svc.log(actor('admin'), {
      summary: 'x', severity: 'low', occurredAt: '2026-07-30T08:15:00+10:00',
    });
    expect(inc.occurredAt).toBe('2026-07-30T08:15:00+10:00');
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
