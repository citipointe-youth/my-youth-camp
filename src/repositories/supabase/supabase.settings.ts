import type { SqlClient } from './client';
import type { ISettingsRepository } from '../interfaces/entity-repositories';
import type { CampSettings } from '../../core/entities/settings';
import { SETTINGS_ID } from '../../core/entities/settings';

function toSettings(r: Record<string, unknown>): CampSettings {
  return {
    id: SETTINGS_ID,
    campName: r['camp_name'] as string,
    year: r['year'] as number,
    startDate: r['start_date'] as string,
    endDate: r['end_date'] as string,
    timezone: r['timezone'] as string,
    checkInBanner: (r['check_in_banner'] as string | null) ?? undefined,
    checkInDays: (r['check_in_days'] as string[] | null) ?? [],
    accommodationLocked: r['accommodation_locked'] as boolean,
    churchLoginLocked: (r['church_login_locked'] as boolean | null) ?? false,
    zoneLeaderLoginLocked: (r['zone_leader_login_locked'] as boolean | null) ?? false,
    // 2026-08-05 — migration 0021. Per-role session revocation epoch. Tolerate absence on read
    // (an un-migrated DB simply has no epoch, i.e. no role has ever been locked) like every
    // other late-added column.
    churchSessionsValidFrom: (r['church_sessions_valid_from'] as Date | null)?.toISOString() ?? null,
    zoneLeaderSessionsValidFrom: (r['zone_leader_sessions_valid_from'] as Date | null)?.toISOString() ?? null,
    churchCheckinTimeRestricted: (r['church_checkin_time_restricted'] as boolean | null) ?? false,
    checkinSwitchoverTime: (r['checkin_switchover_time'] as string | null) ?? '14:00',
    checkinPhaseOverride: (r['checkin_phase_override'] as CampSettings['checkinPhaseOverride'] | null) ?? 'auto',
    checkinWindowAmStart: (r['checkin_window_am_start'] as string | null) ?? '06:00',
    checkinWindowAmEnd: (r['checkin_window_am_end'] as string | null) ?? '12:00',
    checkinWindowPmStart: (r['checkin_window_pm_start'] as string | null) ?? '12:00',
    checkinWindowPmEnd: (r['checkin_window_pm_end'] as string | null) ?? '22:00',
    campMode: r['camp_mode'] as CampSettings['campMode'],
    lastTempPasswords: (r['last_temp_passwords'] as CampSettings['lastTempPasswords']) ?? null,
    lastExportedAt: (r['last_exported_at'] as Date | null)?.toISOString() ?? null,
    defaultsSavedAt: (r['defaults_saved_at'] as Date | null)?.toISOString() ?? null,
    formImportedAt: (r['form_imported_at'] as Date | null)?.toISOString() ?? null,
    ticketsImportedAt: (r['tickets_imported_at'] as Date | null)?.toISOString() ?? null,
    invoicesImportedAt: (r['invoices_imported_at'] as Date | null)?.toISOString() ?? null,
    discountCodeOverrides: (r['discount_code_overrides'] as Record<string, number>) ?? {},
    // 2026-07-29 — migration 0017. Ticket classification: the payment tag per discount code,
    // plus the two admin-set reference prices. Tolerate absence on read like every other
    // late-added column; the WRITE side below is what actually requires the migration.
    discountCodeTags: (r['discount_code_tags'] as CampSettings['discountCodeTags']) ?? {},
    tentPrice: (r['tent_price'] as number | null) ?? null,
    classroomPrice: (r['classroom_price'] as number | null) ?? null,
    // Item 8 (2026-07-28) — migration 0016. Tolerate absence on read (an un-migrated DB
    // simply has no map) exactly like the other late-added columns.
    siteMapImage: (r['site_map_image'] as string | null) ?? null,
    createdAt: (r['created_at'] as Date).toISOString(),
    updatedAt: (r['updated_at'] as Date).toISOString(),
  };
}

function settingsCols(s: CampSettings): Record<string, unknown> {
  return {
    id: SETTINGS_ID,
    camp_name: s.campName,
    year: s.year,
    start_date: s.startDate,
    end_date: s.endDate,
    timezone: s.timezone,
    check_in_banner: s.checkInBanner ?? null,
    check_in_days: s.checkInDays,
    accommodation_locked: s.accommodationLocked,
    church_login_locked: s.churchLoginLocked,
    zone_leader_login_locked: s.zoneLeaderLoginLocked,
    church_sessions_valid_from: s.churchSessionsValidFrom ?? null,
    zone_leader_sessions_valid_from: s.zoneLeaderSessionsValidFrom ?? null,
    church_checkin_time_restricted: s.churchCheckinTimeRestricted,
    checkin_switchover_time: s.checkinSwitchoverTime,
    checkin_phase_override: s.checkinPhaseOverride,
    checkin_window_am_start: s.checkinWindowAmStart ?? '06:00',
    checkin_window_am_end: s.checkinWindowAmEnd ?? '12:00',
    checkin_window_pm_start: s.checkinWindowPmStart ?? '12:00',
    checkin_window_pm_end: s.checkinWindowPmEnd ?? '22:00',
    camp_mode: s.campMode,
    last_temp_passwords: s.lastTempPasswords ?? null,
    last_exported_at: s.lastExportedAt ?? null,
    defaults_saved_at: s.defaultsSavedAt ?? null,
    form_imported_at: s.formImportedAt ?? null,
    tickets_imported_at: s.ticketsImportedAt ?? null,
    invoices_imported_at: s.invoicesImportedAt ?? null,
    discount_code_overrides: s.discountCodeOverrides ?? {},
    discount_code_tags: s.discountCodeTags ?? {},
    tent_price: s.tentPrice ?? null,
    classroom_price: s.classroomPrice ?? null,
    site_map_image: s.siteMapImage ?? null,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

const UPDATE_COLS = [
  'camp_name', 'year', 'start_date', 'end_date', 'timezone',
  'check_in_banner', 'check_in_days', 'accommodation_locked',
  'church_login_locked', 'zone_leader_login_locked', 'church_checkin_time_restricted', 'camp_mode',
  'church_sessions_valid_from', 'zone_leader_sessions_valid_from',
  'checkin_switchover_time', 'checkin_phase_override',
  'checkin_window_am_start', 'checkin_window_am_end', 'checkin_window_pm_start', 'checkin_window_pm_end',
  'last_temp_passwords', 'last_exported_at',
  'defaults_saved_at', 'form_imported_at', 'tickets_imported_at', 'invoices_imported_at',
  'discount_code_overrides',
  'discount_code_tags', 'tent_price', 'classroom_price',
  'site_map_image',
  'updated_at',
] as const;

export class SupabaseSettingsRepository implements ISettingsRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async getSingleton(): Promise<CampSettings | null> {
    const rows = await this.sql`select * from settings where id = 'settings'`;
    return rows[0] ? toSettings(rows[0]) : null;
  }

  async saveSingleton(settings: CampSettings): Promise<CampSettings> {
    const cols = settingsCols(settings);
    await this.sql`
      insert into settings ${this.sql(cols)}
      on conflict (id) do update set ${this.sql(cols, ...UPDATE_COLS)}
    `;
    return settings;
  }
}
