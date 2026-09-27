/**
 * Password requirements for account creation — the single client-side source of
 * truth, kept in parity with the server rules in
 * `apps/api/app/schemas/auth.py` (min 8, max 128, at least one letter, at
 * least one digit).
 *
 * The server remains authoritative; this module only powers calm UX feedback
 * (no invented rules, no shouting).
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRuleKey = 'length' | 'letter' | 'number';

export interface PasswordRule {
  key: PasswordRuleKey;
  label: string;
}

export const passwordRules: readonly PasswordRule[] = [
  { key: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters` },
  { key: 'letter', label: 'Includes a letter' },
  { key: 'number', label: 'Includes a number' },
] as const;

export type PasswordRuleState = Record<PasswordRuleKey, boolean>;

/**
 * JavaScript has no `\p{L}`; Unicode property escapes are supported in modern
 * Hermes/JSC, so the same Unicode-aware check the web app uses is available
 * here. `\p{L}` matches what Python's `str.isalpha()` matches and `\p{Nd}` is a
 * strict subset of `str.isdigit()`, so the checklist can never promise a
 * password the server would reject.
 */
export function evaluatePassword(value: string): PasswordRuleState {
  return {
    length: value.length >= PASSWORD_MIN_LENGTH,
    letter: /\p{L}/u.test(value),
    number: /\p{Nd}/u.test(value),
  };
}

export interface PasswordStrength {
  /** How many of the server rules are currently satisfied (0-3). */
  met: number;
  allMet: boolean;
  label: 'Getting there' | 'Almost there' | 'Strong password';
}

/** Calm, non-alarming strength feedback; `null` while the field is empty. */
export function passwordStrength(value: string): PasswordStrength | null {
  if (!value) return null;
  const state = evaluatePassword(value);
  const met = Number(state.length) + Number(state.letter) + Number(state.number);
  return {
    met,
    allMet: met === passwordRules.length,
    label:
      met === passwordRules.length
        ? 'Strong password'
        : met === passwordRules.length - 1
          ? 'Almost there'
          : 'Getting there',
  };
}
