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
  createdAt: ISODateString;
}
