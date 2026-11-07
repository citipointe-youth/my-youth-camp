import { describe, it, expect, beforeEach } from 'vitest';
import { makeSettingsService } from './settings.service';
import { makePushSubscriptionService } from './push-subscription.service';
import { makeAuthService } from './auth.service';
import { InMemorySettingsRepository, InMemoryPushSubscriptionRepository, InMemoryUserRepository } from '../repositories/in-memory';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { Actor, User } from '../core/entities/user';

/* D4 interface tests: SettingsService named writes, PushSubscriptionService, AuthService.me/setupFirstAdmin. */

const OLD = '2026-01-01T00:00:00.000Z';
const row = (over: Partial<CampSettings> = {}): CampSettings => ({
  id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-07-01', endDate: '2026-07-05',
  timezone: 'Australia/Brisbane', checkInDays: [], accommodationLocked: false,
  churchLoginLocked: true, zoneLeaderLoginLocked: false, churchCheckinTimeRestricted: false,
  checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto', campMode: 'at-camp',
  lastExportedAt: OLD, createdAt: OLD, updatedAt: OLD, ...over,
});

describe('SettingsService named writes', () => {
  let repo: InMemorySettingsRepository;
  beforeEach(async () => {
    repo = new InMemorySettingsRepository();
    await repo.saveSingleton(row({ lastTempPasswords: [{ username: 'a', tempPassword: 'p' }] }));
  });

  it('each touches only its own column (plus updatedAt)', async () => {
    const svc = makeSettingsService(repo);
    await svc.stampExport();
    let s = (await repo.getSingleton())!;
    expect(s.lastExportedAt).not.toBe(OLD);
    expect(s).toMatchObject({ churchLoginLocked: true, campMode: 'at-camp' });
    expect(s.updatedAt).not.toBe(OLD);

    await svc.clearExportStamp();
    expect((await repo.getSingleton())!.lastExportedAt).toBeNull();

    await svc.clearTempPasswords();
    s = (await repo.getSingleton())!;
    expect(s.lastTempPasswords).toBeNull();
    expect(s.lastExportedAt).toBeNull();
  });

  it('stampImport stamps the source field, skips a dry run', async () => {
    const svc = makeSettingsService(repo);
    await svc.stampImport('tickets', { dryRun: true });
    expect((await repo.getSingleton())!.ticketsImportedAt).toBeUndefined();
    await svc.stampImport('form', {});
    await svc.stampImport('tickets', {});
    await svc.stampImport('invoices', {});
    const s = (await repo.getSingleton())!;
    expect(s.formImportedAt && s.ticketsImportedAt && s.invoicesImportedAt).toBeTruthy();
  });

  it('a missing settings row is a no-op for all four (no row is created)', async () => {
    const empty = new InMemorySettingsRepository();
    const svc = makeSettingsService(empty);
    await svc.stampExport(); await svc.clearExportStamp(); await svc.clearTempPasswords();
    await svc.stampImport('form', {});
    expect(await empty.getSingleton()).toBeNull();
  });
});

describe('PushSubscriptionService', () => {
  const actor = (role: Actor['role'], id: string) => ({ id, role } as Actor);
  const body = { endpoint: 'https://x/1', keys: { p256dh: 'p', auth: 'a' } };

  it('subscribe binds to the actor; devices is admin-only; unsubscribe removes', async () => {
    const repo = new InMemoryPushSubscriptionRepository();
    const svc = makePushSubscriptionService(repo);
    expect(await svc.subscribe(actor('church', 'u1'), body)).toEqual({ ok: true });
    expect((await repo.findByEndpoint('https://x/1'))!.userId).toBe('u1');
    await expect(svc.devices(actor('director', 'd'))).rejects.toThrow();
    expect(Object.keys((await svc.devices(actor('admin', 'a'))).byUser)).toEqual(['u1']);
    expect(await svc.unsubscribe({ endpoint: 'https://x/1' })).toEqual({ ok: true, removed: true });
    expect(await repo.findByEndpoint('https://x/1')).toBeNull();
  });

  it('label without a users lookup reports owner null', async () => {
    const repo = new InMemoryPushSubscriptionRepository();
    const svc = makePushSubscriptionService(repo);
    await svc.subscribe(actor('church', 'u1'), body);
    expect(await svc.label({ endpoint: 'https://x/1', device: 'iPhone' })).toEqual({ ok: true, updated: true, owner: null });
  });
});

describe('AuthService.me / setupFirstAdmin', () => {
  it('me strips the hash and 401s on an unknown id', async () => {
    const users = new InMemoryUserRepository();
    await users.save({ id: 'u1', username: 'x', role: 'admin', passwordHash: 'h', firstName: 'A', lastName: 'B', status: 'active' } as unknown as User);
    const auth = makeAuthService(users);
    expect(await auth.me('u1')).not.toHaveProperty('passwordHash');
    await expect(auth.me('nope')).rejects.toThrow();
  });

  it('setupFirstAdmin is refused once the admin has a password', async () => {
    const users = new InMemoryUserRepository();
    await users.save({ id: 'u1', username: 'x', role: 'admin', firstName: 'A', lastName: 'B', status: 'active' } as unknown as User);
    const auth = makeAuthService(users);
    expect(await auth.setupFirstAdmin({ username: 'boss', password: 'longenough' })).toEqual({ ok: true });
    await expect(auth.setupFirstAdmin({ username: 'boss', password: 'longenough' })).rejects.toThrow('Admin password already set');
  });
});
