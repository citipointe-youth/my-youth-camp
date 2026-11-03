import { z } from 'zod';
import { GENDERS, GRADES } from '../types/enums';

/**
 * Shape checks on what PATCH/POST /registrants will take (QA item 28). Only the fields a person
 * types or that drive a filter are checked; `.passthrough()` leaves every other field to the
 * controller's own handling, so this can't start rejecting an existing screen's payload.
 * Grade and gender stay nullable/optional because imports legitimately leave them unset.
 */
const name = z.string().trim().min(1, 'Name cannot be blank').max(100, 'Name is too long');
const shortText = z.string().max(200).nullable().optional();

export const RegistrantPatchSchema = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    gender: z.enum(GENDERS).optional(),
    grade: z.number().int().min(GRADES[0]).max(GRADES[GRADES.length - 1]!).nullable().optional(),
    mobile: shortText,
    parentPhone: shortText,
    parentGuardianName: shortText,
    parentName: shortText,
    medical: z.string().max(2000).nullable().optional(),
    dietary: z.string().max(2000).nullable().optional(),
  })
  .passthrough();
