/**
 * API base URL resolution — a pure module so it can be unit tested without a
 * React Native runtime.
 *
 * The value is supplied by `EXPO_PUBLIC_API_BASE_URL` (public build-time
 * configuration only; backend secrets never reach the app — docs/SECURITY.md).
 *
 * Two rules this module follows deliberately:
 *
 * - **No `new URL()`.** In Node that is the WHATWG parser, but in React Native
 *   `URL` resolves to `react-native/Libraries/Blob/URL` — a hand-rolled class
 *   that never throws and reads `protocol` through a regex. A guard written
 *   against Node's parser passes its unit tests and then behaves differently on
 *   a phone. Everything below is plain string work, so Node and the device
 *   agree.
 * - **Never silently resolve to an address that cannot exist on the hardware.**
 *   The Android default (`10.0.2.2`) is the emulator's alias for the host
 *   machine and is unresolvable from a real phone. When that is what the app
 *   ends up using on a device, it is reported as a configuration fault instead
 *   of becoming a doomed request that only surfaces as "Network request failed".
 */

export type PlatformName = 'android' | 'ios' | 'web';

/** Where the effective value came from. */
export type ApiBaseUrlSource = 'configured' | 'platform-default';

/**
 * How the host behaves when the app runs on real hardware.
 *
 * - `lan` — a routable network address; works from a phone on the same Wi-Fi
 * - `emulator` — the Android emulator's alias for the host machine
 * - `loopback` — the phone itself, so it never reaches a dev machine
 */
export type ApiHostKind = 'lan' | 'emulator' | 'loopback';

export const DEFAULT_API_BASE_URL: Record<PlatformName, string> = {
  android: 'http://10.0.2.2:8000/api/v1',
  ios: 'http://localhost:8000/api/v1',
  web: 'http://localhost:8000/api/v1',
};

const SCHEME = /^([a-zA-Z][a-zA-Z\d+\-.]*):\/\//;
const HTTP_URL = /^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i;
const AUTHORITY = /^https?:\/\/([^/?#\s]+)/i;

/** Resolves to the developer machine only from inside an Android emulator. */
const EMULATOR_HOSTS = new Set(['10.0.2.2', '10.0.3.2']);
/** Resolves to the device itself, so it can never reach a dev machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Classify the host a base URL points at, without instantiating a parser. */
export function hostKindFor(baseUrl: string): ApiHostKind {
  const authority = AUTHORITY.exec(baseUrl)?.[1] ?? '';
  const hostAndPort = authority.split('@').pop() ?? '';
  // An IPv6 literal keeps its brackets and its `:port` sits outside them, so it
  // has to be cut at the closing bracket rather than at the first colon.
  const host = (
    hostAndPort.startsWith('[')
      ? (hostAndPort.match(/^\[[^\]]*\]/)?.[0] ?? hostAndPort)
      : hostAndPort.split(':')[0]
  ).toLowerCase();

  if (EMULATOR_HOSTS.has(host)) return 'emulator';
  if (LOOPBACK_HOSTS.has(host)) return 'loopback';
  return 'lan';
}

export interface ResolvedApiBaseUrl {
  /** The URL every request is built from, without a trailing slash. */
  baseUrl: string;
  source: ApiBaseUrlSource;
  hostKind: ApiHostKind;
  /**
   * The app is on real hardware but is using a host that cannot exist there, so
   * every request is certain to fail. Callers surface this as a configuration
   * fault instead of retrying a request that cannot succeed.
   *
   * Only an unset variable counts: an explicit `localhost` is a choice the user
   * can see and change, whereas a silent fallback to `10.0.2.2` is not.
   */
  needsDeviceConfiguration: boolean;
}

/**
 * Validate and normalise the configured base URL.
 *
 * Fails fast on malformed configuration instead of issuing broken requests —
 * the same guard the web app applies in `apps/web/src/lib/env.ts`.
 *
 * @param raw the inlined `EXPO_PUBLIC_API_BASE_URL`, if any
 * @param platform the platform this bundle is running on
 * @param isPhysicalDevice real hardware, as opposed to a simulator or emulator
 */
export function resolveApiBaseUrl(
  raw: string | undefined,
  platform: PlatformName,
  isPhysicalDevice = false,
): ResolvedApiBaseUrl {
  const trimmed = raw?.trim();
  const isConfigured = Boolean(trimmed && trimmed.length > 0);
  const value = isConfigured ? (trimmed as string) : DEFAULT_API_BASE_URL[platform];

  if (!HTTP_URL.test(value)) {
    throw new Error(
      SCHEME.test(value)
        ? `Invalid EXPO_PUBLIC_API_BASE_URL: ${value} (expected an http(s) URL)`
        : `Invalid EXPO_PUBLIC_API_BASE_URL: ${value}`,
    );
  }

  const baseUrl = value.replace(/\/+$/, '');
  const hostKind = hostKindFor(baseUrl);

  return {
    baseUrl,
    source: isConfigured ? 'configured' : 'platform-default',
    hostKind,
    needsDeviceConfiguration: !isConfigured && isPhysicalDevice && hostKind !== 'lan',
  };
}
