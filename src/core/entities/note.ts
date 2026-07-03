import type { ID, ISODateString } from '../types/common';

export interface StudentNote {
  id: ID;
  // Null for a "general" testimony not tied to a specific student.
  camperId: ID | null;
  body: string;
  authorId: ID;
  authorName: string;
  authorChurchId?: string | null;
  sessionId?: string | null;
  /** Record category: 'note' | 'testimony' | (attendance kinds), free-form for forward compatibility. */
  category?: string | null;
  /** When true, hidden from the individual student-profile note list for church logins only
   * (zoneLeader/director/admin still see it there). Defaults false. */
  sensitive?: boolean;
  createdAt: ISODateString;
}
