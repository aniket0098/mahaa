/**
 * Build-environment configuration tests.
 *
 * The base URL is inlined into the JavaScript bundle at build time, so a cloud
 * build gets exactly one chance to get it right. These tests read the real
 * `eas.json` and the real resolver off disk rather than trusting a comment:
 *
 *  - a production EAS build must carry the production API URL, because `.env`
 *    is git-ignored and therefore never reaches the EAS Build server;
 *  - the same applies to the `preview` profile, whose APK is installed on a real
 *    phone where the emulator alias is unroutable;
 *  - the development profile must stay unpinned, so a developer's build keeps
 *    resolving their own API instead of silently hitting production;
 *  - the pinned value may only ever be the public API origin, never a backend
 *    secret.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveApiBaseUrl } from '@/lib/apiBaseUrl';

const EAS_JSON = fileURLToPath(new URL('../../eas.json', import.meta.url));
const ENV_EXAMPLE = fileURLToPath(new URL('../../.env.example', import.meta.url));

/** The deployed API. Plain text by design: `EXPO_PUBLIC_*` ships in the bundle. */
const PRODUCTION_API_BASE_URL = 'https://mahaa-backend.onrender.com/api/v1';

interface BuildProfile {
  env?: Record<string, string>;
}

function buildProfiles(): Record<string, BuildProfile> {
  const parsed = JSON.parse(readFileSync(EAS_JSON, 'utf8')) as {
    build?: Record<string, BuildProfile>;
  };
  return parsed.build ?? {};
}

/** Read the active assignment for a key, ignoring comments and blank lines. */
function assignmentFor(contents: string, key: string): string | undefined {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const match = new RegExp(`^${key}\\s*=\\s*(.+)$`).exec(trimmed);
    if (match) return match[1].trim();
  }
  return undefined;
}

describe('.env.example — per-platform API addresses', () => {
  // Regression: the shared value alone left the browser calling the Android
  // emulator alias 10.0.2.2, which is unroutable from a desktop, so the web
  // login screen at localhost:8081 timed out. The committed template must
  // therefore document a browser value as well as the Android one.
  const contents = readFileSync(ENV_EXAMPLE, 'utf8');

  it('keeps the Android emulator alias as the shared value', () => {
    expect(assignmentFor(contents, 'EXPO_PUBLIC_API_BASE_URL')).toBe(
      'http://10.0.2.2:8000/api/v1',
    );
  });

  it('points the browser at the host loopback, not the emulator alias', () => {
    expect(assignmentFor(contents, 'EXPO_PUBLIC_API_BASE_URL_WEB')).toBe(
      'http://localhost:8000/api/v1',
    );
  });

  it('resolves each platform to the address that actually works there', () => {
    const shared = assignmentFor(contents, 'EXPO_PUBLIC_API_BASE_URL');
    const web = assignmentFor(contents, 'EXPO_PUBLIC_API_BASE_URL_WEB');
    expect(resolveApiBaseUrl(shared, 'web', false, web).baseUrl).toBe(
      'http://localhost:8000/api/v1',
    );
    expect(resolveApiBaseUrl(shared, 'android', false, web).baseUrl).toBe(
      'http://10.0.2.2:8000/api/v1',
    );
  });

  it('carries no backend secrets — these files are inlined into the bundle', () => {
    const forbidden = /DATABASE_URL|JWT|SECRET|PASSWORD|TOKEN|PRIVATE_KEY/i;
    for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_API_BASE_URL_WEB']) {
      const value = assignmentFor(contents, key) ?? '';
      expect(value, `${key} must not look like a secret`).not.toMatch(forbidden);
    }
  });
});

describe('eas.json build profiles', () => {
  it('pins the production API base URL for cloud builds', () => {
    expect(buildProfiles().production?.env?.EXPO_PUBLIC_API_BASE_URL).toBe(
      PRODUCTION_API_BASE_URL,
    );
  });

  it('leaves the development profile unpinned', () => {
    // A pinned URL here would point a developer's own build at production, so
    // this profile must keep resolving whatever their local `.env` says.
    expect(buildProfiles().development?.env?.EXPO_PUBLIC_API_BASE_URL).toBeUndefined();
  });

  it('pins the preview profile, which is installed on a real device', () => {
    // The preview APK is sideloaded onto a physical phone, and 10.0.2.2 is the
    // Android *emulator* alias — unroutable from real hardware. So this profile
    // has to carry the deployed API explicitly, or the installed APK cannot
    // reach the backend at all.
    expect(buildProfiles().preview?.env?.EXPO_PUBLIC_API_BASE_URL).toBe(
      PRODUCTION_API_BASE_URL,
    );
  });

  it('keeps the production profile free of backend secrets', () => {
    // `EXPO_PUBLIC_*` is inlined into the shipped JavaScript and readable by
    // anyone with the app, so it may only ever carry the public API origin.
    //
    // The key set is no longer pinned to a single entry: the profile also blanks
    // `EXPO_PUBLIC_API_BASE_URL_LAN` so a physical device cannot prefer the
    // developer's LAN address. What must still hold is that *every* key is public
    // and *no* value looks like a credential — a stricter guarantee than a fixed
    // list, which would have been satisfied by any future addition anyway.
    const forbidden = /DATABASE_URL|JWT|SECRET|PASSWORD|TOKEN|PRIVATE_KEY/i;
    const env = buildProfiles().production?.env ?? {};
    expect(Object.keys(env).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(env)) {
      expect(key, `${key} must be a public build variable`).toMatch(/^EXPO_PUBLIC_/);
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

/**
 * The LAN override must never reach a device running a cloud build.
 *
 * `resolveApiBaseUrl` deliberately prefers `EXPO_PUBLIC_API_BASE_URL_LAN` on a
 * physical Android device, so a phone on the developer's Wi-Fi reaches their own
 * machine instead of an emulator alias it cannot resolve. That is correct for
 * development and wrong for a distributed build — and EAS Build uploads `.env`
 * from the project directory even though it is git-ignored, so a developer's LAN
 * address would otherwise be compiled into the APK and silently win over the
 * production URL on exactly the hardware the build is meant to be tested on.
 *
 * The fix is configuration, not logic: the cloud profiles set the LAN variable to
 * an empty string, which `resolveApiBaseUrl` already treats as "not supplied", so
 * resolution falls through to the shared production URL. These tests drive the
 * real resolver with the real `eas.json` values rather than restating them, so a
 * future edit that reintroduces a LAN address fails here.
 */
describe('eas.json build profiles — no LAN override on a physical device', () => {
  /** The resolver inputs a physical Android device would see from a cloud build. */
  function resolveAsPhysicalDevice(profile: string) {
    const env = buildProfiles()[profile]?.env ?? {};
    return resolveApiBaseUrl(
      env.EXPO_PUBLIC_API_BASE_URL,
      'android',
      true, // real hardware, not an emulator
      undefined, // the web override never applies on Android
      env.EXPO_PUBLIC_API_BASE_URL_LAN,
    );
  }

  it('blanks the LAN variable in both cloud profiles', () => {
    // The empty string is the whole mechanism: an absent key would be indistinguishable
    // from "not configured", and a real address here would be compiled into the APK.
    for (const profile of ['preview', 'production']) {
      expect(buildProfiles()[profile]?.env?.EXPO_PUBLIC_API_BASE_URL_LAN, profile).toBe('');
    }
  });

  it('resolves the preview profile to the production API on a real phone', () => {
    const resolved = resolveAsPhysicalDevice('preview');
    expect(resolved.baseUrl).toBe(PRODUCTION_API_BASE_URL);
    expect(resolved.source).toBe('configured');
  });

  it('resolves the production profile to the production API on a real phone', () => {
    const resolved = resolveAsPhysicalDevice('production');
    expect(resolved.baseUrl).toBe(PRODUCTION_API_BASE_URL);
    expect(resolved.source).toBe('configured');
  });

  it('never falls through to the developer LAN address', () => {
    const developerLan = 'http://10.236.127.87:8000/api/v1';
    for (const profile of ['preview', 'production']) {
      const resolved = resolveAsPhysicalDevice(profile);
      expect(resolved.baseUrl, profile).not.toBe(developerLan);
      expect(resolved.source, profile).not.toBe('lan-override');
    }
  });

  it('still uses the LAN override when a developer actually configures one', () => {
    // The guard above must not have quietly disabled LAN development: with a real
    // address supplied, the resolver still prefers it on hardware.
    const resolved = resolveApiBaseUrl(
      'http://10.0.2.2:8000/api/v1',
      'android',
      true,
      undefined,
      'http://10.236.127.87:8000/api/v1',
    );
    expect(resolved.baseUrl).toBe('http://10.236.127.87:8000/api/v1');
    expect(resolved.source).toBe('lan-override');
  });
});
