/**
 * Regression tests for the preferences "never configured" domain state.
 *
 * The contract under test is narrow and worth stating plainly: exactly one
 * server answer — a 404 carrying the documented `not_found` code from this one
 * read — is a normal empty state. Everything else is still an error, because a
 * fix that swallowed all 404s would quietly turn a real fault into a blank form
 * that looks fine.
 */

import { describe, expect, it } from 'vitest';

import { ApiError, API_ERROR_CODES } from '@/api/errors';
import {
  isPreferencesUnconfigured,
  preferencesLoadBanner,
  storedPreferences,
} from '@/features/onboarding/preferencesState';
import type { PreferencesRead } from '@/types/profile';

const UNCONFIGURED = new ApiError({
  message: 'You have not set your preferences yet.',
  status: 404,
  code: API_ERROR_CODES.notFound,
});

const STORED: PreferencesRead = {
  work_modes: ['remote'],
  employment_types: ['full_time'],
  preferred_locations: ['Pune'],
  salary_min: null,
  salary_max: null,
  currency: 'INR',
  availability_date: null,
  willing_to_relocate: false,
} as PreferencesRead;

describe('isPreferencesUnconfigured', () => {
  it('recognises the documented "not configured yet" answer', () => {
    expect(isPreferencesUnconfigured(UNCONFIGURED)).toBe(true);
  });

  it('is not a blanket 404 handler', () => {
    // A 404 that is not this endpoint's documented answer must stay an error:
    // otherwise a wrong base URL or a moved route reads as "no preferences yet".
    expect(isPreferencesUnconfigured(new ApiError({ message: 'Not found', status: 404 }))).toBe(false);
    expect(
      isPreferencesUnconfigured(
        new ApiError({
          message: 'Not found',
          status: 404,
          code: API_ERROR_CODES.internalError,
        }),
      ),
    ).toBe(false);
  });

  it('leaves every other failure an error', () => {
    for (const status of [0, 401, 403, 409, 422, 500, 502, 503]) {
      expect(isPreferencesUnconfigured(new ApiError({ message: 'x', status }))).toBe(false);
    }
    // Transport-level codes the client raises itself.
    expect(
      isPreferencesUnconfigured(
        new ApiError({ message: 'offline', status: 0, code: API_ERROR_CODES.network }),
      ),
    ).toBe(false);
    expect(
      isPreferencesUnconfigured(
        new ApiError({ message: 'slow', status: 0, code: API_ERROR_CODES.timeout }),
      ),
    ).toBe(false);
    // A malformed body the client refused to accept.
    expect(
      isPreferencesUnconfigured(
        new ApiError({ message: 'bad shape', status: 200, code: API_ERROR_CODES.invalidResponse }),
      ),
    ).toBe(false);
    expect(isPreferencesUnconfigured(new Error('boom'))).toBe(false);
    expect(isPreferencesUnconfigured(null)).toBe(false);
  });
});

describe('preferencesLoadBanner', () => {
  it('shows nothing for an unconfigured account, so the normal form renders', () => {
    // The fix: no red banner and no Retry for the most common state in the
    // product. The caller renders its ordinary empty form whenever this is null.
    expect(preferencesLoadBanner(UNCONFIGURED)).toBeNull();
  });

  it('shows nothing once the error has cleared', () => {
    expect(preferencesLoadBanner(null)).toBeNull();
    expect(preferencesLoadBanner(undefined)).toBeNull();
  });

  it('keeps the server message for a genuine 500', () => {
    const error = new ApiError({ message: 'Internal Server Error', status: 500 });
    expect(preferencesLoadBanner(error)).toBe('Internal Server Error');
  });

  it('keeps a message for network and timeout failures', () => {
    expect(
      preferencesLoadBanner(
        new ApiError({ message: 'The request timed out.', code: API_ERROR_CODES.timeout }),
      ),
    ).toBe('The request timed out.');
    expect(
      preferencesLoadBanner(
        new ApiError({ message: 'Network request failed.', code: API_ERROR_CODES.network }),
      ),
    ).toBe('Network request failed.');
  });

  it('keeps a message for an unauthenticated or forbidden read', () => {
    expect(preferencesLoadBanner(new ApiError({ message: 'Authentication required.', status: 401 }))).toBe(
      'Authentication required.',
    );
    expect(preferencesLoadBanner(new ApiError({ message: 'Not allowed.', status: 403 }))).toBe(
      'Not allowed.',
    );
  });

  it('falls back to its own wording for an error it cannot classify', () => {
    expect(preferencesLoadBanner(new Error('kaboom'))).toMatch(/could not be loaded/i);
  });
});

describe('storedPreferences', () => {
  it('reads an unconfigured account as null so the existing defaults apply', () => {
    expect(storedPreferences(null)).toBeNull();
    expect(storedPreferences(undefined)).toBeNull();
  });

  it('passes a real record straight through', () => {
    expect(storedPreferences(STORED)).toBe(STORED);
  });
});