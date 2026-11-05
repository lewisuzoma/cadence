import { z } from 'zod';
import { ROLES } from '../enums.js';
import { uuidSchema } from './common.js';

/**
 * Passwords need at least one letter and one digit on top of the length rule.
 * Kept deliberately simple: a long shared secret beats a baroque rule set the
 * user works around with "Password1!".
 */
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters') // bcrypt truncates beyond 72 bytes
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  .max(254)
  .toLowerCase();

const nameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(60, `${label} must be 60 characters or fewer`)
    .regex(/^[\p{L}\p{M}'\- .]+$/u, `${label} contains invalid characters`);

export const registerSchema = z
  .object({
    firstName: nameSchema('First name'),
    lastName: nameSchema('Last name'),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  firstName: nameSchema('First name'),
  lastName: nameSchema('Last name'),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** The public shape of a user.  The password hash never leaves the server. */
export const userSchema = z.object({
  id: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

export type AuthResponse = { user: User };
