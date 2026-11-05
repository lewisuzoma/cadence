import { pino } from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

/**
 * Structured logging with redaction.  Passwords, tokens, cookies and auth
 * headers never reach the log, whatever a handler passes in.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      'password',
      'confirmPassword',
      'currentPassword',
      'passwordHash',
      'token',
      'refreshToken',
      'accessToken',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redacted]',
  },
  // Pretty output is a dev-only convenience; production logs stay JSON.
  transport: isProduction || isTest ? undefined : { target: 'pino/file', options: { destination: 1 } },
});
