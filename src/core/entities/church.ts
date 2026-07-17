import type { ID, ISODateString } from '../types/common';
import type { AccommodationKind, ZoneName } from '../types/enums';

export interface ChurchContact {
  name: string;
  phone: string;
}

export interface Church {
  id: ID;
  name: string;
  zone: ZoneName;
  contactPhone?: string;
  /**
   * Accommodation override — when set, EVERYONE at this church (students AND leaders) has
   * their accommodationKind forced to this value at CSV import time (corrects wrong
   * ticket-type purchases; Bug 2, 2026-07-17 — was students-only). Null/absent = no override
   * (churches that deliberately split ticket types leave this unset).
   */
  accommodationOverride?: AccommodationKind | null;
  contacts: {
    male: { primary: ChurchContact; backup: ChurchContact };
    female: { primary: ChurchContact; backup: ChurchContact };
  };
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
