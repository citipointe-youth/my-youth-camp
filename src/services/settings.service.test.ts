import { describe, it, expect, beforeEach } from 'vitest';
import { makeSettingsService, type SettingsService } from './settings.service';
import {
  InMemorySettingsRepository, InMemoryDevotionalRepository, InMemoryScheduleRepository,
} from '../repositories/in-memory';
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

/* Item 3 (2026-07-28) — moving the camp dates must carry day-keyed content (devotionals and
   schedule items) across with them, or an admin's authored content silently disappears from
   every screen while still sitting in the database under the old dates. */
describe('SettingsService — camp dates moved (item 3)', () => {
  let repo: InMemorySettingsRepository;
  let devos: InMemoryDevotionalRepository;
  let sched: InMemoryScheduleRepository;
  let svc: SettingsService;

  const DAYS = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'];

  beforeEach(async () => {
    repo = new InMemorySettingsRepository();
    devos = new InMemoryDevotionalRepository();
    sched = new InMemoryScheduleRepository();
    await Promise.all([repo.init(), devos.init(), sched.init()]);
    await repo.saveSingleton(settings({ checkInDays: DAYS }));
    const now = '2026-01-01T00:00:00.000Z';
    for (let i = 0; i < DAYS.length; i++) {
      await devos.save({
        id: `d${i}`, day: DAYS[i]!, verse: `verse ${i + 1}`, reference: `Ref ${i + 1}`,
        reflection: '', prayer: '', createdAt: now, updatedAt: now,
      });
      await sched.save({
        id: `s${i}`, day: DAYS[i]!, startTime: '09:00', title: `Session ${i + 1}`, type: 'activity',
        createdAt: now, updatedAt: now,
      });
    }
    svc = makeSettingsService(repo, { devotionals: devos, schedule: sched });
  });

  const verseOn = async (day: string) =>
    (await devos.findAll()).find((d) => d.day === day)?.verse ?? null;
  const titleOn = async (day: string) =>
    (await sched.findAll()).find((s) => s.day === day)?.title ?? null;

  it('shifts devotionals and schedule with the camp when the dates move forward', async () => {
    const moved = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'];
    await svc.update(actor(), { startDate: moved[0], endDate: moved[3], checkInDays: moved });
    for (let i = 0; i < moved.length; i++) {
      expect(await verseOn(moved[i]!)).toBe(`verse ${i + 1}`);
      expect(await titleOn(moved[i]!)).toBe(`Session ${i + 1}`);
    }
    // Nothing is left behind on the old dates.
    expect(await verseOn(DAYS[0]!)).toBeNull();
  });

  it('handles an overlapping shift (camp moves one day later) without content colliding', async () => {
    // The classic failure: new day 1 IS old day 2, so a naive per-row update would overwrite
    // day 2's content with day 1's mid-pass.
    const moved = ['2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
    await svc.update(actor(), { startDate: moved[0], endDate: moved[3], checkInDays: moved });
    for (let i = 0; i < moved.length; i++) {
      expect(await verseOn(moved[i]!)).toBe(`verse ${i + 1}`);
    }
    expect((await devos.findAll())).toHaveLength(4); // nothing duplicated or lost
  });

  it('hides (does not delete) the surplus day when the camp shrinks to 3 days', async () => {
    const shorter = ['2026-08-10', '2026-08-11', '2026-08-12'];
    await svc.update(actor(), { startDate: shorter[0], endDate: shorter[2], checkInDays: shorter });
    for (let i = 0; i < shorter.length; i++) {
      expect(await verseOn(shorter[i]!)).toBe(`verse ${i + 1}`);
    }
    // Day 4's devotional stays on its old date — invisible to the UI, but recoverable if the
    // camp is lengthened again or the date was a typo.
    expect(await verseOn(DAYS[3]!)).toBe('verse 4');
    expect((await devos.findAll())).toHaveLength(4);
  });

  it('leaves content untouched when the dates do not change', async () => {
    await svc.update(actor(), { campName: 'Renamed' });
    for (let i = 0; i < DAYS.length; i++) {
      expect(await verseOn(DAYS[i]!)).toBe(`verse ${i + 1}`);
    }
  });
});
