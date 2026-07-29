import type { IPersonRepository, IChurchRepository, IAllocationOverrideRepository } from '../repositories/interfaces/entity-repositories';
import type { Person } from '../core/entities/person';
import type { Church } from '../core/entities/church';
import type { AllocationOverride } from '../core/entities/allocation-override';
import {
  UNALLOCATED_CHURCH_ID, UNALLOCATED_CHURCH_NAME, isUnlistedChurchCell,
  overrideNameKey, overrideMobileKey, matchOverride,
} from './church-allocation';
import type { Actor } from '../core/entities/user';
import type { ConsentType } from '../core/types/enums';
import { assertCan } from './access-control';
import { BadRequestError } from '../core/errors/app-error';
import { parseCsv } from '../utils/csv';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import {
  cleanCareText, field, isBlankRow, normalizeDate, parseGradeOrLeader, titleCaseName, yesToConsent,
} from './elvanto-mapping';
import { invalidateDashboardCache } from './dashboard-cache';
import { z } from 'zod';

const ImportOptionsSchema = z.object({
  csvData: z.string().min(1),
  churchId: z.string().optional(),
  updateExisting: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
});

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  dryRun: boolean;
  errors: Array<{ row: number; message: string }>;
  warnings: Array<{ row: number; message: string }>;
  churchesCreated: string[];
  phantomChurches: string[];
}

export interface ImportService {
  importCsv(actor: Actor, input: unknown): Promise<ImportResult>;
}

// Blank/whitespace-only input -> null (no data supplied — the caller decides how to treat
// that: keep the existing value on update, default to 'other' on create). A NON-blank input
// that doesn't match male/female legitimately parses to 'other' — that is a real answer, not
// a blank-cell default.
function parseGender(val: string): Person['gender'] | null {
  const v = val.toLowerCase().trim();
  if (v === '') return null;
  if (v === 'male' || v === 'm') return 'male';
  if (v === 'female' || v === 'f') return 'female';
  return 'other';
}

export function makeImportService(
  personRepo: IPersonRepository,
  churchRepo: IChurchRepository,
  overrideRepo: IAllocationOverrideRepository,
): ImportService {
  return {
    async importCsv(actor, input) {
      assertCan(actor, 'import:run');
      const opts = ImportOptionsSchema.parse(input);
      const rows = parseCsv(opts.csvData);
      if (rows.length === 0) throw new BadRequestError('CSV has no data rows');

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: ImportResult['errors'] = [];
      const warnings: ImportResult['warnings'] = [];
      const churchesCreated: string[] = [];
      const phantomChurches: string[] = [];

      const churches = await churchRepo.findAll();
      const churchIdByName = new Map<string, string>();
      const churchZoneById = new Map<string, string>();
      const churchOverrideById = new Map<string, Person['accommodationKind']>();
      for (const c of churches) {
        churchIdByName.set(c.name.toLowerCase(), c.id);
        churchZoneById.set(c.id, c.zone);
        if (c.accommodationOverride) churchOverrideById.set(c.id, c.accommodationOverride);
      }
      const newlyCreated = new Map<string, string>(); // lowercased name -> id

      const allPersons = await personRepo.findAll();
      const nameChurchKey = (churchId: string, first: string, last: string): string =>
        `${churchId}::${first.toLowerCase()}::${last.toLowerCase()}`;
      const phoneKey = (mobile: string | null | undefined): string =>
        (mobile ?? '').replace(/\D/g, '');
      const poolByNameChurch = new Map<string, Person[]>();
      for (const p of allPersons) {
        const k = nameChurchKey(p.churchId, p.firstName, p.lastName);
        const pool = poolByNameChurch.get(k);
        if (pool) pool.push(p);
        else poolByNameChurch.set(k, [p]);
      }

      // Manual church allocations re-applied at church-resolution time (keyed by name identity),
      // so they win over the CSV and survive the delete-absent sweep below.
      const overrides = await overrideRepo.findAll();
      const overridesByName = new Map<string, AllocationOverride[]>();
      for (const o of overrides) {
        const k = `${o.firstNameKey}::${o.lastNameKey}`;
        const list = overridesByName.get(k);
        if (list) list.push(o);
        else overridesByName.set(k, [o]);
      }

      function pickMatch(pool: Person[] | undefined, phone: string): Person | undefined {
        if (!pool || pool.length === 0) return undefined;
        if (phone) {
          const byPhone = pool.find((p) => phoneKey(p.mobile) === phone);
          if (byPhone) return byPhone;
          if (pool.length === 1 && !phoneKey(pool[0]!.mobile)) return pool[0];
          return undefined;
        }
        return pool.length === 1 ? pool[0] : undefined;
      }

      // Resolve a church name to an id. In live mode, auto-creates a minimal church on miss
      // (phantom). In dry-run mode, records the unmatched name for operator review instead.
      async function resolveChurch(name: string, rowNum: number, createdAt: string): Promise<string> {
        if (!name) return '';
        const key = name.toLowerCase();
        const existing = churchIdByName.get(key) ?? newlyCreated.get(key);
        if (existing) return existing;
        if (opts.dryRun) {
          // Dry-run: flag for operator confirmation, return a sentinel
          if (!phantomChurches.includes(name)) phantomChurches.push(name);
          warnings.push({ row: rowNum, message: `Church "${name}" not found — would be created (dry-run)` });
          return `__phantom__${key}`;
        }
        const id = newId('church');
        const church: Church = {
          id,
          name,
          zone: 'Yellow',
          contacts: {
            male: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
            female: { primary: { name: '', phone: '' }, backup: { name: '', phone: '' } },
          },
          createdAt,
          updatedAt: createdAt,
        };
        await churchRepo.save(church);
        newlyCreated.set(key, id);
        churchZoneById.set(id, church.zone);
        churchesCreated.push(name);
        warnings.push({ row: rowNum, message: `Church "${name}" not found — created (zone defaulted to Yellow)` });
        return id;
      }

      function buildConsents(med: boolean, media: boolean, sup: boolean, ts: string): Person['consents'] {
        const mk = (granted: boolean): { granted: boolean; timestamp: string | null } => ({
          granted,
          timestamp: granted ? ts : null,
        });
        return { medical: mk(med), media: mk(media), supervision: mk(sup) } as Record<
          ConsentType,
          { granted: boolean; timestamp: string | null }
        >;
      }

      const touched = new Map<string, Person>();
      const createdIds = new Set<string>();
      // seenIds: every person matched or created from the CSV (present in the upload).
      // Used to compute absent deletions — separate from touched so skipped persons
      // (updateExisting=false path) are not deleted.
      const seenIds = new Set<string>();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const rowNum = i + 2;
        // Item 12 (2026-07-28): an entirely-blank row (trailing newline / spreadsheet padding) is
        // padding, not a defect — skip it silently instead of reporting a missing-name error on a
        // file that otherwise imports perfectly.
        if (isBlankRow(row)) { skipped++; continue; }

        try {
          const firstName = titleCaseName(field(row, 'First Name', 'firstName', 'first_name'));
          const lastName = titleCaseName(field(row, 'Last Name', 'lastName', 'last_name'));
          if (!firstName || !lastName) {
            errors.push({ row: rowNum, message: 'Missing firstName or lastName' });
            skipped++;
            continue;
          }

          const now = nowISO();

          const churchName = field(row, "Attendee's Church", 'churchName', 'church_name', 'Church');
          const churchUnlistedNote =
            field(row, 'If from a church not listed, please specify church name & Youth Pastor') || null;

          // null when the CSV cell is blank/absent — the merge/create branches below decide
          // the fallback (keep existing value on update, default to 'other' on create).
          const gender = parseGender(field(row, 'Gender', 'gender'));
          const gradeRaw = field(row, 'School Grade', 'grade', 'Grade');
          const { kind, grade } = parseGradeOrLeader(gradeRaw);
          if (gradeRaw && grade === null && kind === 'youth') {
            warnings.push({ row: rowNum, message: `Unrecognized School Grade "${gradeRaw}" — grade left blank` });
          }

          const dob = normalizeDate(field(row, 'Date of Birth', 'dateOfBirth', 'dob', 'DOB'));
          const mobile = field(row, 'Mobile Number', 'mobile', 'Mobile') || null;

          // ----- Church resolution (override → explicit → unlisted-sentinel → by-name) -----
          const explicitChurchId = field(row, 'churchId', 'church_id') || opts.churchId || '';
          const rowMobileKey = overrideMobileKey(mobile);
          const ovCandidates = overridesByName.get(overrideNameKey(firstName, lastName)) ?? [];
          const ovMatch = matchOverride(ovCandidates, rowMobileKey);
          let resolvedChurchId: string;
          let resolvedChurchName: string;
          if (ovMatch === 'ambiguous') {
            warnings.push({ row: rowNum, message: `Manual allocation for "${firstName} ${lastName}" skipped — duplicate name/mobile can't be disambiguated` });
          }
          if (ovMatch && ovMatch !== 'ambiguous') {
            resolvedChurchId = ovMatch.assignedChurchId;
            resolvedChurchName = ovMatch.assignedChurchName;
            warnings.push({ row: rowNum, message: `Church forced to "${resolvedChurchName}" by manual allocation` });
          } else if (explicitChurchId) {
            resolvedChurchId = explicitChurchId;
            resolvedChurchName = churchName || explicitChurchId;
          } else if (isUnlistedChurchCell(churchName)) {
            resolvedChurchId = UNALLOCATED_CHURCH_ID;
            resolvedChurchName = UNALLOCATED_CHURCH_NAME;
          } else {
            resolvedChurchId = await resolveChurch(churchName, rowNum, now);
            resolvedChurchName = churchName;
          }

          const email = field(row, 'Email Address', 'email', 'Email') || null;
          const suburb = field(row, 'Suburb', 'suburb') || null;
          const postcode = field(row, 'Postcode', 'postcode') || null;
          const state = field(row, 'State', 'state') || null;
          const medicareNumber = field(row, 'Medicare Number') || null;
          const medical = cleanCareText(field(row, 'Medical Conditions', 'medical', 'Medical'));
          const dietary = cleanCareText(field(row, 'Dietary Requirements', 'dietary', 'Dietary'));
          const otherMedications =
            cleanCareText(field(row, 'List Other Medical Conditions or Medication Taken')) || null;
          const blueCardNumber = field(row, 'Blue Card/Working with Children Card Number') || null;
          const blueCardExpiry = normalizeDate(field(row, 'Blue Card/Working with Children Card Expiry'));
          const parentName = field(row, 'Parent/Guardian Name', 'parentGuardianName', 'parent_name', 'Parent') || null;
          const parentRelation = field(row, 'Relation to Child', 'parentRelation') || null;
          const parentPhone = field(row, 'Parent/Guardian Phone Number', 'parentPhone', 'parent_phone') || null;
          // Zone is a property of the church, not the CSV row — a person's zone always follows
          // their (resolved) church's current zone. There is no per-row zone override: if the
          // church's zone is changed later, re-importing is what brings people's zone up to date.
          // Unallocated (sentinel) people get no zone, so no zoneLeader can see them.
          const zone = resolvedChurchId === UNALLOCATED_CHURCH_ID ? '' : (churchZoneById.get(resolvedChurchId) ?? 'Yellow');
          // 'Type' is the canonical Elvanto column; fall back to explicit aliases
          const typeRaw = field(row, 'Type', 'Registration Type', 'registrationType', 'registration_type');
          const registrationType = typeRaw || null;
          // 'Type' values 'Classroom'/'Tent' drive accommodation grouping
          const accommodationKindRaw = typeRaw.toLowerCase();
          const csvAccommodationKind: Person['accommodationKind'] =
            accommodationKindRaw === 'classroom' ? 'classroom'
            : accommodationKindRaw === 'tent' ? 'tent'
            : null;
          // Church accommodation override: EVERYONE at a church with an override — students
          // AND leaders — always gets the override kind (corrects wrong ticket-type purchases;
          // Bug 2, 2026-07-17 — previously students-only, leaders silently kept the CSV value).
          const churchOverride = churchOverrideById.get(resolvedChurchId);
          const accommodationKind: Person['accommodationKind'] = churchOverride ?? csvAccommodationKind;
          if (churchOverride && csvAccommodationKind && csvAccommodationKind !== churchOverride) {
            warnings.push({
              row: rowNum,
              message: `Accommodation "${csvAccommodationKind}" overridden to "${churchOverride}" (church override)`,
            });
          }
          const registrationCostRaw = field(row, 'Cost', 'Registration Cost', 'registrationCost', 'registration_cost') || '';
          const registrationCost = registrationCostRaw
            ? parseFloat(registrationCostRaw.replace(/[^0-9.]/g, '')) || null
            : null;
          // 'Code' is the canonical Elvanto column for discount codes
          const discountCode = field(row, 'Code', 'Discount Code', 'discountCode', 'discount_code') || null;

          // Verbatim submission metadata (kept for byte-for-byte export round-trip).
          const raw = (h: string): string => (row[h] ?? '').trim();
          const elvantoMeta = {
            dateSubmitted: raw('Date Submitted'),
            submissionStatus: raw('Submission Status'),
            person: raw('Person'),
            personStatus: raw('Person Status'),
            todaysDate: raw("Today's Date"),
          };

          const submitted = normalizeDate(field(row, 'Date Submitted'));
          const consentTs = submitted ? `${submitted}T00:00:00.000Z` : now;
          const consents = buildConsents(
            yesToConsent(field(row, 'I give medical consent for my child as listed above.')),
            yesToConsent(field(row, 'I give photography and video consent for my child as listed above.')),
            yesToConsent(field(row, 'I understand and agree to the Supervision policy.')),
            consentTs,
          );

          const nck = nameChurchKey(resolvedChurchId, firstName, lastName);
          const rowPhone = phoneKey(mobile);
          const pool = poolByNameChurch.get(nck);
          const match = pickMatch(pool, rowPhone);
          const isExisting = match !== undefined && !createdIds.has(match.id);

          if (match && isExisting && !opts.updateExisting) {
            seenIds.add(match.id);
            skipped++;
          } else if (match) {
            const merged: Person = {
              ...match,
              firstName,
              lastName,
              // Blank-cell guard: a blank/absent CSV value for these fields must never clobber
              // a previously-known good value on a matched-existing update. `gradeRaw` blank
              // covers both `kind` and `grade` since both are derived from the same School
              // Grade cell (an unrecognized-but-present value still applies, matching the
              // existing "grade left blank" warning behavior below — only a genuinely blank
              // cell is guarded).
              gender: gender ?? match.gender,
              grade: gradeRaw ? grade : match.grade,
              dateOfBirth: dob ?? match.dateOfBirth,
              mobile: mobile ?? match.mobile,
              email: email ?? match.email,
              suburb: suburb ?? match.suburb,
              postcode: postcode ?? match.postcode,
              state: state ?? match.state,
              medicareNumber: medicareNumber ?? match.medicareNumber,
              // zone is NOT CSV-sourced — it's always resolved live from the person's church
              // record (see comment above), so it is never "blank" and is intentionally kept
              // unconditional: re-importing is how a person's zone stays in sync with their
              // church's current zone.
              zone,
              kind: gradeRaw ? kind : match.kind,
              medicalConditions: medical ? [medical] : match.medicalConditions,
              dietaryRequirements: dietary ? [dietary] : match.dietaryRequirements,
              otherMedications: otherMedications ?? match.otherMedications,
              blueCardNumber: blueCardNumber ?? match.blueCardNumber,
              blueCardExpiry: blueCardExpiry ?? match.blueCardExpiry,
              churchUnlistedNote: churchUnlistedNote ?? match.churchUnlistedNote,
              elvantoMeta: elvantoMeta.dateSubmitted ? elvantoMeta : match.elvantoMeta,
              accommodationKind: accommodationKind ?? match.accommodationKind,
              registrationType: registrationType ?? match.registrationType,
              registrationCost: registrationCost ?? match.registrationCost,
              discountCode: discountCode ?? match.discountCode,
              consents,
              parentGuardianName: parentName ?? match.parentGuardianName,
              parentRelation: parentRelation ?? match.parentRelation,
              parentPhone: parentPhone ?? match.parentPhone,
              updatedAt: now,
            };
            if (pool) {
              const idx = pool.indexOf(match);
              if (idx >= 0) pool[idx] = merged;
            }
            const firstTouch = !touched.has(merged.id);
            touched.set(merged.id, merged);
            seenIds.add(merged.id);
            if (isExisting && firstTouch) updated++;
          } else {
            const person: Person = {
              id: newId('person'),
              firstName,
              lastName,
              // Creating a brand-new person is the one place a blank Gender cell legitimately
              // needs a concrete default, since Person.gender is required/non-nullable.
              gender: gender ?? 'other',
              dateOfBirth: dob,
              grade,
              school: field(row, 'school') || null,
              zone,
              groupId: null,
              kind,
              mobile,
              email,
              suburb,
              postcode,
              state,
              medicalConditions: medical ? [medical] : [],
              dietaryRequirements: dietary ? [dietary] : [],
              otherMedications,
              medicareNumber,
              churchUnlistedNote,
              elvantoMeta,
              consents,
              parentGuardianName: parentName,
              parentPhone,
              parentRelation,
              blueCardNumber,
              blueCardExpiry,
              churchId: resolvedChurchId,
              churchName: resolvedChurchName,
              paymentStatus: 'unpaid',
              accommodationKind,
              accommodationLabel: null,
              registrationType,
              registrationCost,
              discountCode,
              lifecycle: 'registered',
              atCamp: false,
              needsReview: false,
              checkInHistory: [],
              signOutHistory: [],
              createdAt: now,
              updatedAt: now,
            };
            touched.set(person.id, person);
            createdIds.add(person.id);
            seenIds.add(person.id);
            const p = poolByNameChurch.get(nck);
            if (p) p.push(person);
            else poolByNameChurch.set(nck, [person]);
            created++;
          }
        } catch (err) {
          errors.push({ row: rowNum, message: err instanceof Error ? err.message : String(err) });
          skipped++;
        }
      }

      // Anyone in the DB but not in the uploaded CSV is removed (the upload is authoritative).
      const absentIds = allPersons.map((p) => p.id).filter((id) => !seenIds.has(id));
      const deleted = absentIds.length;

      /* Item A follow-up (2026-07-28): NAME the people this import is about to delete.
         The result already carried a `deleted` COUNT, but a count gives an admin no way to spot
         that a spelling change or a wrong export has silently dropped real registrants — the
         deletion only becomes visible after it has happened. Each absent person now gets its own
         warning row, so the dry-run preview lists them by name and church before anything is
         confirmed. Capped so a first-ever import against a populated DB can't produce hundreds
         of rows; the count is still authoritative. */
      const DELETE_WARNING_CAP = 50;
      const absentSetForWarning = new Set(absentIds);
      const absentPeople = allPersons.filter((p) => absentSetForWarning.has(p.id));
      for (const p of absentPeople.slice(0, DELETE_WARNING_CAP)) {
        warnings.push({
          row: 0,
          message:
            `${p.firstName} ${p.lastName} (${p.churchName || 'no church'}) is no longer in this file ` +
            'and will be DELETED — check the name spelling in the export if this is unexpected',
        });
      }
      if (absentPeople.length > DELETE_WARNING_CAP) {
        warnings.push({
          row: 0,
          message: `…and ${absentPeople.length - DELETE_WARNING_CAP} more people will be deleted (${absentPeople.length} in total)`,
        });
      }

      if (!opts.dryRun) {
        if (touched.size > 0) await personRepo.saveMany([...touched.values()]);
        for (const id of absentIds) await personRepo.delete(id);
        // Prune overrides whose person was just deleted (withdrew) — they're now stale.
        const absentSet = new Set(absentIds);
        for (const o of overrides) {
          if (absentSet.has(o.personId)) await overrideRepo.delete(o.id);
        }
        invalidateDashboardCache();
      }

      return { created, updated, skipped, deleted, dryRun: opts.dryRun, errors, warnings, churchesCreated, phantomChurches };
    },
  };
}
