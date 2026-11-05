import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { corsOrigins, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { assertDatabaseReachable } from './lib/prisma.js';
import { ok } from './lib/response.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { apiLimiter } from './middlewares/rateLimit.js';
import { buildOpenApiDocument } from './openapi.js';
import { apiRouter } from './routes.js';

export function createApp(): Express {
  const app = express();

  // nginx (and any other reverse proxy) terminates the connection, so the
  // real client IP and protocol come from X-Forwarded-*.  Without this, rate
  // limiting would see one IP for everyone and `secure` cookies would be
  // dropped behind TLS termination.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The SPA is served by nginx with its own CSP; the API serves JSON and
      // the Swagger UI, which needs inline styles.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // In Docker the browser talks to nginx on one origin, so CORS never comes
  // into play.  It is kept for the non-Docker dev path (Vite on :5173).
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Origin not allowed'));
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining'],
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        // Health checks every 10s would otherwise bury the log.
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      }),
    );
  }

  // --- health ------------------------------------------------------------
  // Reports healthy only when a real query succeeds, which is what Compose
  // waits on before starting the client.
  app.get('/api/v1/health', async (_req, res) => {
    try {
      await assertDatabaseReachable();
      ok(res, 'Healthy', {
        status: 'ok',
        database: 'reachable',
        uptime: Math.round(process.uptime()),
      });
    } catch (error) {
      logger.error({ err: error }, 'Health check failed: database unreachable');
      res.status(503).json({
        success: false,
        message: 'Database unreachable',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  // --- API docs ----------------------------------------------------------
  const openApiDocument = buildOpenApiDocument();
  app.get('/api/docs.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'Cadence API',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
    }),
  );

  // --- the API -----------------------------------------------------------
  app.use('/api/v1', apiLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
