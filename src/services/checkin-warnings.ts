import type { CampSettings } from '../core/entities/settings';
import type { Person } from '../core/entities/person';
import type { User } from '../core/entities/user';
import type { CheckInSession } from './checkin-sessions';
import { allowedWindowSession, currentSession } from './checkin-sessions';
import { canAccessPerson } from './person.service';
import { toActor } from './auth.service';
import { zonedNow, zonedToInstant } from '../utils/date';

/** Mirrors checkin.service.ts — must stay byte-identical or reminder and enforcement disagree. */
const DEFAULT_TZ = 'Australia/Brisbane';
/** How long before a window closes to warn. Design D4. */
export const WARN_LEAD_MINUTES = 60;

export interface ChurchBehind {
  userId: string;
  churchId: string;
  sessionId: string;
  sessionLabel: string;
  remaining: number;
  /** 'HH:MM' — the closing time, for the notice copy. */
  windowEnd: string;
  /** The same closing time as a UTC instant, so the notice can expire when it goes stale. */
  windowEndAt: string;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Checked-in for a session, matching `toRosterEntry` in src/api/dto/person.dto.ts EXACTLY:
 * the LAST entry for that session wins. A student checked in and then out is NOT checked in.
 * Diverging from this makes the push count disagree with the roster the leader is reading.
 */
function isCheckedIn(p: Person, sessionId: string): boolean {
  const entries = p.checkInHistory.filter((e) => e.sessionId === sessionId);
  const last = entries[entries.length - 1];
  return last?.type === 'in';
}

export interface WarnWindow {
  session: CheckInSession;
  windowEnd: string;
  /**
   * `windowEnd` as a UTC instant. Computed here, where the camp timezone is already in hand —
   * a caller that rebuilt it from `windowEnd` alone would have to re-derive the zone and is
   * exactly where the UTC-vs-Brisbane offset bug would creep back in.
   */
  windowEndAt: string;
}

/**
 * The settings-only half of the warning check: is there a session whose window closes
 * within WARN_LEAD_MINUTES right now? Pure and cheap — no people, no users. The tick
 * calls this FIRST so an idle tick never touches the people table.
 */
export function warnWindow(settings: CampSettings, now: Date): WarnWindow | null {
  // D4 condition 1: with the restriction off, the window times exist but are not a real
  // deadline, so "closing soon" would be misleading.
  if (!settings.churchCheckinTimeRestricted) return null;

  const tz = settings.timezone || DEFAULT_TZ;
  const days = settings.checkInDays ?? [];
  const { date, time } = zonedNow(tz, now);

  // Resolve windows IDENTICALLY to checkin.service.assertSessionAllowed.
  const windows = {
    amStart: settings.checkinWindowAmStart ?? '06:00',
    amEnd: settings.checkinWindowAmEnd ?? '12:00',
    pmStart: settings.checkinWindowPmStart ?? '12:00',
    pmEnd: settings.checkinWindowPmEnd ?? '22:00',
  };

  // The one session currently open. Returns null off a camp day, outside both windows, or —
  // via buildSessions/AC-1 — when the day simply has no session of that half (first camp day
  // is PM-only, last day is AM-only). That null is what stops us inventing a phantom session.
  const session = allowedWindowSession(days, date, time, windows);
  if (!session) return null;

  const windowEnd = session.id.endsWith('~am') ? windows.amEnd : windows.pmEnd;
  const minutesLeft = toMinutes(windowEnd) - toMinutes(time);
  if (minutesLeft <= 0 || minutesLeft > WARN_LEAD_MINUTES) return null;

  // `session.day`, not `date`: identical in practice (the session was resolved from `date`),
  // but it ties the instant to the session the notice is actually about.
  const windowEndAt = zonedToInstant(tz, session.day, windowEnd) ?? new Date(now).toISOString();

  return { session, windowEnd, windowEndAt };
}

/**
 * A `WarnWindow` for the admin's TEST button, resolved without the timing gate.
 *
 * `warnWindow` requires a camp day, an open window and ≤60 minutes left — all four
 * conditions at once — which is precisely why the feature could never be rehearsed before
 * it had to work. This picks the session an admin would consider "current":
 *
 *  1. the session check-in is genuinely open for right now, if there is one (highest
 *     fidelity — the test then counts exactly what the real warning would count); else
 *  2. `currentSession`, which is today's AM/PM if today is a camp day, otherwise the most
 *     recent past session, otherwise the first upcoming one.
 *
 * Returns null only when the camp has no check-in days at all — with none, there is no
 * session to count against and nothing meaningful to send.
 *
 * `windowEndAt` is a real instant so the test notices EXPIRE like real ones. Off a camp day
 * that instant is in the past, which would make `findActive()` hide them immediately, so the
 * caller is given a floor — see `CHECKIN_TEST_TTL_MINUTES`.
 */
export const CHECKIN_TEST_TTL_MINUTES = 60;

export function testWarnWindow(settings: CampSettings, now: Date): WarnWindow | null {
  const tz = settings.timezone || DEFAULT_TZ;
  const days = settings.checkInDays ?? [];
  if (days.length === 0) return null;

  const { date, time } = zonedNow(tz, now);
  const windows = {
    amStart: settings.checkinWindowAmStart ?? '06:00',
    amEnd: settings.checkinWindowAmEnd ?? '12:00',
    pmStart: settings.checkinWindowPmStart ?? '12:00',
    pmEnd: settings.checkinWindowPmEnd ?? '22:00',
  };

  const session =
    allowedWindowSession(days, date, time, windows) ?? currentSession(days, date, time);
  if (!session) return null;

  const windowEnd = session.id.endsWith('~am') ? windows.amEnd : windows.pmEnd;
  const natural = zonedToInstant(tz, session.day, windowEnd);
  // Floor the expiry so a test fired outside camp season doesn't create notices that
  // findActive() filters out the instant they are written.
  const floor = new Date(now.getTime() + CHECKIN_TEST_TTL_MINUTES * 60 * 1000).toISOString();
  const windowEndAt = natural && natural > floor ? natural : floor;

  return { session, windowEnd, windowEndAt };
}

/**
 * Which church LOGINS still have students unchecked for a session whose window closes within
 * WARN_LEAD_MINUTES?
 *
 * Per LOGIN, not per church: church accounts are gender-scoped (`b-`/`g-`), so `b-victory`
 * must only ever be told about students it can actually see and act on.
 *
 * Pure — no repositories, no `new Date()`. `now` is injected so the timezone boundary is
 * testable, which matters: this codebase has been bitten by UTC-vs-Brisbane twice.
 */
export function churchesBehind(
  settings: CampSettings,
  people: Person[],
  users: User[],
  now: Date,
): ChurchBehind[] {
  const gate = warnWindow(settings, now);
  if (!gate) return [];
  return churchesBehindFor(people, users, gate);
}

/**
 * The counting half, split out from the timing half (2026-07-31).
 *
 * `churchesBehind` is gated on `warnWindow`, which is exactly right in production and
 * exactly wrong for the admin's test button: today is not a camp day, so the real gate
 * returns null and there is nothing to test until the morning the feature matters. The
 * admin test resolves its own `WarnWindow` (see `testWarnWindow`) and calls this.
 *
 * ⚠ Both callers share THIS function on purpose. The counting rule — present, non-leader,
 * per gender-scoped LOGIN, last check-in entry wins — is the thing the test needs to
 * exercise. A test that reimplemented the count would prove only that the second
 * implementation works.
 *
 * `includeZero` is the one behavioural difference: production never sends "0 students still
 * to check in" (design D4 condition 4), but a test run that silently produced nothing
 * because everyone happens to be checked in would look like a broken button.
 */
export function churchesBehindFor(
  people: Person[],
  users: User[],
  gate: WarnWindow,
  opts: { includeZero?: boolean } = {},
): ChurchBehind[] {
  const { session, windowEnd, windowEndAt } = gate;

  // Same roster population as checkin.service.getSessionStatus: present, non-leader.
  const roster = people.filter((p) => p.atCamp && p.kind !== 'leader');

  const out: ChurchBehind[] = [];
  for (const u of users) {
    if (u.role !== 'church') continue;
    if (u.status !== 'active') continue;
    if (!u.churchId) continue;

    const actor = toActor(u);
    const remaining = roster.filter(
      (p) => canAccessPerson(actor, p) && !isCheckedIn(p, session.id),
    ).length;

    // D4 condition 4: never send "0 students still to check in".
    if (remaining === 0 && !opts.includeZero) continue;

    out.push({
      userId: u.id,
      churchId: u.churchId,
      sessionId: session.id,
      sessionLabel: session.label,
      remaining,
      windowEnd,
      windowEndAt,
    });
  }
  return out;
}
