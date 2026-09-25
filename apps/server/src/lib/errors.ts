import type { ApiErrorBody, ApiErrorCode } from '@enbox/shared';

/** Throw anywhere in a request/socket handler to produce a typed API error. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'validation_error', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You are not allowed to do that') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const blocked = (message = 'This user is blocked') => new HttpError(403, 'blocked', message);
export const notMember = (message = 'You are not a member of this chat') =>
  new HttpError(403, 'not_member', message);
export const limitReached = (message: string) => new HttpError(409, 'limit_reached', message);
export const privacyRestricted = (message = "This user's privacy settings don't allow that") =>
  new HttpError(403, 'privacy_restricted', message);
export const expired = (message: string) => new HttpError(410, 'expired', message);
export const rateLimited = (message = 'Too many requests, slow down') =>
  new HttpError(429, 'rate_limited', message);

/** Normalise any thrown value into an HttpError (unknown errors become 500). */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  return new HttpError(500, 'internal_error', 'Something went wrong');
}
