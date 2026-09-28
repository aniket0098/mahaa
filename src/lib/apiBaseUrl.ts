/**
 * API base URL resolution — a pure module so it can be unit tested without a
 * React Native runtime.
 *
 * The value is supplied by `EXPO_PUBLIC_API_BASE_URL` (public build-time
 * configuration only; backend secrets never reach the app — docs/SECURITY.md).
 *
 * A single variable cannot serve every target: the Android emulator reaches the
 * developer machine at `10.0.2.2`, while a browser on the same machine reaches
 * it at `localhost`. Expo has no per-platform env files, so a platform-scoped
 * variable (`EXPO_PUBLIC_API_BASE_URL_WEB`) overrides the shared one instead of
 * forcing a choice between targets.
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

/**
 * Where the effective value came from.
 *
 * - `platform-override` — the web variable won (web only)
 * - `lan-override` — the LAN variable won (a physical Android device only)
 * - `configured` — the shared variable was set
 * - `platform-default` — nothing was set, so the per-platform default applied
 */
export type ApiBaseUrlSource =
  | 'platform-override'
  | 'lan-override'
  | 'configured'
  | 'platform-default';

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
/**
 * A routable private IPv4 address. Used to accept or refuse a `_LAN` value: a LAN
 * variable pointing at `localhost` or `10.0.2.2` is not a LAN address, and
 * honouring it on a phone would reintroduce the exact failure it exists to fix.
 */
const LAN_HOST = /^https?:\/\/(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?::\d+)?(?:\/\S*)?$/;

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
 * Resolve the base URL.
 *
 * Four inputs can speak, in a fixed order of precedence, and the order is the
 * whole design:
 *
 * 1. **The platform override** (`_WEB`) — only ever on `web`.
 * 2. **The LAN address** (`_LAN`) — only ever on a real Android device, because
 *    that is the one target a single shared value cannot serve: `localhost` is
 *    the phone itself and `10.0.2.2` is an emulator alias. A phone therefore
 *    gets the developer's routable address without anybody editing the shared
 *    variable and breaking the emulator in the process.
 * 3. **The shared variable** — what the emulator and the web target share.
 * 4. **The per-platform default** — the last resort, and the only source that can
 *    produce an address a physical device cannot reach (reported through
 *    `needsDeviceConfiguration` rather than attempted).
 *
 * Every override is scoped to the platform it is valid for, and that scoping is
 * applied here rather than trusted to the caller. A resolver that accepted the
 * web or LAN value on any platform would quietly repoint an Android build at the
 * browser's loopback the next time somebody passed the argument unconditionally.
 * Ignoring them off their platform makes that impossible by construction.
 *
 * @param raw the inlined `EXPO_PUBLIC_API_BASE_URL`, if any
 * @param platform the platform this bundle is running on
 * @param isPhysicalDevice real hardware, as opposed to a simulator or emulator
 * @param platformOverride `EXPO_PUBLIC_API_BASE_URL_WEB`; web only
 * @param lanOverride `EXPO_PUBLIC_API_BASE_URL_LAN`; physical Android only
 */
export function resolveApiBaseUrl(
  raw: string | undefined,
  platform: PlatformName,
  isPhysicalDevice = false,
  platformOverride?: string,
  lanOverride?: string,
): ResolvedApiBaseUrl {
  const override = platformOverride?.trim();
  const lan = lanOverride?.trim();
  // Web-only. iOS shares the host loopback already, and Android must keep the
  // `10.0.2.2` emulator alias, so neither may be redirected here.
  const hasOverride = platform === 'web' && Boolean(override && override.length > 0);
  // Android-on-hardware only, and only for a genuine LAN address. A `_LAN` value
  // that is itself a loopback or emulator alias is refused rather than trusted:
  // honouring it would reintroduce the exact failure the variable exists to fix.
  const hasLan =
    platform === 'android' &&
    isPhysicalDevice &&
    Boolean(lan && lan.length > 0) &&
    LAN_HOST.test(lan as string) &&
    hostKindFor(lan as string) === 'lan';

  const trimmed = raw?.trim();
  const isConfigured = Boolean(trimmed && trimmed.length > 0);
  const value = hasOverride
    ? (override as string)
    : hasLan
      ? (lan as string)
      : isConfigured
        ? (trimmed as string)
        : DEFAULT_API_BASE_URL[platform];

  if (!HTTP_URL.test(value)) {
    // Name the variable that actually supplied the bad value. With three inputs
    // a fixed name would send the reader to edit the wrong line of `.env` — and
    // the whole point of failing here is that `.env` is where the fix goes.
    const variable = hasOverride
      ? 'EXPO_PUBLIC_API_BASE_URL_WEB'
      : hasLan
        ? 'EXPO_PUBLIC_API_BASE_URL_LAN'
        : 'EXPO_PUBLIC_API_BASE_URL';
    throw new Error(
      SCHEME.test(value)
        ? `Invalid ${variable}: ${value} (expected an http(s) URL)`
        : `Invalid ${variable}: ${value}`,
    );
  }

  const baseUrl = value.replace(/\/+$/, '');
  const hostKind = hostKindFor(baseUrl);

  return {
    baseUrl,
    source: hasOverride
      ? 'platform-override'
      : hasLan
        ? 'lan-override'
        : isConfigured
          ? 'configured'
          : 'platform-default',
    hostKind,
    // With a LAN value in hand the app is pointed somewhere a phone can reach, so
    // this stays false even though `10.0.2.2` would otherwise have been used.
    needsDeviceConfiguration:
      !hasOverride && !hasLan && !isConfigured && isPhysicalDevice && hostKind !== 'lan',
  };
}
