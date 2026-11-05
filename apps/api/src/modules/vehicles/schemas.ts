import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination';
import { positiveDecimal } from '../procurement/schemas';

const registration = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/[\s]+/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9-]{4,20}$/, 'Use 4-20 letters, digits or hyphens, for example AP31TX1234'));

export const createVehicleSchema = z
  .object({
    registrationNumber: registration,
    description: z.string().trim().max(200).optional(),
    capacityKg: positiveDecimal('Capacity (kg)', 3),
  })
  .strict();

export const updateVehicleSchema = z
  .object({
    description: z.string().trim().max(200).optional(),
    capacityKg: positiveDecimal('Capacity (kg)', 3).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listVehiclesQuerySchema = paginationSchema.extend({
  active: z.enum(['true', 'false']).optional(),
});
