import type { ErrorCode, PublishChecklist } from '@cadence/shared';

/**
 * One error hierarchy for the whole server.  Services throw these; the error
 * handler is the only place that turns them into HTTP responses, so a service
 * never needs to know about `res`.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;
  /** True for errors we expect (validation, 404, ...) and do not alert on. */
  readonly expected: boolean;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options?: { fieldErrors?: Record<string, string[]>; expected?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    if (options?.fieldErrors) this.fieldErrors = options.fieldErrors;
    this.expected = options?.expected ?? true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', fieldErrors?: Record<string, string[]>) {
    super(400, 'VALIDATION_ERROR', message, fieldErrors ? { fieldErrors } : undefined);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

/** Login failures: deliberately generic so they cannot enumerate accounts. */
export class InvalidCredentialsError extends AppError {
  constructor(message = 'Invalid email or password') {
    super(401, 'INVALID_CREDENTIALS', message);
  }
}

export class AccountInactiveError extends AppError {
  constructor(message = 'This account has been deactivated') {
    super(403, 'ACCOUNT_INACTIVE', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super(403, 'FORBIDDEN', message);
  }
}

export class CsrfError extends AppError {
  constructor(message = 'Invalid or missing CSRF token') {
    super(403, 'CSRF_ERROR', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

/** 422: the request was well formed but breaks a business rule. */
export class UnprocessableError extends AppError {
  constructor(message: string) {
    super(422, 'UNPROCESSABLE', message);
  }
}

/**
 * Publishing was refused because the course fails its checklist.
 *
 * Carries the whole checklist rather than the first failure: the editor
 * renders it as a list of ticks and crosses, so an author sees everything
 * left to do at once instead of discovering it one 422 at a time.
 */
export class PublishBlockedError extends AppError {
  readonly checklist: PublishChecklist;

  constructor(checklist: PublishChecklist) {
    const failed = checklist.checks.filter((check) => !check.passed);
    super(
      422,
      'UNPROCESSABLE',
      failed.length === 1
        ? `This course cannot be published yet: ${failed[0]!.label.toLowerCase()}.`
        : `This course cannot be published yet: ${failed.length} checks still to pass.`,
      {
        // Also surfaced as field errors so a plain form renderer shows
        // something useful without knowing about checklists.
        fieldErrors: Object.fromEntries(
          failed.map((check) => [check.id, [check.detail ?? check.label]]),
        ),
      },
    );
    this.checklist = checklist;
  }
}

export class InternalError extends AppError {
  constructor(message = 'Something went wrong', cause?: unknown) {
    super(500, 'INTERNAL_ERROR', message, { expected: false, cause });
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
