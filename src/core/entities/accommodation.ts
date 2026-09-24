import type { ID, ISODateString } from '../types/common';

export type AllocationGender = 'male' | 'female';

/**
 * PC-10 grade bracket. A church×gender classroom pool over the split threshold is
 * divided into 7-9 / 10-12 sub-pools, and allocation rows for those sub-pools carry
 * the bracket so the 3-part group key (`churchId|gender|bracket`) survives persistence.
 * (Defined here in core — entities import from no other layer; the allocation service
 * re-exports a structurally identical `GradeBracket`.)
 */
export type AllocationBracket = '7-9' | '10-12';

/** A reusable classroom room (scaffold). Capacity is a head count. */
export interface Classroom {
  id: ID;
  name: string;
  capacity: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * One placement row: `n` campers of `churchId`+`gender` placed in `roomId`.
 * `bracket` is set only for PC-10 split sub-pools (`7-9` / `10-12`); for a non-split
 * church×gender pool it is null/absent. Persisting it keeps the 3-part group key
 * (`churchId|gender|bracket`) intact through a save/load round-trip (C-1).
 */
export interface RoomAllocation {
  id: ID;
  roomId: ID;
  churchId: ID;
  gender: AllocationGender;
  n: number;
  bracket?: AllocationBracket | null;
  /** Insertion order within the stored map (migration 0030). "First-placed room" — the
   *  soft-freeze tie-break — is the earliest row; null on rows written before 0030. */
  seq?: number | null;
}

/**
 * Classroom soft freeze (2026-09-24, migration 0030). A singleton (`id: 'freeze'`); no row = not
 * frozen. While it exists, eligibility and pool shape come from this snapshot, and each group's
 * growth past its baseline is absorbed into the rooms it already occupies.
 */
export interface ClassroomFreeze {
  id: ID;
  frozenAt: ISODateString;
  frozenBy: string;
  eligibleChurchIds: string[];
  /** keyed `${churchId}|${gender}` */
  shapes: Record<string, { split: boolean; years79?: boolean; years1012?: boolean }>;
  /** group key → group size when frozen (or when a save last changed that group) */
  baselines: Record<string, number>;
}
export const CLASSROOM_FREEZE_ID = 'freeze';
