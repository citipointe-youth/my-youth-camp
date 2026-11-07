import type { HttpRequest } from '../http/types';
import type { PersonService } from '../../services/person.service';
import type { Person } from '../../core/entities/person';
import { toRegistrantDto, toRegistrantDetailDto } from '../dto/person.dto';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';
import { RegistrantPatchSchema } from '../../core/validation';
import { assertCan } from '../../services/access-control';

export interface RegistrantControllerServices {
  person: PersonService;
}

export function makeRegistrantController(services: RegistrantControllerServices) {
  const { person } = services;

  return {
    async list(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const churchId = req.query['churchId'];
      // Budget/Data-Import widening only; PersonService re-gates it to director/admin.
      const includeCancelled = req.query['includeCancelled'] === '1' || req.query['includeCancelled'] === 'true';
      return (await person.listRegistrants(req.ctx.actor, churchId, { includeCancelled })).map((p) =>
        toRegistrantDto(p, req.ctx!.actor),
      );
    },

    async get(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      // prayer/firstAid have camper:read but not registrant:read; this dto carries payment and email.
      assertCan(req.ctx.actor, 'registrant:read');
      // Detail dto: single access-checked fetch, so dateOfBirth may ride along.
      return toRegistrantDetailDto(await person.get(req.ctx.actor, id), req.ctx.actor);
    },

    async create(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const b = RegistrantPatchSchema.parse(req.body) as Record<string, unknown>;
      const p = await person.create(req.ctx.actor, {
        firstName: b['firstName'] as string,
        lastName: b['lastName'] as string,
        gender: b['gender'] as Person['gender'],
        kind: b['kind'] === 'leader' ? 'leader' : 'youth',
        grade: (b['grade'] as Person['grade']) ?? null,
        churchId: b['churchId'] as string,
        churchName: b['churchName'] as string,
        zone: b['zone'] as string,
        paymentStatus: (b['paymentStatus'] as Person['paymentStatus']) ?? 'unpaid',
        accommodationKind: (b['accommodationKind'] as Person['accommodationKind']) ?? null,
        accommodationLabel: (b['accommodationLabel'] as string) ?? null,
        parentGuardianName: ((b['parentGuardianName'] ?? b['parentName']) as string) ?? null,
        parentPhone: (b['parentPhone'] as string) ?? null,
        mobile: (b['mobile'] as string) ?? null,
        // Legacy Registrant shape: medical/dietary arrive as strings, stored as arrays.
        medicalConditions: b['medical'] ? [b['medical'] as string] : [],
        dietaryRequirements: b['dietary'] ? [b['dietary'] as string] : [],
      });
      return toRegistrantDto(p, req.ctx.actor);
    },

    async update(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      return toRegistrantDto(await person.patch(req.ctx.actor, id, req.body), req.ctx.actor);
    },

    async remove(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      await person.remove(req.ctx.actor, id);
      return { ok: true };
    },
  };
}
