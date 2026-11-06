import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Gives every request an id, echoed back as `X-Request-Id` and attached to each
 * log line for it.
 *
 * Without this a 500 in the browser is unfalsifiable: production hides the real
 * message (errorHandler.ts), so a user can report only 'it failed', and there
 * is nothing to match their attempt against in the server log. With it the
 * failing response carries a reference they can quote, and
 * `docker compose logs server | grep <id>` finds the stack trace.
 *
 * The field is `requestId`, not `id`: pino-http already declares `id` on
 * IncomingMessage, and redeclaring it with a narrower type conflicts.
 */

/** Conservative: an id goes into logs and response headers, so no surprises. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  // An inbound id is honoured so a trace can span a load balancer or a
  // caller's own logs, but only when it is well formed -- never trusted enough
  // to put arbitrary client bytes into a header or a log field.
  const inbound = req.get('x-request-id');
  req.requestId = inbound && SAFE_ID.test(inbound) ? inbound : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
