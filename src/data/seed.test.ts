import { describe, it, expect } from 'vitest';
import { seedAll } from './seed';
import type { Container } from '../container';
import {
  InMemoryUserRepository,
  InMemoryChurchRepository,
  InMemorySettingsRepository,
  InMemoryClassroomRepository,
  InMemoryScheduleRepository,
} from '../repositories/in-memory';

/**
 * seedAll only touches repos.users/churches/settings/classrooms/schedule, so a minimal
 * in-memory container is enough here (no services needed) — no existing test file builds a
 * full container through seedAll, so this follows the in-memory repo factory pattern used by
 * container.ts's memory branch directly, per the Step 1 fallback.
 */
async function buildTestContainer(): Promise<Container> {
  const repos = {
    users: new InMemoryUserRepository(),
    churches: new InMemoryChurchRepository(),
    settings: new InMemorySettingsRepository(),
    classrooms: new InMemoryClassroomRepository(),
    schedule: new InMemoryScheduleRepository(),
  };
  return { repos } as unknown as Container;
}

describe('seedAll settings', () => {
  it('seeds live check-in values and does not seed prices or tags', async () => {
    const container = await buildTestContainer();
    await seedAll(container);
    const s = await container.repos.settings.getSingleton();
    expect(s).not.toBeNull();
    expect(s!.checkinSwitchoverTime).toBe('16:00');
    expect(s!.checkinWindowAmStart).toBe('05:00');
    expect(s!.checkinWindowAmEnd).toBe('12:00');
    expect(s!.checkinWindowPmStart).toBe('12:00');
    expect(s!.checkinWindowPmEnd).toBe('23:30');
    expect(s!.campMode).toBe('pre-camp');
    expect(s!.tentPrice ?? null).toBeNull();
    expect(Object.keys(s!.discountCodeTags ?? {})).toHaveLength(0);
  });
});
