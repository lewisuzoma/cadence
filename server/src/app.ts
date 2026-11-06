import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { corsOrigins, isTest } from './config/env.js';
import { ForbiddenError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { assertDatabaseReachable } from './lib/prisma.js';
import { ok } from './lib/response.js';
import { asyncHandler, errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { apiLimiter } from './middlewares/rateLimit.js';
import { requestId } from './middlewares/requestId.js';
import { buildOpenApiDocument } from './openapi.js';
import { apiRouter } from './routes.js';

/**
 * Whether a request came from the very origin it was sent to.
 *
 * Trusting `Host` and `X-Forwarded-Proto` here is sound: a cross-origin page
 * cannot forge `Origin`, and a non-browser client that forges `Host` has no
 * browser protections left to subvert.  CSRF is defended by the double-submit
 * `csrf_token` cookie (see middlewares/csrf.ts), never by CORS.
 *
 * `req.get('host')` rather than `req.hostname`: the latter drops the port, and
 * the port is part of an origin.  nginx forwards the browser's `Host` verbatim
 * (`$http_host`, not `$host`, which would strip it) so it survives the proxy.
 */
function isSameOrigin(req: Request, origin: string): boolean {
  const host = req.get('host');
  if (!host) return false;
  return origin.toLowerCase() === `${req.protocol}://${host}`.toLowerCase();
}

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

  /*
   * CORS.
   *
   * A browser sends `Origin` on every request whose method is not GET or HEAD,
   * *including same-origin ones* — being same-origin suppresses the preflight,
   * not the header.  So the SPA's own POSTs arrive here carrying
   * `Origin: http://localhost:8080` even though nginx serves the app and the
   * API from that single origin.  An allow-list alone therefore has to know
   * whichever port the stack is published on, and when `CLIENT_PORT` and
   * `CORS_ORIGIN` disagreed every browser mutation was refused — and, worse,
   * refused as a 500.
   *
   * Same-origin is now decided from the request itself, so no configuration is
   * involved.  `CORS_ORIGIN` is only for genuinely cross-origin callers, such
   * as `vite dev` on :5173 talking to the API on :4000.
   */
  app.use(
    cors<Request>((req, callback) => {
      const origin = req.headers.origin;
      const allowed =
        // No Origin at all: a non-browser client (curl, the container health
        // check, supertest).  CORS has nothing to say about those.
        !origin || corsOrigins.includes(origin) || isSameOrigin(req, origin);

      if (!allowed) {
        logger.warn({ origin, path: req.originalUrl }, 'Rejected cross-origin request');
        /*
         * Rejected before the route runs, not merely stripped of its CORS
         * header.  Omitting the header would leave the browser unable to *read*
         * the response while the handler still executed -- which on
         * /auth/login means a cross-origin page could drive a real sign-in and
         * plant session cookies it never gets to see.  A 403 keeps the
         * pre-existing behaviour of refusing outright; the only thing that
         * changes is that it is no longer reported as a server fault.
         */
        callback(new ForbiddenError('Cross-origin requests from this origin are not allowed'));
        return;
      }

      callback(null, {
        origin: true,
        credentials: true,
        allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
        exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'X-Request-Id'],
      });
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Deliberately outside the `isTest` guard below: the integration tests assert
  // on X-Request-Id, and an id that only exists in production is an id you
  // cannot write a regression test for.
  app.use(requestId);

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        // Reuse the id rather than letting pino mint its own, so the request
        // log line and any error log line for that request agree.
        genReqId: (req) => (req as Request).requestId ?? 'unknown',
        // Health checks every 10s would otherwise bury the log.
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      }),
    );
  }

  // --- health ------------------------------------------------------------
  // Reports healthy only when a real query succeeds, which is what Compose
  // waits on before starting the client.
  app.get(
    '/api/v1/health',
    // Wrapped so the promise cannot float: Express 4 does not await handlers,
    // and an unhandled rejection here would take the process down.
    asyncHandler(async (_req, res) => {
      try {
        await assertDatabaseReachable();
        ok(res, 'Healthy', {
          status: 'ok',
          database: 'reachable',
          uptime: Math.round(process.uptime()),
        });
      } catch (error) {
        logger.error({ err: error }, 'Health check failed: database unreachable');
        // 503, not 500: the API is up but cannot serve, which is exactly the
        // distinction a container health check needs.
        res.status(503).json({
          success: false,
          message: 'Database unreachable',
          code: 'INTERNAL_ERROR',
        });
      }
    }),
  );

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
