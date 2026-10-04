/**
 * Avatar layout — the one declaration that decides whether an avatar has a size.
 *
 * **Structural, and the reason is specific.** `Avatar` imports `react-native`, so
 * this Node-only runner cannot render it. But its root style once said `flex: 0`,
 * which the two engines read completely differently: Yoga takes it as "neither
 * grow nor shrink", while react-native-web hands the shorthand to CSS, where
 * `flex: 0` is `flex: 0 1 0%`. The explicit `height` then lost to
 * `flex-basis: 0%` and every avatar in the browser collapsed to zero height — the
 * profile header rendered its circle as a squashed pill with the edit badge
 * crammed into it. Nothing in the JS test suite noticed, because the numbers are
 * identical on the platform Yoga runs.
 *
 * So this asserts the *spelling*, which is what differs between the platforms.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./Avatar.tsx', import.meta.url)), 'utf8');
// The declaration, not the prose around it: this file explains the shorthand in a
// long comment, and a comment mentioning `flex: 0` is not the bug.
const baseStyle = source
  .slice(source.indexOf('base: {'), source.indexOf('circle: {'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('the avatar root box', () => {
  it('never uses the `flex` shorthand', () => {
    // `flex: 0` is `0 1 0%` in CSS, which beats the component's own `height`.
    expect(baseStyle).not.toMatch(/\bflex:\s*0\b/);
  });

  it('spells out grow, shrink and basis so both engines agree', () => {
    expect(baseStyle).toContain('flexGrow: 0');
    expect(baseStyle).toContain('flexShrink: 0');
    expect(baseStyle).toContain("flexBasis: 'auto'");
  });

  it('still clips its corners and centres its contents', () => {
    expect(baseStyle).toContain('overflow:');
    expect(baseStyle).toContain('alignItems:');
    expect(baseStyle).toContain('justifyContent:');
  });
});