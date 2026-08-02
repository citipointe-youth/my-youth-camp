import type { HttpRequest } from '../http/types';
import type { PersonService } from '../../services/person.service';
import type { RevealAuditService } from '../../services/reveal-audit.service';
import type { Person } from '../../core/entities/person';
import type { Actor } from '../../core/entities/user';
import { toCamperDto, toCamperDetailDto } from '../dto/person.dto';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';
import { assertCan } from '../../services/access-control';
import { createLogger } from '../../utils/logger';
import { maskPhone } from '../../utils/mask';

const logger = createLogger('audit');

/**
 * Roles whose `/campers` response carries the parent/guardian phone MASKED.
 *
 * Bug 1 (2026-07-17) did this for `firstAid`. **`church` was added 2026-08-03** at the owner's
 * request, so a church leader now taps to reveal a parent's number exactly as first aid does.
 *
 * ⚠ The mask has to be at the DTO boundary, not in the SPA. Hiding it client-side while the
 * real number still travels in the JSON makes the reveal theatre — the number is in devtools,
 * and more importantly the AUDIT ROW is never written, because nothing forced a call to the
 * audited endpoint. Masking here is what makes `GET /search/contact/:id/parent` the only way
 * to see it, and that endpoint records a `parent-contact` reveal against the account.
 *
 * Church logins keep `camper:read:sensitive`, so the reveal itself still succeeds — this
 * changes HOW a church reads the number (one audited tap), not WHETHER it may.
 *
 * director/admin/zoneLeader are deliberately unaffected: they run the camp and a masked
 * roster would add an audited tap to routine oversight work for no safeguarding gain.
 */
const PARENT_PHONE_MASKED_ROLES: ReadonlySet<Actor['role']> = new Set(['firstAid', 'church']);

function maskParentPhone<T extends { parentPhone: string | null }>(dto: T, actor: Actor): T {
  if (!PARENT_PHONE_MASKED_ROLES.has(actor.role) || !dto.parentPhone) return dto;
  return { ...dto, parentPhone: maskPhone(dto.parentPhone) };
}

export interface CamperControllerServices {
  person: PersonService;
  /** Optional so existing controller tests can construct this with `{ person }` alone. */
  revealAudit?: RevealAuditService;
}

export function makeCamperController(services: CamperControllerServices) {
  const { person } = services;

  return {
    async list(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const opts = {
        zone: req.query['zone'],
        churchId: req.query['churchId'],
        q: req.query['q'],
      };
      // `scope=all` returns everyone registered (any lifecycle) the actor may see — used by the
      // first-aid "All Students" screen so not-yet-arrived registrants are still listed. The
      // default keeps the at-camp behaviour (arrived campers only). Both paths are role-scoped.
      const people =
        req.query['scope'] === 'all'
          ? await person.list(req.ctx.actor, opts)
          : await person.listCampers(req.ctx.actor, opts);
      return people.map((p) => maskParentPhone(toCamperDto(p), req.ctx!.actor));
    },

    async get(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      const profile = await person.getProfile(req.ctx.actor, id);
      // Detail dto: single access-checked fetch, so dateOfBirth may ride along.
      // medicareNumber never does — only the audited reveal below returns it.
      const dto = maskParentPhone(toCamperDetailDto(profile), req.ctx.actor);
      return { ...dto, age: profile.age, lastSignOut: profile.lastSignOut };
    },

    async update(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      const b = req.body as Record<string, unknown>;
      const patch: Partial<Person> = {
        ...(b['mobile'] !== undefined && { mobile: b['mobile'] as string }),
        ...(b['groupId'] !== undefined && { groupId: b['groupId'] as string }),
        ...(b['medicalConditions'] !== undefined && { medicalConditions: b['medicalConditions'] as string[] }),
        ...(b['dietaryRequirements'] !== undefined && { dietaryRequirements: b['dietaryRequirements'] as string[] }),
        ...(b['blueCardNumber'] !== undefined && { blueCardNumber: b['blueCardNumber'] as string }),
        ...(b['blueCardExpiry'] !== undefined && { blueCardExpiry: b['blueCardExpiry'] as string }),
      };
      return toCamperDto(await person.update(req.ctx.actor, id, patch));
    },

    async getMedicalWatch(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      assertCan(req.ctx.actor, 'camper:read:sensitive');
      const people = await person.listMedicalWatch(req.ctx.actor);
      return people.map(toCamperDto);
    },

    async revealMedicare(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      assertCan(req.ctx.actor, 'camper:read:sensitive');
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      // Audit 2026-07-19: this endpoint is the ONLY place the cleartext medicare number is
      // ever serialized — the list AND detail DTOs carry just a hasMedicare boolean. Load
      // through the access-checked service path (person.get runs canAccessPerson), so a
      // caller can never reveal someone outside their church/zone/gender scope — an
      // inaccessible person throws NotFound before anything is logged or returned.
      const p = await person.get(req.ctx.actor, id);
      // Since 2026-07-31 the reveal is persisted to `reveal_audit` and surfaces as the
      // "Sensitive Reveals" sheet in the compliance workbook. Feature 4 attributes it to the
      // acting leader's initials (church-account session prefill), falling back to the actor's
      // display name. The log line below is kept as the fallback trail for when that write
      // fails — `record()` never throws, so a database problem cannot block the reveal itself.
      // ⚠️ The NUMBER is never written to the audit, only the fact that it was revealed.
      const b = (req.body ?? {}) as { initials?: unknown };
      const initials = typeof b.initials === 'string' ? b.initials.trim() : '';
      const revealedBy = initials || req.ctx.actor.displayName;
      await services.revealAudit?.record(req.ctx.actor, { kind: 'medicare', person: p, initials });
      logger.info(
        `[audit] medicare revealed for person ${id} by ${req.ctx.actor.role} ${req.ctx.actor.id}` +
          ` (initials: ${initials || '—'}) from ${req.ip ?? 'unknown'}`,
      );
      return { ok: true, revealedBy, medicareNumber: p.medicareNumber ?? null };
    },
  };
}
