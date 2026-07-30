import type {
  IPersonRepository,
  INotificationRepository,
  IChurchRepository,
} from '../repositories/interfaces/entity-repositories';
import type { CampSettings } from '../core/entities/settings';
import type { Actor } from '../core/entities/user';
import { daysUntil, zonedNow, nowISO } from '../utils/date';
import { canSeeNotification, byPublishedDesc } from './notification-visibility';
import { buildSessions, currentSession as pickCurrentSession } from './checkin-sessions';
import type { Person } from '../core/entities/person';
import { isRegistrant, isCamper } from '../core/entities/person';
import { canAccessPerson } from './person.service';
import { getCachedDashboard, setCachedDashboard } from './dashboard-cache';

export { invalidateDashboardCache } from './dashboard-cache';

export interface PreCampDashboard {
  mode: 'pre-camp';
  campName: string;
  year: number;
  startDate: string;
  daysToGo: number;
  totalRegistrants: number;
  totalCampers: number;
  totalLeaders: number;
  // PC-3: "unpaid" is not an app concept. All uploaded registrations are confirmed;
  // payment is surfaced only in Budget. No unpaid count on the home DTO.
  noBlueCardCount: number;
  accommodationSummary: Array<{
    kind: string;
    label: string;
    campers: number;
  }>;
  perChurchBreakdown?: Array<{
    churchId: string;
    churchName: string;
    zone: string;
    registrants: number;
    noBlueCard: number;
  }>;
}

export interface AtCampDashboard {
  mode: 'at-camp';
  campName: string;
  greetingName: string;
  totalAtCamp: number;
  totalExpected: number;
  checkInsDue: number;
  /**
   * New Feature 2 (director/admin morning digest): the population subject to the CURRENT
   * session's check-in (atCamp, non-leader) — same population `checkInsDue` is computed
   * against. Exposed so the SPA can derive "X/Y checked in this session" as
   * (sessionExpected - checkInsDue) / sessionExpected without a second fetch. 0 when there's
   * no current session.
   */
  sessionExpected: number;
  currentSession: { id: string; label: string; day: string; startTime: string } | null;
  nextSession: { id: string; label: string; day: string; startTime: string } | null;
  latestNotification: { title: string; body: string; priority: string; createdAt: string } | null;
}

export type DashboardResult = PreCampDashboard | AtCampDashboard;

export interface DashboardService {
  home(actor: Actor, settings: CampSettings): Promise<DashboardResult>;
}

export function makeDashboardService(
  personRepo: IPersonRepository,
  notifRepo: INotificationRepository,
  churchRepo: IChurchRepository,
): DashboardService {
  /**
   * The narrowest repo query the actor's scope allows.
   *
   * A church login can only ever see its own church's people (`canAccessPerson` enforces
   * that, and narrows further by `genderScope`), but this used to call `findAll()` — which
   * on Supabase means `people` PLUS every row of `check_in_history` and `sign_out_history`,
   * unbounded. At camp that is ~700 people and ~3,500 history rows fetched and decrypted on
   * every uncached request, to then throw away all but the ~30 the church may see.
   *
   * ⚠ This is a FETCH-VOLUME optimisation only. `canAccessPerson` below remains the actual
   * access gate and MUST stay — `findByChurch` does not know about `genderScope`, so
   * removing that filter would show `b-victory` the girls' numbers. Narrowing the query
   * cannot widen access; it can only reduce what is read.
   *
   * Deliberately NOT extended to `zoneLeader` via `findByZone`: a zone leader's scope is
   * the zone, but `canAccessPerson` also admits people whose church sits in that zone, and
   * the two are not guaranteed to agree on a person whose church has been re-zoned. The
   * church case is exact, so only it is narrowed. Mirrors the `_scoped`/`scopedAll` →
   * `findByChurch` fast path already used by `/registrants` and `/campers`.
   */
  async function personsInScope(actor: Actor): Promise<Person[]> {
    if (actor.role === 'church' && actor.churchId) {
      return personRepo.findByChurch(actor.churchId);
    }
    return personRepo.findAll();
  }

  return {
    async home(actor, settings) {
      const cached = getCachedDashboard(actor);
      if (cached) return cached;

      if (settings.campMode === 'pre-camp') {
        // Pre-camp dashboard
        const allPersons = await personsInScope(actor);
        // Scope through canAccessPerson (the single RBAC chokepoint) so gender-scoped church
        // logins (Feature 2) see only their gender's registrants here too.
        const scoped = allPersons.filter((p) => isRegistrant(p) && canAccessPerson(actor, p));

        const noBlueCardCount = scoped.filter((p) => p.kind === 'leader' && p.blueCardNumber == null).length;

        // Head counts by accommodation kind (blocks removed; capacity is no longer
        // modelled — tents auto-distribute, classrooms are allocated by room).
        const tentN = scoped.filter((p) => p.accommodationKind === 'tent').length;
        const classroomN = scoped.filter((p) => p.accommodationKind === 'classroom').length;
        const accommodationSummary = [
          { kind: 'tent', label: 'Tent City', campers: tentN },
          { kind: 'classroom', label: 'Classrooms', campers: classroomN },
        ];

        const dashboard: PreCampDashboard = {
          mode: 'pre-camp',
          campName: settings.campName,
          year: settings.year,
          startDate: settings.startDate,
          daysToGo: daysUntil(settings.startDate, settings.timezone),
          totalRegistrants: scoped.length,
          totalCampers: scoped.filter((p) => p.kind === 'youth').length,
          totalLeaders: scoped.filter((p) => p.kind === 'leader').length,
          noBlueCardCount,
          accommodationSummary,
        };

        if (actor.role === 'admin' || actor.role === 'director') {
          const churches = await churchRepo.findAll();
          const breakdown = churches.map((ch) => {
            const churchRegs = scoped.filter((p) => p.churchId === ch.id);
            return {
              churchId: ch.id,
              churchName: ch.name,
              zone: ch.zone,
              registrants: churchRegs.length,
              noBlueCard: churchRegs.filter((p) => p.kind === 'leader' && p.blueCardNumber == null).length,
            };
          });
          dashboard.perChurchBreakdown = breakdown;
        }

        setCachedDashboard(actor, dashboard);
        return dashboard;
      } else {
        // At-camp dashboard.
        // D2 FIX: scope every at-camp number to the actor (church → own church,
        // zoneLeader → own zone, director/admin → all). Previously totalExpected /
        // checkInsDue counted the WHOLE camp for every role, so a church login saw
        // camp-wide figures presented as its own.
        const allPersons = await personsInScope(actor);
        const allCampers = allPersons.filter((p) => isCamper(p) && canAccessPerson(actor, p));
        const totalAtCamp = allCampers.filter((p) => p.atCamp).length;
        const totalExpected = allCampers.length; // isCamper already excludes cancelled

        // Check-in sessions are derived from the camp's check-in days (settings), not
        // the schedule — two per day (AM/PM). B3 FIX: today + now from the camp tz.
        const { date: todayStr, time: nowTime } = zonedNow(settings.timezone || 'Australia/Brisbane');
        const days = settings.checkInDays ?? [];
        const todaySessions = buildSessions(days).filter((s) => s.day === todayStr);
        // H-2 FIX: use the SHARED currentSession helper (AM before 12:00 / PM at-or-after),
        // exactly as checkin.service does — the bespoke `startTime <= now` calc here used the
        // PM startTime (13:00) and so disagreed with check-in for the whole 12:00–13:00 window
        // (dashboard counted "due" against AM while a leader tapping Check-in landed on PM).
        const current = pickCurrentSession(days, todayStr, nowTime);
        // Only treat it as today's current session if it actually falls today (the helper can
        // fall back to a past/future session when there are none today — the dashboard shows
        // no current/next session in that case, matching the prior null behaviour).
        const currentSession = current && current.day === todayStr ? current : null;
        // Next = the session after the current one in today's ordering (AM → PM; nothing after PM).
        const curIdx = currentSession ? todaySessions.findIndex((s) => s.id === currentSession.id) : -1;
        const nextSession = curIdx >= 0 ? todaySessions[curIdx + 1] ?? null : (todaySessions[0] ?? null);

        // Audience rules come from canSeeNotification — the SAME predicate the /notifications
        // feed uses. This used to be a hand-rolled copy of them, and it had drifted: it never
        // implemented the `scheduledFor` withhold, so a notice scheduled days ahead was returned
        // here (title AND body) the moment it was composed, while the feed correctly hid it. It
        // also denied admin/director the see-every-scope rule they have everywhere else.
        // Do not re-inline these rules; there is one copy for a reason.
        const notifications = await notifRepo.findActive();
        const nowIso = nowISO();
        const relevantNotifs = notifications
          .filter((n) => canSeeNotification(actor, n, nowIso))
          .sort(byPublishedDesc);
        const latestNotif = relevantNotifs[0] ?? null;

        // D3 FIX: "due" is measured against the CURRENT session specifically, and
        // respects check-OUT. A camper is due if their latest entry for the current
        // session is not an 'in' (i.e. never checked in, or has since checked out).
        // Previously any 'in' for ANY of today's sessions marked them done for the
        // whole day — wrong for a twice-daily camp.
        // Only count persons physically at camp (atCamp===true) — isCamper() includes
        // 'departed' lifecycle which has atCamp:false and must not inflate this count.
        // Leaders are excluded — they're never on the twice-daily check-in roster (see
        // checkin.service), so they'd never get a checkInHistory entry and would sit
        // permanently "due" once bulk-signed-in at the mode switch.
        const atCampNow = allCampers.filter((p) => p.atCamp && p.kind !== 'leader');
        const checkInsDue = currentSession
          ? atCampNow.filter((p) => {
              const entries = p.checkInHistory.filter((e) => e.sessionId === currentSession.id);
              const last = entries[entries.length - 1];
              return last?.type !== 'in';
            }).length
          : 0;
        const sessionExpected = currentSession ? atCampNow.length : 0;

        const dashboard: AtCampDashboard = {
          mode: 'at-camp',
          campName: settings.campName,
          // Bug 14 (2026-07-28): was `displayName.split(' ')[0]`, which turned a church login
          // named "Citipointe Pine Rivers" into "Hi Citipointe" — a real ambiguity when several
          // campuses share a first word. A church account's displayName IS the ministry name and
          // must be shown in full; a personal leadership login still greets by first name.
          greetingName:
            actor.role === 'church'
              ? actor.displayName
              : (actor.displayName.split(' ')[0] ?? actor.displayName),
          totalAtCamp,
          totalExpected,
          checkInsDue,
          sessionExpected,
          currentSession: currentSession
            ? { id: currentSession.id, label: currentSession.label, day: currentSession.day, startTime: currentSession.startTime }
            : null,
          nextSession: nextSession
            ? { id: nextSession.id, label: nextSession.label, day: nextSession.day, startTime: nextSession.startTime }
            : null,
          latestNotification: latestNotif
            ? { title: latestNotif.title, body: latestNotif.body, priority: latestNotif.priority, createdAt: latestNotif.createdAt }
            : null,
        };

        setCachedDashboard(actor, dashboard);
        return dashboard;
      }
    },
  };
}
