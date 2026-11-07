import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination';
import { positiveDecimal } from '../procurement/schemas';

const reason = z.string().trim().min(3, 'A reason of at least 3 characters is required').max(500);
const notes = z.string().trim().max(1000);

/** ISO 8601 date-time with offset, for example 2026-10-22T10:30:00.000Z. Converted to a Date. */
export const dateTime = z
  .string()
  .datetime({ offset: true, message: 'Use an ISO date-time such as 2026-10-22T10:30:00Z' })
  .transform((value) => new Date(value));

const FIVE_MINUTES = 5 * 60 * 1000;

export const COLLECTION_STATUS_VALUES = ['ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED', 'HANDED_OVER', 'CANCELLED'] as const;
export const INCIDENT_TYPES = ['DELAY', 'DAMAGE', 'QUANTITY_SHORTFALL', 'VEHICLE_BREAKDOWN', 'OTHER'] as const;

export const assignTransportSchema = z
  .object({
    transportOfficerId: z.string().uuid('Choose a transport officer'),
    vehicleId: z.string().uuid('Choose a vehicle'),
    scheduledPickupAt: dateTime.optional(),
    expectedArrivalAt: dateTime.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scheduledPickupAt && value.scheduledPickupAt.getTime() < Date.now() - FIVE_MINUTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledPickupAt'], message: 'Pickup time cannot be in the past' });
    }
    if (value.expectedArrivalAt && value.expectedArrivalAt.getTime() < Date.now()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedArrivalAt'], message: 'Expected arrival cannot be in the past' });
    }
    if (value.scheduledPickupAt && value.expectedArrivalAt && value.expectedArrivalAt <= value.scheduledPickupAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedArrivalAt'], message: 'Expected arrival must be after the pickup time' });
    }
  });

export const loadSchema = z.object({ collectedQuantityKg: positiveDecimal('Collected quantity', 3), notes: notes.optional() }).strict();

export const dispatchSchema = z
  .object({ expectedArrivalAt: dateTime.optional() })
  .strict()
  .refine((v) => !v.expectedArrivalAt || v.expectedArrivalAt.getTime() > Date.now(), {
    path: ['expectedArrivalAt'],
    message: 'Expected arrival must be in the future',
  });

export const arriveSchema = z.object({}).strict();
export const handoverSchema = z.object({ notes: notes.optional() }).strict();

export const incidentSchema = z
  .object({
    type: z.enum(INCIDENT_TYPES),
    description: z.string().trim().min(3, 'Describe what happened').max(1000),
    quantityAffectedKg: positiveDecimal('Quantity affected', 3).optional(),
  })
  .strict();

export const collectionCancelSchema = z.object({ reason }).strict();

export const listCollectionsQuerySchema = paginationSchema.extend({
  status: z.enum(COLLECTION_STATUS_VALUES).optional(),
});

export type AssignTransportInput = z.infer<typeof assignTransportSchema>;
export type LoadInput = z.infer<typeof loadSchema>;
export type IncidentInput = z.infer<typeof incidentSchema>;
