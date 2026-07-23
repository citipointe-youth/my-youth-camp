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
  createdAt: ISODateString;
}
