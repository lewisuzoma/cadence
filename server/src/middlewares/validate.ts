import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ValidationError } from '../lib/errors.js';

/**
 * Zod validation for body, query and params.  Parsed output replaces the raw
 * input, so handlers downstream get coerced, defaulted, typed values and can
 * never accidentally read an unvalidated field.
 */

type Schemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

function toFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query;
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('Validation failed', toFieldErrors(error)));
        return;
      }
      next(error);
    }
  };
}

/** Typed accessors, so controllers do not need casts. */
export const body = <T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> =>
  req.body as z.infer<T>;
export const query = <T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> =>
  req.query as unknown as z.infer<T>;
