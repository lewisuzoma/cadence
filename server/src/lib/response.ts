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

/**
 * `requestId` is appended last so no existing call site has to change; the
 * error handler passes it for 5xx responses only.
 */
export function fail(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  errors?: Record<string, string[]>,
  requestId?: string,
): Response {
  const body: ApiFailure = { success: false, message, code };
  if (errors) body.errors = errors;
  if (requestId) body.requestId = requestId;
  return res.status(status).json(body);
}
