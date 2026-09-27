/**
 * Build-environment configuration tests.
 *
 * The base URL is inlined into the JavaScript bundle at build time, so a cloud
 * build gets exactly one chance to get it right. These tests read the real
 * `eas.json` and the real resolver off disk rather than trusting a comment:
 *
 *  - a production EAS build must carry the production API URL, because `.env`
 *    is git-ignored and therefore never reaches the EAS Build server;
 *  - the development and preview profiles must stay unpinned, so a developer's
 *    build keeps resolving their own API instead of silently hitting production;
 *  - the pinned value may only ever be the public API origin, never a backend
 *    secret.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveApiBaseUrl } from '@/lib/apiBaseUrl';

const EAS_JSON = fileURLToPath(new URL('../../eas.json', import.meta.url));

/** The deployed API. Plain text by design: `EXPO_PUBLIC_*` ships in the bundle. */
const PRODUCTION_API_BASE_URL = 'https://mahajob-api.onrender.com/api/v1';

interface BuildProfile {
  env?: Record<string, string>;
}

function buildProfiles(): Record<string, BuildProfile> {
  const parsed = JSON.parse(readFileSync(EAS_JSON, 'utf8')) as {
    build?: Record<string, BuildProfile>;
  };
  return parsed.build ?? {};
}

describe('eas.json build profiles', () => {
  it('pins the production API base URL for cloud builds', () => {
    expect(buildProfiles().production?.env?.EXPO_PUBLIC_API_BASE_URL).toBe(
      PRODUCTION_API_BASE_URL,
    );
  });

  it('leaves the development and preview profiles unpinned', () => {
    // A pinned URL in either profile would point a developer's build at
    // production, so neither may declare one.
    for (const profile of ['development', 'preview']) {
      expect(buildProfiles()[profile]?.env?.EXPO_PUBLIC_API_BASE_URL, profile).toBeUndefined();
    }
  });

  it('keeps the production profile free of backend secrets', () => {
    // `EXPO_PUBLIC_*` is inlined into the shipped JavaScript and readable by
    // anyone with the app, so it may only ever carry the public API origin.
    const forbidden = /DATABASE_URL|JWT|SECRET|PASSWORD|TOKEN|PRIVATE_KEY/i;
    const env = buildProfiles().production?.env ?? {};
    expect(Object.keys(env)).toEqual(['EXPO_PUBLIC_API_BASE_URL']);
    for (const [key, value] of Object.entries(env)) {
      expect(value, `${key} must not look like a secret`).not.toMatch(forbidden);
    }
  });

  it('resolves to a reachable https host on a real device', () => {
    const resolved = resolveApiBaseUrl(
      buildProfiles().production?.env?.EXPO_PUBLIC_API_BASE_URL,
      'android',
      true, // real hardware, not an emulator
    );
    expect(resolved.baseUrl).toBe(PRODUCTION_API_BASE_URL);
    expect(resolved.source).toBe('configured');
    // A routable public host, so the device-configuration fault cannot trigger.
    expect(resolved.hostKind).toBe('lan');
    expect(resolved.needsDeviceConfiguration).toBe(false);
  });

  it('pins the same URL for iOS, which shares the profile', () => {
    const url = buildProfiles().production?.env?.EXPO_PUBLIC_API_BASE_URL;
    expect(resolveApiBaseUrl(url, 'ios', true).baseUrl).toBe(PRODUCTION_API_BASE_URL);
  });

  it('would fall back to an unreachable default if the profile lost its env', () => {
    // This is the regression the fix prevents: with no value, a production build
    // silently resolves to the emulator alias, which no real device can reach.
    const fallback = resolveApiBaseUrl(undefined, 'android', true);
    expect(fallback.source).toBe('platform-default');
    expect(fallback.needsDeviceConfiguration).toBe(true);
    expect(fallback.baseUrl).not.toBe(PRODUCTION_API_BASE_URL);
  });
});
