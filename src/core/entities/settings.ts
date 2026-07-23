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
  // role are blocked at LOGIN only (existing sessions keep working until their token TTL).
  // Default false; admin/director/firstAid are never affected.
  churchLoginLocked: boolean;
  zoneLeaderLoginLocked: boolean;
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
