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
  // Not `passwordSchema`: the composition rules must not be re-applied at
  // sign-in, or tightening them later would lock out existing accounts.  The
  // 72-character ceiling does apply, though -- it is bcrypt's truncation point,
  // so without it an over-long password is silently cut rather than refused.
  password: z.string().min(1, 'Password is required').max(72, 'Use at most 72 characters'),
  /**
   * "Keep me signed in for 30 days", from the sign-in screen.
   *
   * It extends the refresh token's lifetime only. The access token stays
   * short either way, so even a remembered session is re-checked against the
   * user row every 15 minutes and a deactivation still takes effect.
   */
  rememberMe: z.boolean().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * "Forgot password?" — step one.  Only an email: the response is deliberately
 * identical whether or not the address is registered, so this endpoint cannot
 * be used to enumerate accounts.
 */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Step two: the token from the emailed link, plus the new password.  The
 * token is the opaque value the server mailed out — only its hash is stored,
 * so a database leak hands out no usable reset links.
 */
export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, 'This reset link is incomplete'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

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
