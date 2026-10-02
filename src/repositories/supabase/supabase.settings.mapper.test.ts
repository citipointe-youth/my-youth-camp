import { describe, it, expect } from 'vitest';
import { toSettings, settingsCols } from './supabase.settings';

const created = new Date('2026-09-01T00:00:00.000Z');
const updated = new Date('2026-09-02T00:00:00.000Z');
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'settings', camp_name: 'Camp 2026', year: 2026, start_date: '2026-09-28', end_date: '2026-10-01',
  timezone: 'Australia/Brisbane', check_in_banner: null, check_in_days: null,
  accommodation_locked: false, church_login_locked: null, zone_leader_login_locked: null,
  church_sessions_valid_from: null, zone_leader_sessions_valid_from: null,
  church_checkin_time_restricted: null,
  checkin_switchover_time: null, checkin_phase_override: null,
  checkin_window_am_start: null, checkin_window_am_end: null,
  checkin_window_pm_start: null, checkin_window_pm_end: null,
  camp_mode: 'pre-camp', last_temp_passwords: null,
  last_exported_at: null, defaults_saved_at: null, form_imported_at: null,
  tickets_imported_at: null, invoices_imported_at: null,
  discount_code_overrides: null, discount_code_tags: null,
  tent_price: null, classroom_price: null, site_map_image: null,
  created_at: created, updated_at: updated, ...over,
});

describe('settings mapper', () => {
  it('falls back to mapper-level defaults for null checkin window/switchover columns', () => {
    const s = toSettings(row());
    expect(s.checkinSwitchoverTime).toBe('14:00');
    expect(s.checkinWindowAmStart).toBe('06:00');
    expect(s.checkinWindowAmEnd).toBe('12:00');
    expect(s.checkinWindowPmStart).toBe('12:00');
    expect(s.checkinWindowPmEnd).toBe('22:00');
  });
  it('date columns convert Date to ISO or stay null', () => {
    const withDates = toSettings(row({
      last_exported_at: created, defaults_saved_at: created, form_imported_at: created,
      tickets_imported_at: created, invoices_imported_at: created,
    }));
    expect(withDates.lastExportedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(withDates.defaultsSavedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(withDates.formImportedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(withDates.ticketsImportedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(withDates.invoicesImportedAt).toBe('2026-09-01T00:00:00.000Z');

    const nulls = toSettings(row());
    expect(nulls.lastExportedAt).toBeNull();
    expect(nulls.defaultsSavedAt).toBeNull();
    expect(nulls.formImportedAt).toBeNull();
    expect(nulls.ticketsImportedAt).toBeNull();
    expect(nulls.invoicesImportedAt).toBeNull();
  });
  it('discount_code_tags/overrides and check_in_days stay plain objects/arrays, and round-trip preserves camp_mode/tent_price/classroom_price', () => {
    const r = row({
      discount_code_tags: { YC26: 'Full price' },
      discount_code_overrides: { YC26: 150 },
      check_in_days: ['2026-09-28', '2026-09-29'],
      camp_mode: 'at-camp', tent_price: 150, classroom_price: 180,
    });
    const s = toSettings(r);
    expect(Array.isArray(s.discountCodeOverrides)).toBe(false);
    expect(typeof s.discountCodeOverrides).toBe('object');
    expect(Array.isArray(s.checkInDays)).toBe(true);
    const cols = settingsCols(s);
    expect(Array.isArray(cols['discount_code_tags'])).toBe(false);
    expect(typeof cols['discount_code_tags']).toBe('object');
    expect(Array.isArray(cols['check_in_days'])).toBe(true);
    expect(cols['camp_mode']).toBe('at-camp');
    expect(cols['tent_price']).toBe(150);
    expect(cols['classroom_price']).toBe(180);
  });
});
