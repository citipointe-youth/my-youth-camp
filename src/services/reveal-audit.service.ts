import type {
  IRevealAuditRepository,
  IUserRepository,
} from '../repositories/interfaces/entity-repositories';
import type { RevealAudit, RevealKind } from '../core/entities/reveal-audit';
import type { Actor } from '../core/entities/user';
import type { Person } from '../core/entities/person';
import { newId } from '../utils/id';
import { nowISO } from '../utils/date';
import { createLogger } from '../utils/logger';

const logger = createLogger('audit');

export interface RecordRevealInput {
  kind: RevealKind;
  person: Pick<Person, 'id' | 'firstName' | 'lastName' | 'churchName'>;
  /** Raw initials off the request (church sessions supply these); trimmed here. */
  initials?: string | undefined;
  /** For a contact reveal, which slot was revealed (e.g. `male-primary`). */
  contactRole?: string | undefined;
}

export interface RevealAuditService {
  /**
   * Record that a masked value was revealed. **Never throws** — see the note on the
   * implementation. Returns the row when it was written, `null` when it was not.
   */
  record(actor: Actor, input: RecordRevealInput): Promise<RevealAudit | null>;
  /** Every reveal, newest-first. Used by the compliance export. */
  list(limit?: number): Promise<RevealAudit[]>;
}

export function makeRevealAuditService(
  repo: IRevealAuditRepository,
  /**
   * Used only to resolve the acting login's USERNAME. The session `Actor` carries a
   * `displayName`, which for a church account is the church name — identical for the `b-` and
   * `g-` logins of the same church, so it cannot answer "which account revealed this". One
   * indexed lookup per reveal is affordable: a reveal is a deliberate human tap, not a
   * per-request cost. Optional; falls back to the display name when absent or on any failure.
   */
  userRepo?: IUserRepository,
): RevealAuditService {
  return {
    async record(actor, input) {
      let username = actor.displayName;
      try {
        const u = await userRepo?.findById(actor.id);
        if (u?.username) username = u.username;
      } catch {
        // Falling back to the display name is strictly better than losing the whole row.
      }

      const row: RevealAudit = {
        id: newId('rvl'),
        kind: input.kind,
        personId: input.person.id,
        personName: `${input.person.firstName} ${input.person.lastName}`.trim(),
        churchName: input.person.churchName ?? '',
        actorId: actor.id,
        actorUsername: username,
        actorRole: actor.role,
        actorInitials: (input.initials ?? '').trim(),
        contactRole: input.contactRole ?? null,
        createdAt: nowISO(),
      };
      try {
        return await repo.save(row);
      } catch (e) {
        // ⚠️ AUDIT FAILURE MUST NOT BLOCK THE REVEAL. A first-aider standing over an injured
        // child needs the Medicare number more than the camp needs a perfect log, and the two
        // reveal endpoints are the only callers. A throw here would turn a database hiccup into
        // "the app is broken" at exactly the wrong moment. The log line is the fallback trail —
        // it is what this feature replaced, so failing back to it loses nothing that existed
        // before the table did.
        logger.error(
          `[audit] FAILED to persist ${input.kind} reveal for person ${input.person.id}` +
            ` by ${actor.role} ${actor.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
        return null;
      }
    },

    async list(limit) {
      return repo.findRecent(limit);
    },
  };
}
