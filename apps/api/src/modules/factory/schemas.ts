import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination';
import { dateTime } from '../collections/schemas';
import { nonNegativeDecimal } from '../procurement/schemas';

const FIVE_MINUTES = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const reason = z.string().trim().min(3, 'A reason of at least 3 characters is required').max(500);
const uuid = (label: string) => z.string().uuid(`Choose ${label}`);

export const BOOKING_STATUS_VALUES = ['RESERVED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW'] as const;
export const SHIPMENT_STATUS_VALUES = ['EXPECTED', 'ADMITTED', 'RECEIVED', 'RELEASED'] as const;
export const QUEUE_STATUS_VALUES = ['QUEUED', 'IN_PROGRESS', 'COMPLETED'] as const;
export const EXCEPTION_TYPE_VALUES = ['RECEPTION_DISCREPANCY', 'GATE_REJECTION'] as const;

// ------------------------------------------------------------------ slots
export const createSlotSchema = z
  .object({
    startsAt: dateTime,
    endsAt: dateTime,
    capacity: z.number({ invalid_type_error: 'Capacity must be a whole number' }).int().min(1, 'Capacity must be at least 1').max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.endsAt <= v.startsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'The slot must end after it starts' });
    } else if (v.endsAt.getTime() - v.startsAt.getTime() > DAY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'A slot cannot be longer than 24 hours' });
    }
    if (v.startsAt.getTime() < Date.now() - FIVE_MINUTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startsAt'], message: 'A slot cannot start in the past' });
    }
  });

export const updateSlotSchema = z
  .object({ capacity: z.number().int().min(1).max(100).optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listSlotsQuerySchema = paginationSchema.extend({
  includePast: z.enum(['true', 'false']).optional(),
  active: z.enum(['true', 'false']).optional(),
});

// ------------------------------------------------------------------ bookings and gate
export const createBookingSchema = z.object({ collectionJobId: uuid('a collection job'), slotId: uuid('a slot') }).strict();
export const rescheduleBookingSchema = z.object({ slotId: uuid('a slot'), reason }).strict();
export const reasonOnlySchema = z.object({ reason }).strict();
export const optionalReasonSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export const emptyBodySchema = z.object({}).strict();
export const verifySchema = z.object({ registrationNumber: z.string().trim().min(2, 'Enter the vehicle registration').max(20) }).strict();

export const listBookingsQuerySchema = paginationSchema.extend({
  status: z.enum(BOOKING_STATUS_VALUES).optional(),
  from: dateTime.optional(),
  to: dateTime.optional(),
});

// ------------------------------------------------------------------ shipments and weights
export const recordWeightSchema = z
  .object({ kind: z.enum(['GROSS', 'TARE']), valueKg: nonNegativeDecimal('Weight', 3) })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'GROSS' && !/[1-9]/.test(v.valueKg)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueKg'], message: 'Gross weight must be greater than zero' });
    }
  });

export const correctWeightSchema = z
  .object({ kind: z.enum(['GROSS', 'TARE']), valueKg: nonNegativeDecimal('Weight', 3), reason })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'GROSS' && !/[1-9]/.test(v.valueKg)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueKg'], message: 'Gross weight must be greater than zero' });
    }
  });

export const listShipmentsQuerySchema = paginationSchema.extend({
  status: z.enum(SHIPMENT_STATUS_VALUES).optional(),
  q: z.string().trim().max(50).optional(),
});

// ------------------------------------------------------------------ exceptions
export const listExceptionsQuerySchema = paginationSchema.extend({
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
  type: z.enum(EXCEPTION_TYPE_VALUES).optional(),
});
export const exceptionNoteSchema = z.object({ note: z.string().trim().min(3, 'Write at least 3 characters').max(1000) }).strict();
export const resolveExceptionSchema = z.object({ resolution: z.string().trim().min(3, 'Explain how this was resolved').max(1000) }).strict();

// ------------------------------------------------------------------ stations and queue
export const createStationSchema = z.object({ name: z.string().trim().min(2, 'Station name is required').max(60) }).strict();
export const updateStationSchema = z
  .object({ name: z.string().trim().min(2).max(60).optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listQueueQuerySchema = paginationSchema.extend({ status: z.enum(QUEUE_STATUS_VALUES).optional() });
export const startQueueSchema = z.object({ stationId: uuid('a station') }).strict();
export const completeQueueSchema = z.object({ notes: z.string().trim().max(1000).optional() }).strict();
