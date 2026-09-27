import { describe, expect, it } from 'vitest';

import {
  evaluatePassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordRules,
  passwordStrength,
} from '@/lib/passwordRules';

describe('password rules (parity with apps/api/app/schemas/auth.py)', () => {
  it('declares exactly the three server rules', () => {
    expect(passwordRules.map((rule) => rule.key)).toEqual(['length', 'letter', 'number']);
  });

  it('requires at least 8 characters', () => {
    expect(evaluatePassword('abc1234').length).toBe(false);
    expect(evaluatePassword('abc12345').length).toBe(true);
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it('requires a letter, including non-ASCII letters', () => {
    expect(evaluatePassword('12345678').letter).toBe(false);
    expect(evaluatePassword('महा1234').letter).toBe(true);
  });

  it('requires a digit', () => {
    expect(evaluatePassword('abcdefgh').number).toBe(false);
    expect(evaluatePassword('abcdefg1').number).toBe(true);
  });

  it('accepts a password the server would accept', () => {
    const state = evaluatePassword('maha2024');
    expect(state).toEqual({ length: true, letter: true, number: true });
  });
});

describe('passwordStrength', () => {
  it('returns null for an empty field so the UI stays calm', () => {
    expect(passwordStrength('')).toBeNull();
  });

  it('reports progress and never promises a password the server would reject', () => {
    expect(passwordStrength('abc')?.label).toBe('Getting there');
    expect(passwordStrength('abcdef1')?.label).toBe('Almost there');
    expect(passwordStrength('maha2024')?.allMet).toBe(true);
  });
});
