/**
 * Central API error type + code vocabulary.
 *
 * Codes mirror the backend error contract (`apps/api/app/core/errors.py`,
 * `docs/API.md`). Feature modules map these predictably — they never parse raw
 * responses themselves.
 */

import type { ApiErrorDetail, ApiErrorEnvelope } from '@/types/api';

export const API_ERROR_CODES = {
  badRequest: 'bad_request',
  validationError: 'validation_error',
  notAuthenticated: 'not_authenticated',
  invalidCredentials: 'invalid_credentials',
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
  unprocessable: 'unprocessable',
  rateLimited: 'rate_limited',
  serviceUnavailable: 'service_unavailable',
  internalError: 'internal_error',
  // Client-side transport codes (never sent by the server).
  network: 'network_error',
  timeout: 'request_timeout',
  aborted: 'request_aborted',
  invalidResponse: 'invalid_response',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

interface ApiErrorArgs {
  message: string;
  status?: number;
  code?: ApiErrorCode;
  details?: ApiErrorDetail[] | null;
  requestId?: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: ApiErrorDetail[] | null;
  readonly requestId: string | null;

  constructor({
    message,
    status = 0,
    code = API_ERROR_CODES.network,
    details = null,
    requestId = null,
  }: ApiErrorArgs) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isValidation(): boolean {
    return this.status === 422 && this.code === API_ERROR_CODES.validationError;
  }

  /**
   * A conflict the user can act on — most importantly a duplicate signup email.
   *
   * The server sends a message written for the person reading it
   * ("An account already exists with this email. Sign in instead…"), so a screen
   * that knows about conflicts can offer the next step instead of reporting a
   * dead end.
   */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /**
   * True when a *field* carries the conflict, so the message belongs on the input
   * as well as in the banner.
   */
  fieldError(field: string): string | null {
    const match = this.details?.find(
      (detail) => detail.field === field || detail.field?.endsWith(`.${field}`),
    );
    return match?.message ?? null;
  }
}

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { message?: unknown }).message === 'string' &&
    typeof (candidate as { code?: unknown }).code === 'string'
  );
}

/**
 * Field errors keyed by field name, for rendering inline messages next to an
 * input. Mirrors what `ApiError.fieldError` exposes, applied in one pass.
 *
 * FastAPI prefixes a JSON body location with its source (``body.email``,
 * ``body.phone``), while the form knows the field by its own name. The prefix is
 * stripped here — the same rule the web signup screen applies — so a 422 can
 * never end up with a message that no input ever renders.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.details) return {};
  const mapped: Record<string, string> = {};
  for (const detail of error.details) {
    if (!detail.field) continue;
    const field = detail.field.replace(/^body\./, '');
    if (!(field in mapped)) {
      mapped[field] = detail.message;
    }
  }
  return mapped;
}
