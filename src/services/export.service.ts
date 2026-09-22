import type { Person } from '../core/entities/person';
import type { Actor } from '../core/entities/user';
import type {
  IPersonRepository,
  IChurchRepository,
  IAllocationOverrideRepository,
} from '../repositories/interfaces/entity-repositories';
import { assertCan } from './access-control';
import { toCsvString } from '../utils/csv';
import { ELVANTO_HEADERS, formatDateAU } from './elvanto-mapping';

export interface ExportFilters {
  churchId?: string;
  gender?: string;
  kind?: string;
  grade?: string;
}

export function personToElvantoRow(p: Person, churchName: string): string[] {
  const consent = (t: 'medical' | 'media' | 'supervision'): string =>
    p.consents[t]?.granted ? 'Yes' : '';
  const gradeText = p.kind === 'leader' ? '18+ Leader' : p.grade != null ? String(p.grade) : '';
  const genderText = p.gender === 'male' ? 'Male' : p.gender === 'female' ? 'Female' : '';
  const meta = p.elvantoMeta ?? null;
  // Imported people reproduce the source metadata verbatim (incl. an originally-blank Person
  // cell); app-created people (no meta) reconstruct Person and leave metadata blank.
  const personCell = meta ? meta.person ?? '' : `${p.lastName}, ${p.firstName}`;
  return [
    meta?.dateSubmitted ?? '', // Date Submitted
    meta?.submissionStatus ?? '', // Submission Status
    personCell, // Person
    meta?.personStatus ?? '', // Person Status
    p.firstName,
    p.lastName,
    genderText,
    formatDateAU(p.dateOfBirth ?? ''),
    gradeText,
    p.mobile ?? '',
    p.email ?? '',
    p.suburb ?? '',
    p.postcode ?? '',
    p.state ?? '',
    p.medicareNumber ?? '',
    p.medicalConditions.join(', '),
    p.dietaryRequirements.join(', '),
    p.otherMedications ?? '',
    churchName,
    p.churchUnlistedNote ?? '',
    p.blueCardNumber ?? '',
    formatDateAU(p.blueCardExpiry ?? ''),
    consent('medical'),
    consent('media'),
    consent('supervision'),
    p.parentGuardianName ?? '',
    p.parentRelation ?? '',
    p.parentPhone ?? '',
    meta?.todaysDate ?? '', // Today's Date
  ];
}

/**
 * Override / accommodation columns APPENDED after the Elvanto form columns (2026-09-23).
 * Appended, never interleaved, so the Elvanto block stays a faithful "reverse of the import".
 * ⚠️ None of these headers may match a name the Form importer reads (`field()` in
 * import.service.ts) — that is why the code column is "Discount Code (export)", not
 * "Discount Code", which the importer WOULD pick up on a re-import of an exported file.
 */
export const EXPORT_EXTRA_HEADERS = [
  'Church Override (individual)',
  'Accommodation Override (individual)',
  'Accommodation Override (church)',
  'Registered Accommodation',
  'Accommodation (final)',
  'Discount Code (export)',
] as const;

function accomText(kind: Person['accommodationKind'] | null | undefined): string {
  return kind === 'tent' ? 'Tent' : kind === 'classroom' ? 'Classroom' : '';
}

/**
 * `formChurch` is what the form said for a person whose church an admin set by hand (both
 * 'override' and 'unallocated' kinds); `churchAccomOverride` is their church's override.
 * Registered = the stored importer value (`accommodationKindRaw`), which already has the
 * church override baked in at import; final = `accommodationKind`, the mapper-resolved
 * effective value every other screen uses.
 */
export function personExtraColumns(
  p: Person,
  formChurch: string | undefined,
  churchAccomOverride: Person['accommodationKind'] | null | undefined,
): string[] {
  const registered = p.accommodationKindRaw !== undefined ? p.accommodationKindRaw : p.accommodationKind;
  return [
    formChurch ?? '',
    accomText(p.accommodationOverride),
    accomText(churchAccomOverride),
    accomText(registered),
    accomText(p.accommodationKind),
    p.discountCode ?? '',
  ];
}

export interface ExportService {
  exportRegistrants(actor: Actor, filters: ExportFilters): Promise<string>;
}

export function makeExportService(
  personRepo: IPersonRepository,
  churchRepo: IChurchRepository,
  allocationOverrideRepo?: IAllocationOverrideRepository,
): ExportService {
  return {
    async exportRegistrants(actor, filters) {
      assertCan(actor, 'import:run');
      const [persons, churches, allocs] = await Promise.all([
        personRepo.findAll(),
        churchRepo.findAll(),
        allocationOverrideRepo ? allocationOverrideRepo.findAll() : Promise.resolve([]),
      ]);
      const nameById = new Map(churches.map((c) => [c.id, c.name] as const));
      const accomOverrideById = new Map(churches.map((c) => [c.id, c.accommodationOverride] as const));
      const formChurchByPerson = new Map(allocs.map((a) => [a.personId, a.formChurch] as const));
      // Insertion (import) order is preserved — no sort — so an export lines up row-for-row
      // with the source CSV for validation ("reverse of the import"). The on-screen Data
      // table does its own client-side ordering independently.
      const rows = persons
        .filter((p) => !filters.churchId || p.churchId === filters.churchId)
        .filter((p) => !filters.gender || p.gender === filters.gender)
        .filter((p) => !filters.kind || p.kind === filters.kind)
        .filter((p) => !filters.grade || String(p.grade ?? '') === filters.grade)
        .map((p) => [
          ...personToElvantoRow(p, nameById.get(p.churchId) ?? p.churchName),
          ...personExtraColumns(p, formChurchByPerson.get(p.id), accomOverrideById.get(p.churchId)),
        ]);
      return toCsvString([...ELVANTO_HEADERS, ...EXPORT_EXTRA_HEADERS], rows);
    },
  };
}
