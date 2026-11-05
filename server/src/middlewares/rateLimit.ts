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
