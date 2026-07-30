import { z } from 'zod';
import { INCIDENT_SEVERITIES, ZONE_NAMES } from '../types/enums';

export const CreateIncidentSchema = z.object({
  summary: z.string().min(1).max(2000),
  severity: z.enum(INCIDENT_SEVERITIES),
  /**
   * The zone the incident relates to. Constrained to the four real zones (2026-07-30) — it was
   * free text, so a typo silently mis-filed a safeguarding record and rendered as garbage.
   * Still OPTIONAL (defaults to the actor's zone) and deliberately NOT constrained to the
   * actor's own zone: a zone leader may file against another zone, which is owner-approved
   * behaviour pinned by "an explicit zone overrides the actor zone" in incident.service.test.ts.
   */
  zone: z.enum(ZONE_NAMES).nullish(),
  /**
   * When the incident ACTUALLY happened, as opposed to `createdAt` (when it was logged).
   * OPTIONAL — an incident logged without it is completely valid and must not warn or block.
   * `.nullish()` NOT `.optional()`: the SPA sends explicit `null`s and `.optional()` rejects an
   * explicit null with "Validation failed" (the repo's documented recurring mistake).
   * Must be a full ISO instant (with `Z` or an offset). A bare wall-clock string like
   * `2026-07-30T09:00` is rejected on purpose — parsing one server-side is the UTC-vs-Brisbane
   * bug that has hit this repo twice (it lands 10 hours out).
   */
  occurredAt: z.string().datetime({ offset: true }).nullish(),
});

export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;
