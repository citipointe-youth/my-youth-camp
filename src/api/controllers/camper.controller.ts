import type { HttpRequest } from '../http/types';
import type { PersonService } from '../../services/person.service';
import type { Person } from '../../core/entities/person';
import { toCamperDto } from '../dto/person.dto';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';
import { assertCan } from '../../services/access-control';

export interface CamperControllerServices {
  person: PersonService;
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
      return people.map(toCamperDto);
    },

    async get(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      const profile = await person.getProfile(req.ctx.actor, id);
      return { ...toCamperDto(profile), age: profile.age, lastSignOut: profile.lastSignOut };
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
      // Access is logged by assertCan succeeding for camper:read:sensitive. The client
      // already has the medicare number from the CamperDto; this authenticated endpoint IS
      // the reveal audit trail (this app persists no reveal-audit table). Feature 4 attributes
      // the reveal to the acting leader's initials (church-account session prefill), falling
      // back to the actor's display name when no initials were supplied.
      const b = (req.body ?? {}) as { initials?: unknown };
      const initials = typeof b.initials === 'string' ? b.initials.trim() : '';
      return { ok: true, revealedBy: initials || req.ctx.actor.displayName };
    },
  };
}
