import { describe, it, expect, beforeEach } from 'vitest';
import { makeSettingsService, type SettingsService } from './settings.service';
import { InMemorySettingsRepository } from '../repositories/in-memory';
import type { CampSettings } from '../core/entities/settings';
import { SETTINGS_ID } from '../core/entities/settings';
import type { Actor } from '../core/entities/user';

function actor(role: Actor['role'] = 'admin'): Actor {
  return { id: 'u', role, churchId: null, churchName: null, zone: null, displayName: 'Test' };
}

function settings(over: Partial<CampSettings> = {}): CampSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: SETTINGS_ID, campName: 'Camp', year: 2026, startDate: '2026-07-01', endDate: '2026-07-05',
    timezone: 'Australia/Brisbane', checkInDays: [], accommodationLocked: false,
    churchLoginLocked: false, zoneLeaderLoginLocked: false, churchCheckinTimeRestricted: false,
    checkinSwitchoverTime: '14:00', checkinPhaseOverride: 'auto', campMode: 'pre-camp',
    createdAt: now, updatedAt: now,
    ...over,
  };
}

describe('SettingsService — updateDiscountCodeOverrides', () => {
  let repo: InMemorySettingsRepository;
  let svc: SettingsService;

  beforeEach(async () => {
    repo = new InMemorySettingsRepository();
    await repo.saveSingleton(settings());
    svc = makeSettingsService(repo);
  });

  it('lets director update discount overrides but not general settings', async () => {
    const dir = actor('director');
    await expect(svc.updateDiscountCodeOverrides(dir, { EFTPOS: 180 })).resolves.toBeTruthy();
    await expect(svc.update(dir, { campName: 'X' })).rejects.toThrow();
  });

  it('refuses discount overrides for church and zoneLeader', async () => {
    for (const role of ['church', 'zoneLeader'] as const) {
      await expect(svc.updateDiscountCodeOverrides(actor(role), { EFTPOS: 180 })).rejects.toThrow();
    }
  });

  it('drops zero, negative and blank-code entries', async () => {
    const saved = await svc.updateDiscountCodeOverrides(actor('admin'), {
      EFTPOS: 180, ZERO: 0, NEG: -5, '   ': 90,
    } as Record<string, number>);
    expect(saved.discountCodeOverrides).toEqual({ EFTPOS: 180 });
  });

  it('round-trips through the settings repository', async () => {
    await svc.updateDiscountCodeOverrides(actor('admin'), { EFTPOS: 180 });
    const reloaded = await repo.getSingleton();
    expect(reloaded?.discountCodeOverrides).toEqual({ EFTPOS: 180 });
  });
});
