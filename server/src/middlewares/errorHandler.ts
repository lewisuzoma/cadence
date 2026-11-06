import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';
import { AppError, NotFoundError, isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { fail } from '../lib/response.js';

/** 404 for any route that did not match. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl}`));
}

function fieldErrorsFromZod(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

/**
 * The single exit point for every error.  Services and controllers throw;
 * this decides the status code, the stable error code and what the client is
 * allowed to see.  Nothing internal ever reaches a 500 response body.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) return next(error);

  /*
   * Carried into every 5xx body and every error log line for this request.
   * A 5xx body is deliberately vague about what broke, so without a shared
   * reference a user's report cannot be matched to the trace that explains it.
   * 4xx responses keep their user-facing copy unchanged -- the id is still on
   * the X-Request-Id header for those.
   */
  const ref = req.requestId;

  if (isAppError(error)) {
    if (!error.expected) {
      logger.error(
        { err: error, path: req.originalUrl, requestId: ref },
        'Unexpected application error',
      );
    }
    fail(
      res,
      error.status,
      error.code,
      error.message,
      error.fieldErrors,
      error.status >= 500 ? ref : undefined,
    );
    return;
  }

  if (error instanceof ZodError) {
    fail(res, 400, 'VALIDATION_ERROR', 'Validation failed', fieldErrorsFromZod(error));
    return;
  }

  /*
   * The database is unreachable, or the query engine died.  Neither is a bug in
   * this code and neither is a 500: `server.ts` only proves the connection at
   * boot, so a database that goes away later surfaces here.  503 matches what
   * /api/v1/health already reports for the same condition, and tells the client
   * the request is worth retrying -- ApiError.isClientError treats it as such.
   */
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    logger.error({ err: error, path: req.originalUrl, requestId: ref }, 'Database unavailable');
    fail(res, 503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable', undefined, ref);
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    /*
     * Every P1xxx code is about the connection rather than the query: P1001
     * cannot reach the server, P1002 timed out, P1017 the server closed the
     * connection, P1000/P1010 credentials rejected.  None of them is a bug in
     * the request, so none is a 500 -- the API is up and the database is not.
     *
     * `PrismaClientInitializationError` below covers the same condition when
     * it is hit on the very first connection; this covers a pool that worked
     * and then stopped, which is what a database restart looks like.
     */
    if (error.code.startsWith('P1')) {
      logger.error(
        { err: error, code: error.code, path: req.originalUrl, requestId: ref },
        'Database unavailable',
      );
      fail(
        res,
        503,
        'SERVICE_UNAVAILABLE',
        'The service is temporarily unavailable',
        undefined,
        ref,
      );
      return;
    }
    // P2002 unique violation, P2025 record not found, P2003 FK violation.
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
      fail(res, 409, 'CONFLICT', `That ${target} is already in use`);
      return;
    }
    if (error.code === 'P2025') {
      fail(res, 404, 'NOT_FOUND', 'Resource not found');
      return;
    }
    if (error.code === 'P2003') {
      fail(res, 409, 'CONFLICT', 'That record is still referenced by other data');
      return;
    }
    if (error.code === 'P2021' || error.code === 'P2022') {
      // A table or column the code expects is absent.  Nearly always a
      // database the migrations were never applied to, so say so in the log
      // instead of leaving it in the catch-all with everything else.
      logger.error(
        { err: error, code: error.code, meta: error.meta, path: req.originalUrl, requestId: ref },
        'Schema mismatch - migrations may not be applied to this database',
      );
      fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong', undefined, ref);
      return;
    }
    logger.error({ err: error, code: error.code, requestId: ref }, 'Unhandled Prisma error');
    fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong', undefined, ref);
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    fail(res, 400, 'VALIDATION_ERROR', 'The request body is not valid JSON');
    return;
  }

  // Anything unrecognised is a bug: log it in full, tell the client nothing.
  logger.error({ err: error, path: req.originalUrl, requestId: ref }, 'Unhandled error');
  fail(
    res,
    500,
    'INTERNAL_ERROR',
    isProduction ? 'Something went wrong' : String((error as Error)?.message ?? error),
    undefined,
    ref,
  );
}

/**
 * Wraps an async handler so a rejected promise reaches the error handler.
 * Express 4 does not do this itself.
 */
export function asyncHandler<T extends (req: Request, res: Response) => Promise<unknown>>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

export { AppError };
