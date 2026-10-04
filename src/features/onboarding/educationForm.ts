/**
 * How the onboarding education form turns what somebody typed into the body
 * `POST /profile/education` accepts — pure, so it is unit testable in Node.
 *
 * **Why this exists.** The form's helper text said "YYYY-MM" and its placeholder
 * was `2026-06`, but the server's schema is typed `date`, so Pydantic demanded a
 * full `YYYY-MM-DD`. Verified against the running API before the fix:
 * `"2024-03"` → **422**, `"2026"` → **422**, `"2026-06-01"` → 201. In other words
 * the screen told people to type something and then rejected it, which surfaced
 * as "That did not save" with no field named.
 *
 * So the normalisation happens here, on the client, and is deliberately
 * *narrower* than the server's: it accepts the shapes a person plausibly types
 * for a graduation date and passes anything else through untouched for the
 * server to judge. It never invents a date it cannot read, and it never guesses
 * a day other than the first of a stated period.
 *
 * **What is deliberately not loosened here:** an empty required institution, an
 * impossible date like `2026-13`, and an end date on a "currently studying"
 * entry. Those remain real errors, reported against the field that caused them.
 */

/** The two-digit years this expands, so "26" is read as 2026, not 26 AD. */
const CENTURY = 2000;

export type EndDateResult =
  | { kind: 'empty' }
  | { kind: 'ok'; value: string }
  | { kind: 'invalid'; message: string };

/**
 * Normalise the graduation year / end date field.
 *
 * A missing day or month becomes the first of the period (`2026` → `2026-01-01`),
 * which keeps the stored value a real ordered date so the server's
 * `end_date >= start_date` rule still means something. Two-digit years are
 * expanded into this century, which is what somebody typing "26" means.
 *
 * A value that is not a date at all is reported as `invalid` with a message that
 * names the accepted shapes — an inline field error, never a silent drop and
 * never a banner that says "that did not save".
 */
export function normaliseEndDate(raw: string): EndDateResult {
  const value = raw.trim().replace(/[/.]/g, '-');
  if (value === '') return { kind: 'empty' };

  /*
   * Split on the separator rather than matching one fixed regex, because the
   * accepted shapes are "how precise is this date", not "which literal string is
   * it". A year alone, a year and a month, a full day, and a two-digit year all
   * reduce to the same three numbers.
   */
  const parts = value.split('-');
  if (parts.length > 3) {
    return { kind: 'invalid', message: 'Use a year or month, like 2026 or 2026-06.' };
  }
  if (!parts.every((part) => /^\d+$/.test(part))) {
    // Not numbers at all — "next summer" must not be guessed at.
    return { kind: 'invalid', message: 'Use a year or month, like 2026 or 2026-06.' };
  }

  const digits = parts.map(Number);
  const [rawYear, rawMonth, rawDay] = digits;
  // A one- or two-digit year is this century. Someone who finished school in
  // 1964 is not what this field is for, and short input is ambiguous anyway.
  const year = rawYear < 100 ? CENTURY + rawYear : rawYear;
  const month = rawMonth ?? 1;
  const day = rawDay ?? 1;

  if (year < 1) {
    return { kind: 'invalid', message: 'Use a year or month, like 2026 or 2026-06.' };
  }
  // Checked here as well as on the server so the person finds out at the field
  // rather than from a 422 whose message names a date they thought was fine.
  // The calendar is the authority: 30 February is rejected, not rolled over.
  if (month < 1 || month > 12) {
    return { kind: 'invalid', message: 'That month does not exist. Use 1 to 12.' };
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return { kind: 'invalid', message: 'That day does not exist in that month.' };
  }

  const pad = (part: number) => String(part).padStart(2, '0');
  return {
    kind: 'ok',
    value: `${year}-${pad(month)}-${pad(day)}`,
  };
}

/** Days in a month, leap years included. Kept local to avoid a Date round trip. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Whether a value is worth sending as an institution at all.
 *
 * Whitespace is not an institution. The server accepts `"   "` today because
 * `min_length=1` counts characters, and a row whose only content is spaces is a
 * row that satisfies the step's gate while telling a recruiter nothing — so the
 * form refuses it up front with a message that names the field.
 */
export function institutionError(raw: string): string | null {
  return raw.trim().length === 0 ? 'Please enter your college name.' : null;
}