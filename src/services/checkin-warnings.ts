import type { CampSettings } from '../core/entities/settings';
import type { Person } from '../core/entities/person';
import type { User } from '../core/entities/user';
import type { CheckInSession } from './checkin-sessions';
import { allowedWindowSession } from './checkin-sessions';
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
    if (remaining === 0) continue;

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
