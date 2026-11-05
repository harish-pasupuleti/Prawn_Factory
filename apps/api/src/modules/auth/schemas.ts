import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

const indianMobile = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));

const text = (label: string, min = 2, max = 100) =>
  z.string().trim().min(min, `${label} is required`).max(max, `${label} is too long`);

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    fullName: text('Full name'),
    phone: indianMobile,
    village: text('Village'),
    district: text('District'),
    state: text('State'),
  })
  .strict()
  .refine((value) => value.password.toLowerCase() !== value.email, {
    path: ['password'],
    message: 'Password must not be the same as your email',
  });

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required').max(128),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
