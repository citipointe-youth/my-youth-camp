import { describe, it, expect } from 'vitest';
import { makePushController } from './push.controller';
import { InMemoryPushSubscriptionRepository } from '../../repositories/in-memory/in-memory.repositories';
import { summariseDevices } from '../../services/push.service';
import type { PushSubscription } from '../../core/entities/push-subscription';
import type { Actor } from '../../core/entities/user';
import type { HttpRequest } from '../http/types';

/* Notification delivery screen (2026-09-22): GET /push/devices + POST /push/label. */

function sub(over: Partial<PushSubscription> = {}): PushSubscription {
  return {
    id: 'push_1',
    userId: 'usr_church',
    endpoint: 'https://fcm.googleapis.com/fcm/send/one',
    p256dh: 'p',
    auth: 'a',
    consentVersion: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    ...over,
  };
}

const actor = (role: Actor['role'], id = 'usr_' + role): Actor =>
  ({ id, role, username: id, displayName: id, churchId: null, zone: null, genderScope: null } as unknown as Actor);
const req = (a: Actor, body?: unknown): HttpRequest => ({ ctx: { actor: a }, body } as unknown as HttpRequest);

async function setup(rows: PushSubscription[]) {
  const repo = new InMemoryPushSubscriptionRepository();
  for (const r of rows) await repo.save(r);
  return { repo, ctrl: makePushController({ subscriptions: repo }) };
}

describe('summariseDevices', () => {
  it('groups by account, newest-added first, and never exposes endpoint or keys', () => {
    const out = summariseDevices([
      sub({ id: 'a', endpoint: 'https://x/1', createdAt: '2026-09-01T00:00:00.000Z', deviceLabel: 'iPhone' }),
      sub({ id: 'b', endpoint: 'https://x/2', createdAt: '2026-09-05T00:00:00.000Z', lastSuccessAt: '2026-09-06T00:00:00.000Z' }),
      sub({ id: 'c', endpoint: 'https://x/3', userId: 'usr_admin', failureCount: 3 }),
    ]);
    expect(Object.keys(out).sort()).toEqual(['usr_admin', 'usr_church']);
    expect(out['usr_church']!.map((d) => d.addedAt)).toEqual(['2026-09-05T00:00:00.000Z', '2026-09-01T00:00:00.000Z']);
    expect(out['usr_church']![0]!.lastSuccessAt).toBe('2026-09-06T00:00:00.000Z');
    expect(out['usr_church']![1]!.device).toBe('iPhone');
    expect(out['usr_admin']![0]!.failureCount).toBe(3);
    const wire = JSON.stringify(out);
    expect(wire).not.toContain('https://x/');
    expect(wire).not.toMatch(/p256dh|"auth"|endpoint/);
  });
});

describe('GET /push/devices', () => {
  it('is admin-only', async () => {
    const { ctrl } = await setup([sub()]);
    for (const role of ['church', 'zoneLeader', 'director', 'firstAid'] as const) {
      await expect(ctrl.devices(req(actor(role)))).rejects.toThrow();
    }
    const res = await ctrl.devices(req(actor('admin')));
    expect(res.byUser['usr_church']).toHaveLength(1);
  });
});

describe('POST /push/label', () => {
  it('fills a blank label without moving the row to the calling account', async () => {
    const { repo, ctrl } = await setup([sub()]);
    const res = await ctrl.label(req(actor('admin'), { endpoint: sub().endpoint, device: 'Android' }));
    expect(res.updated).toBe(true);
    const row = await repo.findByEndpoint(sub().endpoint);
    expect(row!.deviceLabel).toBe('Android');
    expect(row!.userId).toBe('usr_church');
  });

  it('never overwrites an existing label, and ignores an unknown endpoint', async () => {
    const { repo, ctrl } = await setup([sub({ deviceLabel: 'iPhone' })]);
    expect((await ctrl.label(req(actor('church'), { endpoint: sub().endpoint, device: 'Android' }))).updated).toBe(false);
    expect((await repo.findByEndpoint(sub().endpoint))!.deviceLabel).toBe('iPhone');
    expect((await ctrl.label(req(actor('church'), { endpoint: 'https://x/none', device: 'Android' }))).updated).toBe(false);
  });

  it('rejects a free-text device (only the fixed list is stored)', async () => {
    const { ctrl } = await setup([sub()]);
    await expect(ctrl.label(req(actor('church'), { endpoint: sub().endpoint, device: 'Mozilla/5.0 (iPhone…' }))).rejects.toThrow();
  });
});

describe('POST /push/subscribe device label', () => {
  it('stores the label, and a label-less re-subscribe keeps the known one', async () => {
    const { repo, ctrl } = await setup([]);
    const body = { endpoint: 'https://x/9', keys: { p256dh: 'p', auth: 'a' } };
    await ctrl.subscribe(req(actor('church'), { ...body, device: 'iPhone' }));
    expect((await repo.findByEndpoint('https://x/9'))!.deviceLabel).toBe('iPhone');
    await ctrl.subscribe(req(actor('church'), body));
    expect((await repo.findByEndpoint('https://x/9'))!.deviceLabel).toBe('iPhone');
  });
});
