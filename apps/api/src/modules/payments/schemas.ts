import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination';
import { PAYMENT_METHODS } from './rules';

const details = {
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(60, 'Keep the reference under 60 characters').optional(),
};

export const decidePaymentSchema = z.object({ option: z.enum(['PAY_NOW', 'PAY_LATER']), ...details }).strict();
export const settlePaymentSchema = z.object(details).strict();
export const listPaymentsQuerySchema = paginationSchema.extend({
  state: z.enum(['AWAITING_DECISION', 'PAY_LATER', 'PAID']).optional(),
  requestId: z.string().uuid().optional(),
});
