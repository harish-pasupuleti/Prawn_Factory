import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination';
import { nonNegativeDecimal } from '../procurement/schemas';

const reason = z.string().trim().min(3, 'A reason of at least 3 characters is required').max(500);

export const INSPECTION_OUTCOMES = ['PASS', 'FAIL', 'REVIEW'] as const;
export const INSPECTION_STATUS_VALUES = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export const assignInspectionSchema = z.object({ officerId: z.string().uuid('Choose a field officer') }).strict();

export const completeInspectionSchema = z
  .object({
    outcome: z.enum(INSPECTION_OUTCOMES),
    observedSpecies: z.string().trim().min(2, 'Observed species is required').max(80),
    observedSizeCount: z.string().trim().min(1, 'Observed size or count is required').max(60),
    inspectedQuantityKg: nonNegativeDecimal('Inspected quantity', 3),
    qualityNotes: z.string().trim().min(3, 'Quality observations are required').max(1000),
    discrepancyNotes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome !== 'FAIL' && !/[1-9]/.test(value.inspectedQuantityKg)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inspectedQuantityKg'],
        message: 'Inspected quantity must be greater than zero for a PASS or REVIEW outcome',
      });
    }
  });

export const inspectionDecisionSchema = z
  .object({ decision: z.enum(['PROCEED', 'REJECT', 'REINSPECT']), reason })
  .strict();

export const inspectionCancelSchema = z.object({ reason }).strict();

export const listInspectionsQuerySchema = paginationSchema.extend({
  status: z.enum(INSPECTION_STATUS_VALUES).optional(),
  outcome: z.enum(INSPECTION_OUTCOMES).optional(),
});

export type CompleteInspectionInput = z.infer<typeof completeInspectionSchema>;
