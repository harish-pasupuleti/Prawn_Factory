import { z } from 'zod';
import { env } from '../../config/env';
import { normalizeDecimal } from '../../lib/decimal';
import { paginationSchema } from '../../lib/pagination';
import { PROCUREMENT_STATUSES } from '../../lib/stateMachine';

/** Today's date (YYYY-MM-DD) in the factory time zone. */
export function todayInTimezone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Positive decimal accepted as string or number, validated with a regex, normalised to fixed decimals. */
export const positiveDecimal = (label: string, decimalPlaces: number, maxIntegerDigits = 9) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .pipe(
      z
        .string()
        .regex(
          new RegExp(`^\\d{1,${maxIntegerDigits}}(\\.\\d{1,${decimalPlaces}})?$`),
          `${label} must be a number with at most ${decimalPlaces} decimal places`,
        )
        .refine((value) => /[1-9]/.test(value), `${label} must be greater than zero`),
    )
    .transform((value) => normalizeDecimal(value, decimalPlaces));

/** Like positiveDecimal but zero is allowed (for example a failed inspection that finds nothing). */
export const nonNegativeDecimal = (label: string, decimalPlaces: number, maxIntegerDigits = 9) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .pipe(
      z
        .string()
        .regex(
          new RegExp(`^\\d{1,${maxIntegerDigits}}(\\.\\d{1,${decimalPlaces}})?$`),
          `${label} must be a number with at most ${decimalPlaces} decimal places`,
        ),
    )
    .transform((value) => normalizeDecimal(value, decimalPlaces));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date');

export const availabilityDate = isoDate.refine(
  (value) => value >= todayInTimezone(env.FACTORY_TIMEZONE),
  'Availability date cannot be in the past',
);

const species = z.string().trim().min(2, 'Species is required').max(80);
const sizeCount = z.string().trim().min(1, 'Declared size or count is required').max(60);
const quantityKg = positiveDecimal('Quantity (kg)', 3);
const priceInr = positiveDecimal('Price (INR per kg)', 2);
const notes = z.string().trim().max(1000);
const reason = z.string().trim().min(3, 'A reason of at least 3 characters is required').max(500);

export const createRequestSchema = z
  .object({
    species,
    declaredSizeCount: sizeCount,
    declaredQuantityKg: quantityKg,
    expectedPriceInrPerKg: priceInr,
    availabilityDate,
    notes: notes.optional(),
  })
  .strict();

export const decisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_CLARIFICATION']),
    reason: reason.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision !== 'APPROVE' && !value.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A reason is required for this decision' });
    }
  });

export const cancelSchema = z.object({ reason }).strict();
export const resubmitSchema = z.object({ note: notes.optional() }).strict();

const amendment = <F extends string, V extends z.ZodTypeAny>(field: F, value: V) =>
  z.object({ field: z.literal(field), newValue: value, reason }).strict();

export const amendSchema = z.discriminatedUnion('field', [
  amendment('species', species),
  amendment('declaredSizeCount', sizeCount),
  amendment('declaredQuantityKg', quantityKg),
  amendment('expectedPriceInrPerKg', priceInr),
  amendment('availabilityDate', availabilityDate),
  amendment('notes', notes),
]);

export const listQuerySchema = paginationSchema.extend({
  status: z.enum(PROCUREMENT_STATUSES).optional(),
  q: z.string().trim().max(50).optional(),
  sort: z.enum(['createdAt', 'code', 'status']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type AmendInput = z.infer<typeof amendSchema>;
