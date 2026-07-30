import type { ID, ISODateString } from '../types/common';
import type { NotificationScope, NotificationPriority, UserRole } from '../types/enums';

export interface Notification {
  id: ID;
  scope: NotificationScope;
  zone?: string | null;
  churchId?: string | null;
  priority: NotificationPriority;
  title: string;
  body: string;
  senderId: ID;
  senderName: string;
  senderRole: UserRole;
  /**
   * When true, this notice is only visible to leadership oversight roles
   * (zoneLeader/director/admin) and is hidden from church/firstAid feeds even
   * when its scope is 'camp'. Used for system-raised incident alerts, whose
   * summaries can describe a minor and must not reach church logins.
   */
  leadersOnly?: boolean;
  audienceEstimate: number;
  expiresAt?: ISODateString | null;
  /**
   * When set to a future instant, this notice is a SCHEDULED notice: it is withheld from
   * every audience feed until `scheduledFor <= now` (lazy-fire — no server scheduler needed,
   * since feeds are re-fetched on every home/Notices load). The creator (+ director/admin)
   * can view/edit/delete it while it is still pending. Null/absent = an ordinary immediate notice.
   */
  scheduledFor?: ISODateString | null;
  /**
   * Set the instant this notice was claimed for push delivery. The claim is an atomic
   * conditional update (`where push_sent_at is null`), which is what makes the inline
   * incident send and the scheduled sweeper safe to race. Null = not yet pushed.
   */
  pushSentAt?: ISODateString | null;
  /**
   * Deterministic key for notices the scheduler CREATES (currently only the check-in
   * window warning: `checkin-warn:<sessionId>:<churchUserId>`). Unique where non-null,
   * so repeated ticks inside the lead window produce exactly one notice. Null for every
   * human-authored notice.
   */
  dedupeKey?: string | null;
  /**
   * When set, this notice is for that ONE login and nobody else — including admin and
   * director, who bypass every other scope rule. Enforced in `canSeeNotification`.
   *
   * Needed because the check-in warning is counted per LOGIN, not per church: gender-scoped
   * `b-`/`g-` accounts share a `churchId` but hold different counts, so a church-scoped
   * notice would show each login both numbers. Null for every human-authored notice, which
   * is addressed by scope (camp/zone/church) as before.
   */
  targetUserId?: ID | null;
  createdAt: ISODateString;
}
