import { z } from 'zod';
import { INCIDENT_SEVERITIES } from '../types/enums';

export const CreateIncidentSchema = z.object({
  summary: z.string().min(1).max(2000),
  severity: z.enum(INCIDENT_SEVERITIES),
  zone: z.string().nullable().optional(),
});

export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;
