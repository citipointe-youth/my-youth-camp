import type { ISODateString } from '../types/common';
import type { CampMode } from '../types/enums';

export const SETTINGS_ID = 'settings' as const;

export interface CampSettings {
  id: typeof SETTINGS_ID;
  campName: string;
  year: number;
  startDate: string;
  endDate: string;
  timezone: string;
  // Pre-camp
  checkInBanner?: string | null;
  // At-camp
  checkInDays: string[];
  accommodationLocked: boolean;
  // Account login locks (manual toggles in admin Settings). When true, accounts of that
  // role are blocked at LOGIN. Default false; admin/director/firstAid are never affected.
  churchLoginLocked: boolean;
  zoneLeaderLoginLocked: boolean;
  /**
   * Per-role session revocation epoch (2026-08-05). Stamped automatically to "now" the moment
   * `churchLoginLocked`/`zoneLeaderLoginLocked` flips false->true (see `settings.service.ts`
   * `update()`) — there is deliberately NO separate admin control for these two fields. Any
   * token for that role whose `issuedAt` predates this timestamp is revoked in
   * `auth.service.ts` `resolveToken`, so locking a role also kills sessions already issued to
   * it, not just new logins. Turning the lock back OFF does NOT clear the stamp — a fresh login
   * mints a newer `issuedAt` and works fine, while old tokens stay dead. `null` = never locked
   * (or the deploy predates this feature) = no revocation check for that role.
   * PER-ROLE, NOT ONE GLOBAL EPOCH: a single shared epoch would sign out admin/director/firstAid
   * the moment churches are locked, which they must never be affected by.
   */
  churchSessionsValidFrom?: string | null;
  zoneLeaderSessionsValidFrom?: string | null;
  // When true, church accounts (only) may only submit a daily check-in for the CURRENT
  // session (by real clock time) — not other days/sessions. Before camp starts, the first
  // session (day 1 PM) is treated as "current" so churches aren't locked out entirely.
  // zoneLeader/director/admin are never restricted. Default false.
  churchCheckinTimeRestricted: boolean;
  // Unified arrival→daily switchover (at-camp). Client-side phase model (serverless, no scheduler).
  // Clock time 'HH:MM' (24h, Brisbane) at which Day-1 arrival sign-in gives way to daily check-in.
  checkinSwitchoverTime: string;
  // Manual admin override of the arrival/daily phase. 'auto' = time-driven (the normal case);
  // 'signin'/'checkin' pin the phase across the app until set back to 'auto'.
  checkinPhaseOverride: 'auto' | 'signin' | 'checkin';
  // Item 11: hard AM/PM check-in windows for church accounts (only enforced when
  // churchCheckinTimeRestricted is true). 'HH:MM' 24h strings. Optional so existing
  // fixtures compile; defaults applied on read: AM 06:00-12:00, PM 12:00-22:00.
  checkinWindowAmStart?: string;
  checkinWindowAmEnd?: string;
  checkinWindowPmStart?: string;
  checkinWindowPmEnd?: string;
  // Mode switch
  campMode: CampMode;
  // Temp passwords from the most recent new-year rollover, cleared after export.
  lastTempPasswords?: Array<{ username: string; tempPassword: string }> | null;
  // Timestamp of the last successful audit export; wipe guard requires this to be set.
  lastExportedAt?: string | null;
  // Timestamp of the last successful "Save Defaults" snapshot (shown on the Data screen +
  // the close-out checklist). Null until the admin has saved a baseline this setup.
  defaultsSavedAt?: string | null;
  // Timestamp of the last successful import of each source (shown on the upload screen so the
  // admin can see which files have been brought in and when). Null until first imported.
  formImportedAt?: string | null;
  ticketsImportedAt?: string | null;
  invoicesImportedAt?: string | null;
  /**
   * DEPRECATED (2026-07-29) — superseded by `discountCodeTags`. Per-discount-code override
   * amounts, code -> dollars. Nothing reads this any more; the column is left in place and
   * still round-trips so a rollback is possible. Migration `0017` seeded `discountCodeTags`
   * with `'inperson'` for every key that was in here, which is what the field always meant.
   */
  discountCodeOverrides?: Record<string, number>;
  /**
   * How the admin has classified each discount code, code -> 'inperson' | 'sponsor' |
   * 'discount'. This is the payment half of a ticket's budget classification (the other half
   * is the person's accommodationKind) — see `src/services/budget.ts`. A code that is absent
   * here is a plain full-price ticket. Empty object = nothing tagged.
   * Optional (like the checkinWindow* fields above) so existing fixtures compile; defaults to
   * {} wherever read.
   */
  discountCodeTags?: Record<string, 'inperson' | 'sponsor' | 'discount'>;
  /**
   * Admin-set reference prices for a full-price ticket, in dollars. These are the "no-code
   * invoice" prices every discount code is defined against: they value a ticket whose code is
   * tagged 'inperson' (money collected by hand, so no invoice records it) and they are what
   * "discounted" is measured against on the Budget screen.
   *
   * ⚠ These two columns existed once before and were deliberately DROPPED by migration `0004`,
   * when the budget moved to per-registrant `registrationCost`. They came back in `0017` for
   * the classification rework and now have a narrower job: a reference price, NOT the source
   * of every registrant's cost. Don't restore the old "price × headcount" behaviour.
   * Null = not set, which makes the 'inperson' tag fall back to the person's recorded amount.
   */
  tentPrice?: number | null;
  classroomPrice?: number | null;
  /**
   * Item 8 (2026-07-28): the camp site map, shown behind the "Map" button on the Home hero.
   * A `data:image/...` URI baked client-side by the crop tool (the same approach YS Connection
   * uses for its logo) — the server never processes image bytes, it just stores an opaque
   * string. Null when no map has been uploaded, which is also what hides the Map button.
   * Optional like the other late-added fields so existing fixtures compile.
   */
  siteMapImage?: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CampDefaults {
  id: 'defaults';
  churches: unknown[];
  users: unknown[];
  classrooms: unknown[];
  faqs: unknown[];
  schedule: unknown[];
  devotionals: unknown[];
  createdAt: ISODateString;
}
