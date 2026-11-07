import rateLimit, { type Options } from 'express-rate-limit';
import { isTest } from '../config/env.js';

/**
 * Rate limiting.  Disabled under NODE_ENV=test, because the integration suite
 * makes dozens of login attempts on purpose and 429s would make it flaky.
 */
const shared: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    success: false,
    message: 'Too many requests. Please try again shortly.',
    code: 'RATE_LIMITED',
  },
};

/** Login / register / refresh: ~10 attempts per 15 minutes per IP. */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

/** A wide net over the rest of the API, to blunt scripted abuse. */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
});

/**
 * Upload authorization: 30 per 10 minutes.
 *
 * Asking for an upload target is one cheap request for a client, but it
 * reserves a database row and a storage key for us, so it is worth pacing
 * on its own rather than leaving it to the broad API limiter. Keyed by
 * user rather than IP, because several instructors behind one office NAT
 * must not throttle each other.
 */
export const uploadLimiter = rateLimit({
  ...shared,
  windowMs: 10 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
});
