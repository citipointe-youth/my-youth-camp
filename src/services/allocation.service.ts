import { z } from 'zod';
import type { IPersonRepository, IChurchRepository, IAllocationOverrideRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { AllocationOverride } from '../core/entities/allocation-override';
import { assertCan } from './access-control';
import { BadRequestError, NotFoundError } from '../core/errors/app-error';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { invalidateDashboardCache } from './dashboard-cache';
import type { Person } from '../core/entities/person';
import {
  UNALLOCATED_CHURCH_ID, UNALLOCATED_CHURCH_NAME, OTHER_CHURCH_LITERAL,
  overrideNameKey, overrideMobileKey, accommodationKindForChurch,
} from './church-allocation';

export interface AllocationOverrideDto {
  id: string;
  personId: string;
  personName: string;
  formChurch: string;
  assignedChurchId: string;
  assignedChurchName: string;
  kind: 'unallocated' | 'override';
  note: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AllocationService {
  listUnallocated(actor: Actor): Promise<Person[]>;
  listOverrides(actor: Actor): Promise<AllocationOverrideDto[]>;
  allocate(actor: Actor, input: unknown): Promise<AllocationOverrideDto>;
  removeOverride(actor: Actor, id: string): Promise<{ ok: true }>;
}

const AllocateSchema = z.object({
  personId: z.string().min(1),
  churchId: z.string().min(1),
});

export function makeAllocationService(
  personRepo: IPersonRepository,
  churchRepo: IChurchRepository,
  overrideRepo: IAllocationOverrideRepository,
): AllocationService {
  function toDto(o: AllocationOverride, personName: string): AllocationOverrideDto {
    return {
      id: o.id, personId: o.personId, personName,
      formChurch: o.formChurch, assignedChurchId: o.assignedChurchId, assignedChurchName: o.assignedChurchName,
      kind: o.kind, note: o.note, createdBy: o.createdBy, createdAt: o.createdAt, updatedAt: o.updatedAt,
    };
  }

  return {
    async listUnallocated(actor): Promise<Person[]> {
      assertCan(actor, 'allocation:manage');
      const people = await personRepo.findByChurch(UNALLOCATED_CHURCH_ID);
      return people.filter((p) => p.lifecycle !== 'cancelled');
    },

    async listOverrides(actor) {
      assertCan(actor, 'allocation:manage');
      const overrides = await overrideRepo.findAll();
      const dtos: AllocationOverrideDto[] = [];
      for (const o of overrides) {
        const p = await personRepo.findById(o.personId);
        const name = p ? `${p.firstName} ${p.lastName}` : `${o.firstNameKey} ${o.lastNameKey}`;
        dtos.push(toDto(o, name));
      }
      return dtos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async allocate(actor, input) {
      assertCan(actor, 'allocation:manage');
      const { personId, churchId } = AllocateSchema.parse(input);
      if (churchId === UNALLOCATED_CHURCH_ID) {
        throw new BadRequestError('Cannot allocate to the unallocated pool — use Undo instead');
      }
      const person = await personRepo.findById(personId);
      if (!person) throw new NotFoundError('Person not found');
      const church = await churchRepo.findById(churchId);
      if (!church) throw new NotFoundError('Church not found');

      const wasUnallocated = person.churchId === UNALLOCATED_CHURCH_ID;
      const now = nowISO();

      // Apply church + zone + (student) accommodation override immediately.
      const accommodationKind = accommodationKindForChurch(person.kind, person.accommodationKind, church.accommodationOverride ?? null);
      // Bug 2: override applies to leaders too, so any person with a church override is "forced".
      const forcedAccom = !!church.accommodationOverride;
      await personRepo.save({
        ...person,
        churchId: church.id,
        churchName: church.name,
        zone: church.zone,
        accommodationKind,
        accommodationKindConfidence: forcedAccom ? 'confirmed' : person.accommodationKindConfidence,
        updatedAt: now,
      });

      // Upsert the override (keyed by the person). Preserve the original formChurch/kind/createdAt.
      const existing = await overrideRepo.findByPersonId(personId);
      const formChurch = existing?.formChurch
        ?? (wasUnallocated ? OTHER_CHURCH_LITERAL : person.churchName);
      const [firstNameKey, lastNameKey] = overrideNameKey(person.firstName, person.lastName).split('::');
      const saved: AllocationOverride = {
        id: existing?.id ?? newId('override'),
        personId,
        firstNameKey: firstNameKey ?? '',
        lastNameKey: lastNameKey ?? '',
        mobileKey: overrideMobileKey(person.mobile),
        assignedChurchId: church.id,
        assignedChurchName: church.name,
        formChurch,
        kind: existing?.kind ?? (wasUnallocated ? 'unallocated' : 'override'),
        note: person.churchUnlistedNote ?? null,
        createdBy: actor.displayName,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await overrideRepo.save(saved);
      invalidateDashboardCache();
      return toDto(saved, `${person.firstName} ${person.lastName}`);
    },

    async removeOverride(actor, id) {
      assertCan(actor, 'allocation:manage');
      const o = await overrideRepo.findById(id);
      if (!o) throw new NotFoundError('Override not found');
      const person = await personRepo.findById(o.personId);
      if (person) {
        if (o.kind === 'override') {
          // Return them to the church their form named, if it still exists; else unallocated.
          const churches = await churchRepo.findAll();
          const target = churches.find((c) => c.name.toLowerCase() === o.formChurch.trim().toLowerCase());
          if (target) {
            await personRepo.save({ ...person, churchId: target.id, churchName: target.name, zone: target.zone, updatedAt: nowISO() });
          } else {
            await personRepo.save({ ...person, churchId: UNALLOCATED_CHURCH_ID, churchName: UNALLOCATED_CHURCH_NAME, zone: '', updatedAt: nowISO() });
          }
        } else {
          await personRepo.save({ ...person, churchId: UNALLOCATED_CHURCH_ID, churchName: UNALLOCATED_CHURCH_NAME, zone: '', updatedAt: nowISO() });
        }
      }
      await overrideRepo.delete(id);
      invalidateDashboardCache();
      return { ok: true };
    },
  };
}
