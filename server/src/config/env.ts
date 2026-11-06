import { z } from 'zod';

/**
 * Environment validation.  The process refuses to start with a bad or missing
 * value rather than failing later on the first request, and the parsed object
 * is the only way the rest of the server reads configuration.
 */

const durationPattern = /^\d+(ms|s|m|h|d)$/;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    DATABASE_URL: z.string().url('DATABASE_URL must be a Postgres connection string'),
    DATABASE_URL_TEST: z.string().url().optional(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL: z.string().regex(durationPattern, 'Use a value like 15m').default('15m'),
    REFRESH_TOKEN_TTL: z.string().regex(durationPattern, 'Use a value like 7d').default('7d'),
    /** Used when the learner ticks "keep me signed in" at sign-in. */
    REFRESH_TOKEN_TTL_REMEMBERED: z
      .string()
      .regex(durationPattern, 'Use a value like 30d')
      .default('30d'),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

    /** Comma-separated allow-list, used only on the non-Docker dev path. */
    CORS_ORIGIN: z.string().default('http://localhost:5173'),

    /**
     * Where the SPA is reachable.  Password-reset links are built from this,
     * and from nothing in the request: deriving the host from an inbound
     * `Host` header would let an attacker who can set it have the link point
     * at their own server.
     */
    APP_URL: z.string().url('APP_URL must be an absolute URL').default('http://localhost:8080'),
    /** The From: on transactional mail. */
    MAIL_FROM: z.string().min(1).default('Cadence <no-reply@cadence.dev>'),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'The access and refresh secrets must differ in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    // Fail loudly and early: a half-configured server is worse than no server.
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** The CORS allow-list, parsed once. */
export const corsOrigins: string[] = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
