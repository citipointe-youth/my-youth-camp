import { z } from 'zod';
import { SCHEDULE_ITEM_TYPES, CAMP_MODES } from '../types/enums';

export const CreateFaqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  order: z.number().int().min(0).optional().default(0),
});

export type CreateFaqInput = z.infer<typeof CreateFaqSchema>;

export const UpdateFaqSchema = z.object({
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  order: z.number().int().min(0).optional(),
});

export type UpdateFaqInput = z.infer<typeof UpdateFaqSchema>;

export const SetDevotionalSchema = z.object({
  day: z.string().min(1),
  verse: z.string().min(1),
  reference: z.string().min(1),
  reflection: z.string().min(1),
  prayer: z.string().min(1),
});

export type SetDevotionalInput = z.infer<typeof SetDevotionalSchema>;

export const CreateScheduleItemSchema = z.object({
  day: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().nullable().optional(),
  title: z.string().min(1),
  location: z.string().nullable().optional(),
  type: z.enum(SCHEDULE_ITEM_TYPES),
});

export type CreateScheduleItemInput = z.infer<typeof CreateScheduleItemSchema>;

export const UpdateScheduleItemSchema = z.object({
  day: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  location: z.string().nullable().optional(),
  type: z.enum(SCHEDULE_ITEM_TYPES).optional(),
});

export type UpdateScheduleItemInput = z.infer<typeof UpdateScheduleItemSchema>;

// Item 6: bulk replace-a-day payload — one call instead of N deletes + N creates.
export const ReplaceScheduleDaySchema = z.object({
  day: z.string().min(1),
  items: z.array(
    z.object({
      startTime: z.string().min(1),
      endTime: z.string().nullable().optional(),
      title: z.string().min(1),
      location: z.string().nullable().optional(),
      type: z.enum(SCHEDULE_ITEM_TYPES).default('activity'),
    }),
  ),
});

export type ReplaceScheduleDayInput = z.infer<typeof ReplaceScheduleDaySchema>;

export const SetModeSchema = z.object({
  campMode: z.enum(CAMP_MODES),
});

export type SetModeInput = z.infer<typeof SetModeSchema>;

export const UpdateSettingsSchema = z.object({
  campName: z.string().min(1).optional(),
  year: z.number().int().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  timezone: z.string().optional(),
  checkInBanner: z.string().nullable().optional(),
  checkInDays: z.array(z.string()).optional(),
  accommodationLocked: z.boolean().optional(),
  churchLoginLocked: z.boolean().optional(),
  zoneLeaderLoginLocked: z.boolean().optional(),
  churchCheckinTimeRestricted: z.boolean().optional(),
  checkinSwitchoverTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM 24h').optional(),
  checkinPhaseOverride: z.enum(['auto', 'signin', 'checkin']).optional(),
  checkinWindowAmStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM 24h').optional(),
  checkinWindowAmEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM 24h').optional(),
  checkinWindowPmStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM 24h').optional(),
  checkinWindowPmEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM 24h').optional(),
  campMode: z.enum(CAMP_MODES).optional(),
  /* 2026-07-29 (migration 0017): admin-set reference prices for a full-price ticket, used by the
     budget's ticket classification. `.nullish()` NOT `.optional()` — clearing the field is a
     normal edit and the SPA posts an explicit `null` for it, which `.optional()` would reject
     (it accepts only `undefined`). Same rule the 2026-07-28 AddNoteSchema fix established. */
  tentPrice: z.number().min(0).nullish(),
  classroomPrice: z.number().min(0).nullish(),
  /* Item 8 (2026-07-28): site map. Client-baked `data:image/...` URI or null to remove it.
     Rejecting anything that isn't a data-image URI keeps a remote URL (and with it an SSRF /
     tracking-pixel surface, and a CSP violation on render) out of the settings row entirely —
     same rule YS Connection applies to its logo. The 1.6M cap is ~1.2MB of image, chosen so a
     1400px-wide site map stays legible; base64 is ~4/3 the byte size. */
  siteMapImage: z.string()
    .max(1_600_000)
    .refine((v) => v.startsWith('data:image/'), 'siteMapImage must be a data:image/... URI')
    .nullable()
    .optional(),
});

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;
