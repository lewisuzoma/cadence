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

    // --- instructor feature ------------------------------------------------

    /**
     * How long a rejected applicant must wait before reapplying.
     *
     * `0` means "immediately", which is the useful setting for a demo and
     * for the test suite; 7 days is the default the review copy promises.
     */
    INSTRUCTOR_REAPPLY_COOLDOWN_DAYS: z.coerce.number().int().min(0).max(365).default(7),

    /**
     * The window that defines an "active" learner in course analytics.
     *
     * Defined once, here, because the figure appears on stat cards, in the
     * active/inactive chart and in the learners table's filter, and three
     * different windows would be three different truths.
     */
    ANALYTICS_ACTIVE_DAYS: z.coerce.number().int().min(1).max(365).default(14),

    /**
     * Where uploaded media goes. `local` writes to a Docker volume and needs
     * no other configuration, which is what keeps `docker compose up` a
     * one-liner; `s3` talks to MinIO locally and to S3 or R2 in production.
     */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    /** Force path-style addressing, which MinIO needs and S3 tolerates. */
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    MAX_VIDEO_MB: z.coerce.number().int().min(1).max(10_000).default(2048),
    MAX_IMAGE_MB: z.coerce.number().int().min(1).max(100).default(5),
    /** Lifetime of a signed upload or playback URL. */
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(86_400).default(900),

    /**
     * Above this, an upload is split into parts so a dropped connection
     * costs one part rather than the whole transfer.
     *
     * Below it, one request is simpler and faster — multipart has a
     * per-part round trip that is pure overhead on a small file.
     */
    UPLOAD_MULTIPART_THRESHOLD_MB: z.coerce.number().int().min(1).max(1024).default(16),
    /**
     * Part size.  S3 requires at least 5 MB for every part but the last,
     * so this cannot go below that.
     */
    UPLOAD_PART_SIZE_MB: z.coerce.number().int().min(5).max(512).default(8),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'The access and refresh secrets must differ in production',
      });
    }

    /*
     * Choosing the S3 driver without its settings would start the process
     * and then fail on the first upload, which is the worst time to find
     * out. Fail here instead.
     */
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
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
