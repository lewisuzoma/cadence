import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import { logger } from '../lib/logger.js';

/**
 * Serving the built SPA from the API process.
 *
 * Two deployment shapes exist, and this file is what lets one codebase cover
 * both without either knowing about the other:
 *
 *  - **Docker Compose**: nginx serves `client/dist` and proxies `/api` to this
 *    server (client/nginx.conf). The server image contains no client build at
 *    all, so `mountClient` finds no directory and does nothing. That path is
 *    untouched by this file.
 *
 *  - **A single-process host** (Laravel Cloud, Render, a bare VM): one process
 *    gets one port, so Express has to serve the SPA itself. The build output
 *    sits next to the server's, and this mounts it.
 *
 * Detecting the directory rather than reading a flag is deliberate: there is
 * no configuration to get wrong, and the behaviour follows from what was
 * actually deployed. `CLIENT_DIST` overrides the location when a host puts the
 * build somewhere else.
 *
 * The SPA and the API stay on one origin this way, which is what keeps the
 * auth cookies first-party — the same property nginx gives the Compose stack.
 */

/** A year, for the hashed files Vite fingerprints. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** A day, for `/media` and `/captions`: public, unhashed, and rarely changed. */
const ONE_DAY = 'public, max-age=86400';

/** A build is "there" only if the shell is: half a folder is not a client. */
const isClientDist = (path: string): boolean => existsSync(join(path, 'index.html'));

/**
 * Where the client build is, or null when this process was not deployed with
 * one.
 *
 * The search walks up from this module rather than counting `..` segments or
 * trusting `process.cwd()`. Both of those have a way of being wrong: the
 * compiled file's depth depends on where it sits under `src/`, and the working
 * directory depends on how the host invokes the start command. Walking up for
 * `client/dist` finds the repository root from anywhere inside the build.
 */
export function resolveClientDist(): string | null {
  const configured = process.env.CLIENT_DIST;
  if (configured) {
    const path = resolve(configured);
    return isClientDist(path) ? path : null;
  }

  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'client', 'dist');
    if (isClientDist(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) break; // reached the filesystem root
    directory = parent;
  }
  return null;
}

/**
 * The SPA's Content-Security-Policy.
 *
 * Quoted from client/nginx.conf so the two deployments defend the same way.
 * It is mounted on the static files and the SPA fallback only, never on the
 * API: `/api/docs` is Swagger UI, which needs the inline styles this forbids,
 * and that is why the app-wide helmet still runs with `contentSecurityPolicy`
 * switched off.
 */
const clientCsp = helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    mediaSrc: ["'self'", 'https:'],
    fontSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    scriptSrc: ["'self'"],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
  },
});

/**
 * Mounts the SPA when a build is present, and reports whether it did.
 *
 * Call this after the API routes and before the 404 handler: anything under
 * `/api` has already been answered by then, so the fallback below cannot
 * swallow an API route, and an unknown `/api/...` path still gets the JSON 404
 * a client expects instead of a page of HTML.
 */
export function mountClient(app: Express): boolean {
  const clientDist = resolveClientDist();
  if (!clientDist) {
    logger.debug('No client build found next to the server — serving the API only');
    return false;
  }

  app.use(
    clientCsp,
    express.static(clientDist, {
      // index.html is served by the fallback below, which sets its own
      // no-cache header; letting static serve it too would cache the one file
      // that must never be stale.
      index: false,
      // Range requests come free with express.static, which is what lets the
      // lesson player seek within the sample video.
      setHeaders: (res, filePath) => {
        const url = filePath.replace(clientDist, '').replace(/\\/g, '/');
        res.setHeader('Cache-Control', url.startsWith('/assets/') ? IMMUTABLE : ONE_DAY);
      },
    }),
  );

  /*
   * The SPA fallback: a deep link such as /courses/x/lessons/y is a client
   * route, so the shell is returned and React Router takes it from there.
   *
   * Narrow on purpose. Only GET and HEAD — a POST to a path that does not
   * exist is a mistake worth reporting as one, not something to answer with a
   * page. And never under /api, so a missing endpoint stays a JSON 404.
   */
  app.use(clientCsp, (req: Request, res: Response, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();

    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(join(clientDist, 'index.html'), (error) => {
      // A failure here is the deployment being broken, not the request being
      // wrong, so it goes to the error handler rather than becoming a 404.
      if (error) next(error);
    });
  });

  logger.info({ clientDist }, 'Serving the client build from this process');
  return true;
}
