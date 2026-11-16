import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination';
import { toGrams } from '../../lib/quantity';
import { BOX_FORMS, MAX_BOXES_PER_ENTRY, MAX_REQUIREMENT_LINES, requirementKey, SIZE_GRADES } from './rules';

const boxWeight = z
  .string()
  .trim()
  .regex(/^\d{1,4}(\.\d{1,3})?$/, 'Enter the box weight in kg, for example 10 or 2.5')
  .refine((v) => toGrams(v) > 0n, 'Box weight must be more than zero');

const line = z
  .object({
    form: z.enum(BOX_FORMS),
    sizeGrade: z.enum(SIZE_GRADES),
    boxWeightKg: boxWeight,
    quantity: z.number({ invalid_type_error: 'Enter the number of boxes' }).int().min(1, 'At least 1 box').max(100_000),
  })
  .strict();

export const boxPlanSchema = z
  .object({ lines: z.array(line).min(1, 'Add at least one box requirement').max(MAX_REQUIREMENT_LINES) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.lines.forEach((l, i) => {
      const key = requirementKey(l.form, l.sizeGrade, l.boxWeightKg);
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['lines', i], message: 'This form, size and box weight is already listed' });
      seen.add(key);
    });
  });
export type BoxPlanInput = z.infer<typeof boxPlanSchema>;

export const addBoxesSchema = z
  .object({
    requirementId: z.string().uuid('Choose the box requirement'),
    netWeightKg: boxWeight,
    count: z.number().int().min(1).max(MAX_BOXES_PER_ENTRY).default(1),
  })
  .strict();
export type AddBoxesInput = z.infer<typeof addBoxesSchema>;

export const assignIdsSchema = z.object({ boxIds: z.array(z.string().uuid()).min(1).max(500).optional() }).strict();
export const voidBoxSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(300) }).strict();
export const approvePackingSchema = z.object({ note: z.string().trim().max(300).optional() }).strict();
export const listPackingQuerySchema = paginationSchema.extend({ state: z.enum(['open', 'approved']).optional() });
