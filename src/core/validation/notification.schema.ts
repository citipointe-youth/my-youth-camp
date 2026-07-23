import { z } from 'zod';
import { NOTIFICATION_SCOPES, NOTIFICATION_PRIORITIES } from '../types/enums';

export const CreateNotificationSchema = z.object({
  scope: z.enum(NOTIFICATION_SCOPES),
  zone: z.string().nullable().optional(),
  churchId: z.string().nullable().optional(),
  priority: z.enum(NOTIFICATION_PRIORITIES).optional().default('normal'),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(1000),
  expiresAt: z.string().nullable().optional(),
  // ISO instant at which a SCHEDULED notice becomes visible. Null/absent = send immediately.
  scheduledFor: z.string().nullable().optional(),
});

export type CreateNotificationInput = z.infer<typeof CreateNotificationSchema>;

// Editing a (typically still-scheduled) notice. Every field optional; scope/zone changes are
// re-authorised in the service via assertCanSendNotification.
export const UpdateNotificationSchema = z.object({
  scope: z.enum(NOTIFICATION_SCOPES).optional(),
  zone: z.string().nullable().optional(),
  churchId: z.string().nullable().optional(),
  priority: z.enum(NOTIFICATION_PRIORITIES).optional(),
  title: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(1000).optional(),
  expiresAt: z.string().nullable().optional(),
  scheduledFor: z.string().nullable().optional(),
});

export type UpdateNotificationInput = z.infer<typeof UpdateNotificationSchema>;
