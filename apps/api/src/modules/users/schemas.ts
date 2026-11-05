import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination';
import { emailSchema, passwordSchema } from '../auth/schemas';

export const ALL_ROLES = [
  'FARMER',
  'PURCHASE_MANAGER',
  'FIELD_OFFICER',
  'TRANSPORT_OFFICER',
  'SECURITY_OFFICER',
  'FACTORY_OPERATOR',
  'ADMIN',
] as const;
/** Farmers self-register; administrators create every other role. */
export const STAFF_ROLES = ALL_ROLES.filter((r) => r !== 'FARMER') as unknown as [
  Exclude<(typeof ALL_ROLES)[number], 'FARMER'>,
  ...Exclude<(typeof ALL_ROLES)[number], 'FARMER'>[],
];

export const createUserSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    fullName: z.string().trim().min(2).max(100),
    role: z.enum(STAFF_ROLES),
  })
  .strict();

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    role: z.enum(ALL_ROLES).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listUsersQuerySchema = paginationSchema.extend({
  role: z.enum(ALL_ROLES).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });
