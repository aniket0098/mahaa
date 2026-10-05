/**
 * `formatCount` — the only place a number is shortened for display.
 *
 * **Abbreviation is a lossy operation, so the boundaries are the test.** A count
 * that rounds at the wrong point either loses information the reader can actually
 * see ("999" becoming "1K") or overflows the card ("1200 likes" on one line). Both
 * failure modes are invisible until somebody publishes a popular post, which is
 * exactly the kind of bug that ships.
 */

import { describe, expect, it } from 'vitest';

import { formatCount } from '@/features/feed/feedModel';

describe('formatCount', () => {
  it('prints small counts exactly, because abbreviating them would lose digits', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1)).toBe('1');
    expect(formatCount(12)).toBe('12');
    // The boundary case: 999 is still readable in full, so it must not become "1K".
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates from exactly one thousand', () => {
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(1500)).toBe('1.5K');
    expect(formatCount(12_400)).toBe('12K');
  });

  it('keeps one decimal below ten thousand and drops it above', () => {
    // 1.2K says something 1K does not; 12.4K does not, because the card would
    // reflow and the digit is noise at that magnitude.
    expect(formatCount(1234)).toBe('1.2K');
    expect(formatCount(12_345)).toBe('12K');
  });

  it('abbreviates millions the same way', () => {
    expect(formatCount(1_000_000)).toBe('1M');
    expect(formatCount(1_250_000)).toBe('1.3M');
    expect(formatCount(12_000_000)).toBe('12M');
  });

  it('never produces a trailing ".0"', () => {
    // "1.0K" reads like a bug in a count.
    expect(formatCount(2000)).toBe('2K');
    expect(formatCount(2_000_000)).toBe('2M');
  });

  it('degrades safely for values a server would never send', () => {
    // Defensive, not decorative: a NaN from a divided-by-zero upstream would
    // otherwise render the literal string "NaN" in the middle of a post.
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(-1)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
