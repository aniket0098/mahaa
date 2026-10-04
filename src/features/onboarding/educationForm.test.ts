/**
 * Tests for the onboarding education form's normalisation — pure, no React.
 *
 * Two things are pinned here.
 *
 * **The date rule that caused a false "did not save".** The form's helper text
 * said "YYYY-MM" and its placeholder was `2026-06`, but the server's schema is
 * typed `date`. Verified against the running API before the fix: `"2024-03"` →
 * 422, `"2026"` → 422, `"2026-06-01"` → 201. The screen was instructing a format
 * it then rejected. These tests hold the widened set.
 *
 * **What must stay rejected.** Widening the accepted *precision* of a date is not
 * the same as accepting nonsense, so the impossible cases are asserted just as
 * firmly as the accepted ones.
 */

import { describe, expect, it } from 'vitest';

import { institutionError, normaliseEndDate } from '@/features/onboarding/educationForm';

describe('1. the formats a person actually types', () => {
  it('accepts a bare year', () => {
    // The most common answer to "when did you graduate?". Previously a 422.
    expect(normaliseEndDate('2026')).toEqual({ kind: 'ok', value: '2026-01-01' });
  });

  it('accepts a year and month — the format the helper text asked for', () => {
    expect(normaliseEndDate('2026-06')).toEqual({ kind: 'ok', value: '2026-06-01' });
  });

  it('accepts a full ISO date unchanged', () => {
    expect(normaliseEndDate('2026-06-15')).toEqual({ kind: 'ok', value: '2026-06-15' });
  });

  it('accepts slashes and dots, because that is what a keypad produces', () => {
    expect(normaliseEndDate('2026/06')).toEqual({ kind: 'ok', value: '2026-06-01' });
    expect(normaliseEndDate('2026.06.15')).toEqual({ kind: 'ok', value: '2026-06-15' });
  });

  it('tolerates surrounding whitespace', () => {
    expect(normaliseEndDate('  2026-06  ')).toEqual({ kind: 'ok', value: '2026-06-01' });
  });

  it('reads a two-digit year as this century', () => {
    // Somebody typing "26" means 2026, not 26 AD.
    expect(normaliseEndDate('26')).toEqual({ kind: 'ok', value: '2026-01-01' });
  });

  it('treats an empty field as "not supplied", not as an error', () => {
    expect(normaliseEndDate('')).toEqual({ kind: 'empty' });
    expect(normaliseEndDate('   ')).toEqual({ kind: 'empty' });
  });
});

describe('2. genuine nonsense is still rejected', () => {
  it('rejects free text rather than guessing at a date', () => {
    // Widening precision must not become guessing at meaning.
    const result = normaliseEndDate('next summer');
    expect(result.kind).toBe('invalid');
  });

  it('rejects a month that does not exist', () => {
    expect(normaliseEndDate('2026-13').kind).toBe('invalid');
  });

  it('rejects 30 February rather than rolling it into March', () => {
    // The calendar is the authority; a silent rollover would store a date the
    // person never wrote.
    expect(normaliseEndDate('2026-02-30').kind).toBe('invalid');
  });

  it('accepts 29 February in a leap year, and only there', () => {
    expect(normaliseEndDate('2024-02-29')).toEqual({ kind: 'ok', value: '2024-02-29' });
    expect(normaliseEndDate('2026-02-29').kind).toBe('invalid');
  });

  it('rejects a day of zero', () => {
    expect(normaliseEndDate('2026-06-00').kind).toBe('invalid');
  });

  it('says what shape it wanted', () => {
    const result = normaliseEndDate('sometime in 2026');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.message).toContain('2026');
    }
  });
});

describe('3. the institution field', () => {
  it('names the field when it is empty', () => {
    // Phase 4: an empty required field is a field error, never "that did not
    // save", and the message says which field.
    expect(institutionError('')).toBe('Please enter your college name.');
  });

  it('treats whitespace as empty', () => {
    // The server accepts `"   "` today because `min_length=1` counts characters,
    // and such a row satisfies the step's gate while telling a recruiter nothing.
    expect(institutionError('     ')).toBe('Please enter your college name.');
  });

  it('accepts ordinary names, including punctuation and Unicode', () => {
    // The "more freedom" requirement: normal real-world values are not garbage.
    const names = [
      'ABC College of Engineering',
      'Government College of Engineering, Nagpur',
      "St. Xavier's College - Mumbai",
      'Smt. XYZ College',
      'MIT Pune',
      'Réseau Polytechnique',
      'शासकीय अभियांत्रिकी महाविद्यालय',
      'B.Tech',
    ];
    for (const name of names) {
      expect(institutionError(name), name).toBeNull();
    }
  });
});