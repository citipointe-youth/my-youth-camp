import type { HttpRequest } from '../http/types';
import type { AccountService } from '../../services/account.service';
import type { AuthService } from '../../services/auth.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

export interface AccountControllerServices {
  account: AccountService;
  auth: AuthService;
}

export function makeAccountController(services: AccountControllerServices) {
  return {
    async list(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.listUsers(req.ctx.actor);
    },

    async create(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.createUser(req.ctx.actor, req.body);
    },

    async update(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      return services.account.updateUser(req.ctx.actor, id, req.body);
    },

    async preview(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      const user = await services.account.previewAccount(req.ctx.actor, id);
      // mustChangePassword:false so previewing a never-logged-in seeded account doesn't
      // dead-end on its own forced-password screen (the gate is currently disabled, but
      // this keeps preview correct if it's ever re-enabled).
      const token = await services.auth.issueTokenFor(user.id, { mustChangePassword: false });
      return { token, user };
    },

    async setPassword(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.setPassword(req.ctx.actor, req.body);
    },

    async changeOwnPassword(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.changeOwnPassword(req.ctx.actor, req.body);
    },

    async createChurch(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.createChurchWithAccount(req.ctx.actor, req.body);
    },

    /** Feature 2: idempotently split every church into b-/g- gender-scoped logins. */
    async splitChurches(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.splitChurchAccounts(req.ctx.actor);
    },

    /** Feature 6: re-randomise all church login passwords; returns rows for CSV export. */
    async randomizeChurchPasswords(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.randomizeChurchPasswords(req.ctx.actor);
    },

    /** 2026-08-05: re-randomise CHURCH LOGINS ONLY — leadership passwords untouched. */
    async randomizeChurchOnlyPasswords(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.randomizeChurchOnlyPasswords(req.ctx.actor);
    },

    async importPasswords(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.importPasswords(req.ctx.actor, req.body);
    },

    async listChurches(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return services.account.listChurches(req.ctx.actor);
    },

    async updateChurch(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      return services.account.updateChurch(req.ctx.actor, id, req.body);
    },

    async updateChurchContacts(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      return services.account.updateChurchContacts(req.ctx.actor, id, req.body);
    },

    async deleteUser(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      return services.account.deleteUser(req.ctx.actor, id);
    },

    async deleteChurch(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const id = req.params['id'];
      if (!id) throw new BadRequestError('Missing id');
      return services.account.deleteChurch(req.ctx.actor, id);
    },
  };
}
