import type { Grade } from '../core/types/enums';

/** The canonical 29 Elvanto export columns, in order. */
export const ELVANTO_HEADERS = [
  'Date Submitted',
  'Submission Status',
  'Person',
  'Person Status',
  'First Name',
  'Last Name',
  'Gender',
  'Date of Birth',
  'School Grade',
  'Mobile Number',
  'Email Address',
  'Suburb',
  'Postcode',
  'State',
  'Medicare Number',
  'Medical Conditions',
  'Dietary Requirements',
  'List Other Medical Conditions or Medication Taken',
  "Attendee's Church",
  'If from a church not listed, please specify church name & Youth Pastor',
  'Blue Card/Working with Children Card Number',
  'Blue Card/Working with Children Card Expiry',
  'I give medical consent for my child as listed above.',
  'I give photography and video consent for my child as listed above.',
  'I understand and agree to the Supervision policy.',
  'Parent/Guardian Name',
  'Relation to Child',
  'Parent/Guardian Phone Number',
  "Today's Date",
] as const;

const JUNK = new Set(['', 'na', 'n/a', 'no', 'none', 'nil', '-', '.']);

/** Care-text columns: preserve verbatim, but treat whole-value placeholders as empty. */
export function cleanCareText(raw?: string | null): string {
  const v = (raw ?? '').trim();
  return JUNK.has(v.toLowerCase()) ? '' : v;
}

/** DD/MM/YYYY (or D/M/YYYY, '/' or '-') → ISO; ISO passes through; else null. */
export function normalizeDate(raw?: string | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (isoMatch) return v;
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (!m) return null;
  const dd = (m[1] ?? '').padStart(2, '0');
  const mm = (m[2] ?? '').padStart(2, '0');
  const yyyy = m[3] ?? '';
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Sort key for ordering import rows by submission time, ascending (oldest/undated first).
 *
 * `normalizeDate` is DATE-ONLY by contract (other callers depend on that — do not widen it).
 * This is a separate helper for the one caller that needs to order SAME-DAY submissions
 * correctly: it keeps a TIME component when the raw cell actually has one (e.g.
 * `04/07/2026 14:32` or an ISO datetime), while parsing today's real-world date-only export
 * (`DD/MM/YYYY`) identically to before — same key for every date-only row on the same day, so
 * the caller's existing stable-sort + rowNum tiebreak is unaffected. Undated/unparseable rows
 * return `''`, which sorts before every real date, preserving "no Date Submitted column keeps
 * original row order".
 */
export function submissionSortKey(raw?: string | null): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/.exec(v);
  if (iso) {
    const date = iso[1] ?? '';
    const time = iso[2] ?? '00:00:00';
    return `${date}T${time.length === 5 ? `${time}:00` : time}`;
  }
  const m =
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/.exec(v);
  if (!m) return '';
  const dd = (m[1] ?? '').padStart(2, '0');
  const mm = (m[2] ?? '').padStart(2, '0');
  const yyyy = m[3] ?? '';
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return '';
  // ⚠ A 12-HOUR TIME MUST BE CONVERTED, NOT TRUNCATED. Without this, `2:32 PM` parsed as
  // `02:32` and sorted BEFORE an 11:00 AM submission the same day — silently inverting the
  // "latest submission wins" merge this sort key exists to guarantee, with no warning to the
  // admin because the key still looks perfectly valid. The meridiem is optional: a 24-hour
  // time (`14:32`) has no suffix and is used as-is.
  const mer = (m[7] ?? '').toLowerCase();
  let hour = Number(m[4] ?? '0');
  if (mer === 'pm' && hour < 12) hour += 12;
  else if (mer === 'am' && hour === 12) hour = 0;
  if (hour > 23) return '';
  const hh = String(hour).padStart(2, '0');
  const min = (m[5] ?? '00').padStart(2, '0');
  const ss = (m[6] ?? '00').padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

/** ISO → DD/MM/YYYY for export; anything not ISO passes through unchanged. */
export function formatDateAU(iso?: string | null): string {
  const v = (iso ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const YOUTH_GRADES: readonly number[] = [7, 8, 9, 10, 11, 12];

/** School Grade → kind + grade. 'leader'/'18+' ⇒ leader; numeric 7–12 ⇒ that grade. */
export function parseGradeOrLeader(raw?: string | null): { kind: 'youth' | 'leader'; grade: Grade | null } {
  const v = (raw ?? '').trim().toLowerCase();
  if (v.includes('leader') || v.includes('18+')) return { kind: 'leader', grade: null };
  const n = parseInt(v, 10);
  if (YOUTH_GRADES.includes(n)) return { kind: 'youth', grade: n as Grade };
  return { kind: 'youth', grade: null };
}

export function yesToConsent(raw?: string | null): boolean {
  return (raw ?? '').trim().toLowerCase() === 'yes';
}

/**
 * First non-empty value among the given header aliases (values are pre-trimmed by parseCsv).
 *
 * Item 12 (2026-07-28): the exact-key lookup is tried first (fast path, unchanged), then a
 * normalised one — lowercase, non-alphanumerics stripped — so a real export whose header reads
 * "First name", "FIRST NAME" or "First  Name" still resolves instead of reporting the column as
 * missing on every row. Alias lists throughout the importers stay as-is; this only widens what
 * each alias matches.
 */
export function field(row: Record<string, string>, ...aliases: string[]): string {
  for (const a of aliases) {
    const v = row[a];
    if (v != null && v.trim() !== '') return v.trim();
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = new Set(aliases.map(norm));
  for (const [k, v] of Object.entries(row)) {
    if (v != null && v.trim() !== '' && wanted.has(norm(k))) return v.trim();
  }
  return '';
}

/**
 * ALL-CAPS or all-lower-case first/last names (a common artefact of how some registration forms
 * or spreadsheets export data) → Title Case. A name that already MIXES upper- and lower-case is
 * left completely untouched and returned as-is — that mix is exactly what a real name like
 * "McDonald", "O'Brien", "de Silva" or "van Wyk" looks like, and there is no reliable rule that
 * title-cases those correctly. Only a name with NO existing case information (all one case) is
 * safe to reshape. Do not "simplify" this into an unconditional title-case — that would mangle
 * every mixed-case name above.
 */
export function titleCaseName(raw: string): string {
  const v = raw ?? '';
  if (v.trim() === '') return v;
  const hasLower = /\p{Ll}/u.test(v);
  const hasUpper = /\p{Lu}/u.test(v);
  if (hasLower && hasUpper) return v;
  // Split on whitespace/hyphen/apostrophe (straight or curly), keeping the separators themselves
  // via a capturing group so spacing/punctuation is reproduced exactly.
  return v
    .split(/([\s\-'’]+)/)
    .map((part) => {
      if (part === '' || /^[\s\-'’]+$/.test(part)) return part;
      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/**
 * True when every cell in the row is blank. Item 12 (2026-07-28): a trailing empty line — which
 * spreadsheets and Elvanto exports both routinely produce — was reported as
 * "Missing firstName or lastName", so an import that fully succeeded still surfaced errors in
 * the preview. An entirely-blank row is not an error, it is padding; the importers skip it
 * silently and count it as skipped.
 */
export function isBlankRow(row: Record<string, string>): boolean {
  return Object.values(row).every((v) => v == null || String(v).trim() === '');
}
