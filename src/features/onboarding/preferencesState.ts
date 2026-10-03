/**
 * How the client models "this account has never set its preferences".
 *
 * `GET /profile/preferences` answers **404** with "You have not set your
 * preferences yet." for an account that has never configured any. That is a
 * deliberate domain answer from the server, not a malfunction: the endpoint
 * exists to be read *before* a replace-semantics `PUT`, so it has to
 * distinguish "never configured" (send the empty form, do not erase anything)
 * from "configured with nothing in it" (send the stored, genuinely empty
 * lists). Returning an empty object would collapse those two into one and let
 * an unrelated edit wipe a real preference list.
 *
 * The bug this module exists to fix is treating that 404 as a transport
 * failure. A brand-new candidate opening this required onboarding step was
 * shown a red "Your saved preferences did not load" banner with a Retry button
 * that could only ever 404 again — a scary error for the single most common
 * state in the whole product, on a step they must complete to proceed.
 *
 * The classification is narrow on purpose. It requires the documented status
 * **and** the documented error code, and it is only ever applied to this one
 * endpoint's read. A 404 from anywhere else, a 404 with an unexpected code, and
 * every other failure keep their existing error-and-retry behaviour, because
 * swallowing those would turn a real fault into a silently empty form.
 */

import { ApiError, API_ERROR_CODES } from '@/api/errors';
import type { PreferencesRead } from '@/types/profile';

/** The status the server uses for "you have not set your preferences yet". */
export const PREFERENCES_UNCONFIGURED_STATUS = 404;

/**
 * True only for the one documented, domain-level "not configured yet" answer.
 *
 * Not "any 404" and not "any error": see the module note above.
 */
export function isPreferencesUnconfigured(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === PREFERENCES_UNCONFIGURED_STATUS &&
    error.code === API_ERROR_CODES.notFound
  );
}

/**
 * The message for the load banner, or `null` when there is nothing to report.
 *
 * `null` means *render the normal empty form* — which is exactly what the
 * unconfigured 404 should produce, and also what a successful read produces
 * once the error has cleared. Returning the server's own text for genuine
 * failures keeps the existing wording and the existing Retry action intact.
 */
export function preferencesLoadBanner(error: unknown): string | null {
  if (!error) return null;
  if (isPreferencesUnconfigured(error)) return null;
  if (error instanceof ApiError) return error.message;
  return 'Your saved preferences could not be loaded. Check your connection and try again.';
}

/**
 * The stored preferences, or `null` for an account that has never set any.
 *
 * Keeping this in one place is what lets the rest of the screen keep writing
 * `saved?.field ?? fallback`: every existing default (the `null` salary band,
 * the server's `INR`, `willing_to_relocate: false`) was already written against
 * an absent record, so a first-time account and an empty one take the same path
 * without inventing a value.
 */
export function storedPreferences(data: PreferencesRead | null | undefined): PreferencesRead | null {
  return data ?? null;
}