import type { Response } from 'express';
import type { ApiFailure, ApiSuccess, ErrorCode, PaginationMeta } from '@cadence/shared';

/**
 * The single place response envelopes are built, so every endpoint answers in
 * the same shape and the client can rely on it.
 */

export function ok<T>(res: Response, message: string, data: T, meta?: PaginationMeta): Response {
  const body: ApiSuccess<T> = meta
    ? { success: true, message, data, meta }
    : { success: true, message, data };
  return res.status(200).json(body);
}

export function created<T>(res: Response, message: string, data: T): Response {
  const body: ApiSuccess<T> = { success: true, message, data };
  return res.status(201).json(body);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

export function fail(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  errors?: Record<string, string[]>,
): Response {
  const body: ApiFailure = errors
    ? { success: false, message, code, errors }
    : { success: false, message, code };
  return res.status(status).json(body);
}
