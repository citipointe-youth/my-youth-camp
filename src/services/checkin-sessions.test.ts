import { describe, it, expect } from 'vitest';
import { allowedWindowSession, buildSessions, currentSession, parseSessionId } from './checkin-sessions';

// AC-1: youth arrive at lunch on the first day (PM session only) and depart at lunch on
// the last day (AM session only). Interior days keep both AM and PM. A single-day camp is
// treated as an arrival day (PM only).

describe('buildSessions — AC-1 first/last day rules', () => {
  it('single-day camp → PM only (arrival day)', () => {
    expect(buildSessions(['2026-07-01']).map((s) => s.id)).toEqual(['2026-07-01~pm']);
  });

  it('two-day camp → day1 PM, day2 AM', () => {
    expect(buildSessions(['2026-07-01', '2026-07-02']).map((s) => s.id)).toEqual([
      '2026-07-01~pm',
      '2026-07-02~am',
    ]);
  });

  it('three-day camp → PM, AM+PM, AM', () => {
    expect(buildSessions(['2026-07-01', '2026-07-02', '2026-07-03']).map((s) => s.id)).toEqual([
      '2026-07-01~pm',
      '2026-07-02~am',
      '2026-07-02~pm',
      '2026-07-03~am',
    ]);
  });

  it('five-day camp → PM, [AM,PM]×3, AM', () => {
    const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
    expect(buildSessions(days).map((s) => s.id)).toEqual([
      '2026-07-01~pm',
      '2026-07-02~am', '2026-07-02~pm',
      '2026-07-03~am', '2026-07-03~pm',
      '2026-07-04~am', '2026-07-04~pm',
      '2026-07-05~am',
    ]);
  });

  it('is order-independent (sorts the input days)', () => {
    expect(buildSessions(['2026-07-03', '2026-07-01', '2026-07-02']).map((s) => s.id)).toEqual(
      buildSessions(['2026-07-01', '2026-07-02', '2026-07-03']).map((s) => s.id),
    );
  });

  it('empty camp → no sessions', () => {
    expect(buildSessions([])).toEqual([]);
  });
});

describe('currentSession — still resolves within the AC-1 session set', () => {
  const days = ['2026-07-01', '2026-07-02', '2026-07-03'];

  it('on the first day (PM only) before midday → still lands on that PM session', () => {
    expect(currentSession(days, '2026-07-01', '09:00')?.id).toBe('2026-07-01~pm');
  });

  it('on the last day (AM only) in the afternoon → lands on that AM session', () => {
    expect(currentSession(days, '2026-07-03', '15:00')?.id).toBe('2026-07-03~am');
  });

  it('on an interior day picks AM before midday, PM after', () => {
    expect(currentSession(days, '2026-07-02', '09:00')?.id).toBe('2026-07-02~am');
    expect(currentSession(days, '2026-07-02', '15:00')?.id).toBe('2026-07-02~pm');
  });
});

describe('parseSessionId', () => {
  it('round-trips ids built by buildSessions', () => {
    for (const s of buildSessions(['2026-07-01', '2026-07-02', '2026-07-03'])) {
      const parsed = parseSessionId(s.id);
      expect(parsed).not.toBeNull();
      expect(`${parsed!.day}~${parsed!.sfx}`).toBe(s.id);
    }
  });
});

describe('allowedWindowSession — item 11 hard AM/PM windows', () => {
  const days = ['2026-07-01', '2026-07-02', '2026-07-03'];
  const windows = { amStart: '06:00', amEnd: '12:00', pmStart: '12:00', pmEnd: '22:00' };

  it('in the AM window on an interior day returns the AM session', () => {
    const result = allowedWindowSession(days, '2026-07-02', '08:00', windows);
    expect(result?.id).toBe('2026-07-02~am');
  });

  it('in the PM window on an interior day returns the PM session', () => {
    const result = allowedWindowSession(days, '2026-07-02', '15:00', windows);
    expect(result?.id).toBe('2026-07-02~pm');
  });

  it('outside both windows returns null', () => {
    expect(allowedWindowSession(days, '2026-07-02', '23:00', windows)).toBeNull();
    expect(allowedWindowSession(days, '2026-07-02', '02:00', windows)).toBeNull();
  });

  it('a non-camp day returns null even if the time is inside a window', () => {
    expect(allowedWindowSession(days, '2026-07-10', '08:00', windows)).toBeNull();
  });

  it('day-1 is PM-only — the AM window on day 1 returns null (no AM session exists)', () => {
    expect(allowedWindowSession(days, '2026-07-01', '08:00', windows)).toBeNull();
  });

  it('day-1 in the PM window returns the PM session', () => {
    const result = allowedWindowSession(days, '2026-07-01', '15:00', windows);
    expect(result?.id).toBe('2026-07-01~pm');
  });

  it('last day is AM-only — the PM window on the last day returns null (no PM session exists)', () => {
    expect(allowedWindowSession(days, '2026-07-03', '15:00', windows)).toBeNull();
  });

  it('last day in the AM window returns the AM session', () => {
    const result = allowedWindowSession(days, '2026-07-03', '08:00', windows);
    expect(result?.id).toBe('2026-07-03~am');
  });

  it('the boundary end time is exclusive (amEnd not allowed, treated as PM start)', () => {
    // At exactly 12:00 the AM window has ended (nowTime < amEnd fails) and the PM window
    // (12:00 inclusive) has begun.
    const result = allowedWindowSession(days, '2026-07-02', '12:00', windows);
    expect(result?.id).toBe('2026-07-02~pm');
  });
});
