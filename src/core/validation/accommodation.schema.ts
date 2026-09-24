import { z } from 'zod';

export const CreateClassroomSchema = z.object({
  name: z.string().min(1),
  capacity: z.number().int().min(1),
});
export type CreateClassroomInput = z.infer<typeof CreateClassroomSchema>;

export const UpdateClassroomSchema = z.object({
  name: z.string().min(1).optional(),
  capacity: z.number().int().min(1).optional(),
});
export type UpdateClassroomInput = z.infer<typeof UpdateClassroomSchema>;

// Allocation map: roomId -> [{ key: "<churchId>|male|female", n }]
const AllocEntrySchema = z.object({ key: z.string().min(1), n: z.number().int().min(0) });
export const SetAllocationsSchema = z.object({
  allocations: z.record(z.string(), z.array(AllocEntrySchema)),
});
export type SetAllocationsInput = z.infer<typeof SetAllocationsSchema>;

// PATCH /accommodation/per-registration/:churchId — "Left to per-registration" toggle (2026-09-24).
export const SetPerRegistrationSchema = z.object({ perRegistration: z.boolean() });
export type SetPerRegistrationInput = z.infer<typeof SetPerRegistrationSchema>;

// POST /accommodation/soft-freeze — classroom soft freeze toggle (2026-09-24).
export const SetSoftFreezeSchema = z.object({ frozen: z.boolean() });
export type SetSoftFreezeInput = z.infer<typeof SetSoftFreezeSchema>;
