// Daily check-in sessions, derived purely from the camp's check-in days.
//
// Check-in is intentionally UNRELATED to the schedule (the schedule communicates the
// camp plan; check-in is the twice-daily roll-call). Each camp day has exactly two
// sessions — Morning and Afternoon — so leaders can check youth in whenever it suits
// the morning/afternoon rhythm. Session id is `${day}~am` / `${day}~pm` and is the key
// used in `Person.checkInHistory[].sessionId`. The delimiter is `~` (URL-safe) — NOT
// `#`, which a browser would treat as a URL fragment when the id is put in a path.

export interface CheckInSession {
  id: string;
  label: string;
  day: string;
  startTime: string;
  location: string | null;
}

export const CHECKIN_PERIODS = [
  { sfx: 'am' as const, label: 'AM', startTime: '08:00' },
  { sfx: 'pm' as const, label: 'PM', startTime: '13:00' },
] as const;

import type { CampSettings } from '../core/entities/settings';

// Before this clock time (camp tz) the Morning session is "current"; at/after it the
// Afternoon session is.
const PM_FROM = '12:00';

/**
 * P4 (2026-11-07): the session clock as DATA. The only place the timezone and window defaults
 * live. The server resolves its own rules from it, and `GET /checkin/sessions/:id/status` sends it
 * so the SPA's saved offline roster (ycp_roster_<login>) works the clock out the same way instead
 * of from hard-coded copies.
 */
export interface SessionClock {
  tz: string;
  /** Navigation: AM before this time, PM at/after it. */
  pmFrom: string;
  /** Church check-in restricted to the windows below. */
  restricted: boolean;
  windows: { amStart: string; amEnd: string; pmStart: string; pmEnd: string };
}

export function sessionClock(settings: CampSettings | null | undefined): SessionClock {
  return {
    tz: settings?.timezone || 'Australia/Brisbane',
    pmFrom: PM_FROM,
    restricted: !!settings?.churchCheckinTimeRestricted,
    windows: {
      amStart: settings?.checkinWindowAmStart ?? '06:00',
      amEnd: settings?.checkinWindowAmEnd ?? '12:00',
      pmStart: settings?.checkinWindowPmStart ?? '12:00',
      pmEnd: settings?.checkinWindowPmEnd ?? '22:00',
    },
  };
}

function weekdayShort(day: string): string {
  try {
    return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  } catch {
    return day;
  }
}

export function sessionFor(day: string, sfx: 'am' | 'pm'): CheckInSession {
  const p = CHECKIN_PERIODS.find((x) => x.sfx === sfx) ?? CHECKIN_PERIODS[0];
  return { id: `${day}~${sfx}`, label: `${weekdayShort(day)} ${p.label}`, day, startTime: p.startTime, location: null };
}

// AC-1: youth arrive at lunch on the first day and depart at lunch on the last day, so
// the first camp day generates a PM session only and the last camp day an AM session only.
// Interior days keep both AM and PM. A single-day camp is treated as an arrival day → PM only
// (the first-day rule wins over the last-day rule when they coincide).
export function buildSessions(checkInDays: readonly string[]): CheckInSession[] {
  const days = [...checkInDays].sort();
  const last = days.length - 1;
  return days.flatMap((d, i) => {
    if (i === 0) return [sessionFor(d, 'pm')];
    if (i === last) return [sessionFor(d, 'am')];
    return CHECKIN_PERIODS.map((p) => sessionFor(d, p.sfx));
  });
}

export function parseSessionId(id: string): { day: string; sfx: 'am' | 'pm' } | null {
  const m = /^(.+)~(am|pm)$/.exec(id);
  if (!m) return null;
  return { day: m[1] as string, sfx: m[2] as 'am' | 'pm' };
}

// Item 11: hard AM/PM check-in windows (church accounts only, admin-editable, on by
// default). Returns the single session a check-in is allowed to target right now, or
// null if check-in is closed (outside camp days entirely, or between/outside the
// configured windows). Pure — no settings/actor lookups here.
export function allowedWindowSession(
  days: readonly string[],
  today: string,
  nowTime: string,
  windows: { amStart: string; amEnd: string; pmStart: string; pmEnd: string },
): CheckInSession | null {
  if (!days.includes(today)) return null;
  const sessions = buildSessions(days);
  const amSession = sessions.find((s) => s.id === `${today}~am`);
  const pmSession = sessions.find((s) => s.id === `${today}~pm`);
  if (nowTime >= windows.amStart && nowTime < windows.amEnd && amSession) return amSession;
  if (nowTime >= windows.pmStart && nowTime < windows.pmEnd && pmSession) return pmSession;
  return null;
}

// The session a leader should land on now: today's AM before midday / PM after; if no
// session today, the most recent past session; otherwise the first upcoming one.
export function currentSession(
  checkInDays: readonly string[],
  todayStr: string,
  nowTime: string,
): CheckInSession | null {
  const sessions = buildSessions(checkInDays);
  if (sessions.length === 0) return null;
  const todays = sessions.filter((s) => s.day === todayStr);
  if (todays.length > 0) {
    const wantPm = nowTime >= PM_FROM;
    return todays.find((s) => s.id.endsWith(wantPm ? '~pm' : '~am')) ?? todays[0]!;
  }
  const past = sessions.filter((s) => s.day < todayStr);
  if (past.length > 0) return past[past.length - 1]!;
  return sessions[0]!;
}
