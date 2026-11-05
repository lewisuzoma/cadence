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

  if (isAppError(error)) {
    if (!error.expected) {
      logger.error({ err: error, path: req.originalUrl }, 'Unexpected application error');
    }
    fail(res, error.status, error.code, error.message, error.fieldErrors);
    return;
  }

  if (error instanceof ZodError) {
    fail(res, 400, 'VALIDATION_ERROR', 'Validation failed', fieldErrorsFromZod(error));
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
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
    logger.error({ err: error, code: error.code }, 'Unhandled Prisma error');
    fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    fail(res, 400, 'VALIDATION_ERROR', 'The request body is not valid JSON');
    return;
  }

  // Anything unrecognised is a bug: log it in full, tell the client nothing.
  logger.error({ err: error, path: req.originalUrl }, 'Unhandled error');
  fail(
    res,
    500,
    'INTERNAL_ERROR',
    isProduction ? 'Something went wrong' : String((error as Error)?.message ?? error),
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
