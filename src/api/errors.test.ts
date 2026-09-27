import { describe, expect, it } from 'vitest';

import { API_ERROR_CODES, ApiError, fieldErrors, isApiErrorEnvelope } from '@/api/errors';

describe('isApiErrorEnvelope', () => {
  it('accepts the backend error envelope', () => {
    expect(
      isApiErrorEnvelope({ error: { code: 'not_authenticated', message: 'Not authenticated.' } }),
    ).toBe(true);
  });

  it('rejects anything that is not the envelope', () => {
    expect(isApiErrorEnvelope(null)).toBe(false);
    expect(isApiErrorEnvelope({})).toBe(false);
    expect(isApiErrorEnvelope({ error: { code: 'x' } })).toBe(false);
    expect(isApiErrorEnvelope({ error: { message: 'x' } })).toBe(false);
    expect(isApiErrorEnvelope('boom')).toBe(false);
  });
});

describe('ApiError', () => {
  it('classifies status codes the way the feature code expects', () => {
    expect(new ApiError({ message: 'x', status: 401 }).isUnauthenticated).toBe(true);
    expect(new ApiError({ message: 'x', status: 403 }).isForbidden).toBe(true);
    expect(
      new ApiError({ message: 'x', status: 422, code: API_ERROR_CODES.validationError })
        .isValidation,
    ).toBe(true);
    expect(new ApiError({ message: 'x', status: 422, code: API_ERROR_CODES.badRequest })
      .isValidation).toBe(false);
  });

  it('finds a field message by exact name or dotted path', () => {
    const error = new ApiError({
      message: 'Validation failed',
      status: 422,
      code: API_ERROR_CODES.validationError,
      details: [{ field: 'body.password', message: 'Password must include a number.' }],
    });

    expect(error.fieldError('password')).toBe('Password must include a number.');
    expect(error.fieldError('email')).toBeNull();
  });

  it('maps details to a field map for inline rendering', () => {
    const error = new ApiError({
      message: 'Validation failed',
      status: 422,
      code: API_ERROR_CODES.validationError,
      details: [
        { field: 'body.email', message: 'Enter a valid email address.' },
        { field: 'body.name', message: 'Too short.' },
      ],
    });

    // FastAPI prefixes body locations (`body.email`); the form looks the field
    // up by its own name, so the prefix must not survive into the map.
    expect(fieldErrors(error)).toEqual({
      email: 'Enter a valid email address.',
      name: 'Too short.',
    });
  });

  it('keeps a plain field name (the 409 duplicate detail) unchanged', () => {
    const error = new ApiError({
      message: 'An account already exists with this email.',
      status: 409,
      code: API_ERROR_CODES.conflict,
      details: [{ field: 'email', message: 'This email is already registered.' }],
    });

    expect(fieldErrors(error)).toEqual({ email: 'This email is already registered.' });
  });

  it('keeps the first message when a field appears twice', () => {
    const error = new ApiError({
      message: 'Validation failed',
      details: [
        { field: 'email', message: 'First.' },
        { field: 'email', message: 'Second.' },
      ],
    });

    expect(fieldErrors(error)['email']).toBe('First.');
  });

  it('returns an empty map for a non-ApiError', () => {
    expect(fieldErrors(new Error('boom'))).toEqual({});
  });
});

describe('ApiError.isConflict', () => {
  it('recognises the duplicate-signup 409 the server returns', () => {
    // apps/api/app/services/identity_service.py raises 409 CONFLICT with a
    // message written for the person reading it.
    const error = new ApiError({
      message: 'An account already exists with this email. Sign in instead, or use a different email.',
      status: 409,
      code: API_ERROR_CODES.conflict,
      details: [{ field: 'email', message: 'This email is already registered.' }],
    });
    expect(error.isConflict).toBe(true);
    expect(error.fieldError('email')).toBe('This email is already registered.');
  });

  it('does not confuse a 409 with a 401 or a 422', () => {
    // A 401 must never be treated as "just try signing in instead" — that would
    // hide a session problem behind a duplicate-account message.
    expect(new ApiError({ message: 'x', status: 401 }).isConflict).toBe(false);
    expect(
      new ApiError({ message: 'x', status: 422, code: API_ERROR_CODES.validationError })
        .isConflict,
    ).toBe(false);
  });
});
