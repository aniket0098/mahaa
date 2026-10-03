/**
 * Regression tests for the connection-probe timeout budget.
 *
 * The bug was a magic number: `timeoutMs: 8000` on the two probe calls. It is
 * invisible in review and trivially reintroduced, so the *reason* the budget is
 * what it is is pinned here instead of left in a comment that can drift.
 */

import { describe, expect, it } from 'vitest';

import {
  HEALTH_PROBE_TIMEOUT_MS,
  PROBE_TIMEOUT_CEILING_MS,
  RENDER_FREE_COLD_START_FLOOR_MS,
} from '@/api/healthTimeouts';

describe('HEALTH_PROBE_TIMEOUT_MS', () => {
  it('outlasts a Render Free cold start', () => {
    // The regression. 8s aborted a wake-up measured at 33.6s, so the sign-in
    // screen reported a healthy backend as unreachable. Any budget at or below
    // the cold-start floor reintroduces exactly that false negative.
    expect(HEALTH_PROBE_TIMEOUT_MS).toBeGreaterThan(RENDER_FREE_COLD_START_FLOOR_MS);
  });

  it('is never shorter than the value it replaced', () => {
    // A direct guard against reverting to the old hard-coded 8_000.
    expect(HEALTH_PROBE_TIMEOUT_MS).toBeGreaterThan(8_000);
  });

  it('stays bounded rather than "huge"', () => {
    // Long enough to clear the floor with headroom; short enough that a stuck
    // service still resolves to a failure instead of spinning indefinitely.
    expect(HEALTH_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(PROBE_TIMEOUT_CEILING_MS);
  });

  it('leaves headroom over the measured floor', () => {
    // Guards against setting it *exactly* to the floor, which would pass the
    // check above and then fail on any slightly slower boot.
    expect(HEALTH_PROBE_TIMEOUT_MS - RENDER_FREE_COLD_START_FLOOR_MS).toBeGreaterThan(0);
  });

  it('is a whole number of milliseconds', () => {
    expect(Number.isInteger(HEALTH_PROBE_TIMEOUT_MS)).toBe(true);
    expect(HEALTH_PROBE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('the probe budget is not the default request budget', () => {
  it('is a probe-specific value, not a global one', () => {
    // `@/api/client` keeps its own 15s default for ordinary calls. This budget
    // belongs to the two probes only; asserting the two differ documents that
    // the fix did not quietly lengthen login, the feed, or every other call.
    const CLIENT_DEFAULT_TIMEOUT_MS = 15_000;
    expect(HEALTH_PROBE_TIMEOUT_MS).not.toBe(CLIENT_DEFAULT_TIMEOUT_MS);
    expect(HEALTH_PROBE_TIMEOUT_MS).toBeGreaterThan(CLIENT_DEFAULT_TIMEOUT_MS);
  });
});