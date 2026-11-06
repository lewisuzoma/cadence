import { Router } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@cadence/shared';
import { authenticate } from '../../middlewares/authenticate.js';
import { asyncHandler } from '../../middlewares/errorHandler.js';
import { authLimiter } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validate.js';
import { authController } from './auth.controller.js';

export const authRouter = Router();

// Register / login / refresh are rate limited and CSRF-exempt: there is no
// session to protect yet, and these are the endpoints that mint the token.
authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);

authRouter.post('/refresh', authLimiter, asyncHandler(authController.refresh));

/*
 * Password reset.  Rate limited and CSRF-exempt for the same reason as login:
 * the caller has no session and therefore no CSRF cookie to echo.  The limit
 * matters more here than anywhere else — these are the two endpoints an
 * attacker would hammer to mine addresses or brute-force a token.
 */
authRouter.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(authController.forgotPassword),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(authController.resetPassword),
);

authRouter.post('/logout', asyncHandler(authController.logout));

authRouter.get('/me', authenticate, asyncHandler(authController.me));

authRouter.patch(
  '/me',
  authenticate,
  validate({ body: updateProfileSchema }),
  asyncHandler(authController.updateProfile),
);

authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(authController.changePassword),
);
