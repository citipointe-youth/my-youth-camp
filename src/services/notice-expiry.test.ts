import { describe, it, expect } from 'vitest';
import { defaultNoticeExpiry, NOTICE_TTL_HOURS } from './notification.service';

/**
 * Notices expire six hours after they PUBLISH (2026-07-31). The distinction between publish
 * time and composition time is the whole reason this is a function rather than one inline
 * addition — getting it wrong makes a scheduled notice expire before it is ever visible.
 */
describe('defaultNoticeExpiry', () => {
  const HOUR = 60 * 60 * 1000;

  it('is six hours after the publish instant', () => {
    const at = '2026-09-28T02:00:00.000Z';
    const out = defaultNoticeExpiry(at);
    expect(new Date(out).getTime() - new Date(at).getTime()).toBe(NOTICE_TTL_HOURS * HOUR);
  });

  it('measures from the SCHEDULED time, so a notice composed days early is not born dead', () => {
    const composedAt = '2026-09-25T00:00:00.000Z';
    const publishAt = '2026-09-28T07:00:00.000Z';
    const out = defaultNoticeExpiry(publishAt);
    // The expiry must be after the publish time, not three days before it.
    expect(new Date(out).getTime()).toBeGreaterThan(new Date(publishAt).getTime());
    expect(new Date(out).getTime()).toBeGreaterThan(new Date(composedAt).getTime());
  });

  it('an explicit expiry always wins — this changes the DEFAULT, not the capability', () => {
    const explicit = '2026-12-25T00:00:00.000Z';
    expect(defaultNoticeExpiry('2026-09-28T02:00:00.000Z', explicit)).toBe(explicit);
  });

  it('treats null/undefined as "no explicit value" and falls back to the default', () => {
    const at = '2026-09-28T02:00:00.000Z';
    expect(defaultNoticeExpiry(at, null)).toBe(defaultNoticeExpiry(at));
    expect(defaultNoticeExpiry(at, undefined)).toBe(defaultNoticeExpiry(at));
  });

  it('returns a real ISO instant (not a wall-clock string) — the UTC/Brisbane trap', () => {
    const out = defaultNoticeExpiry('2026-09-28T02:00:00.000Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
