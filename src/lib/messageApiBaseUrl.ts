/**
 * Message-service base URL resolution — a pure module, like `apiBaseUrl.ts`.
 *
 * The Message section talks to TWO services: the main API (conversations, the
 * user lookup the compose screen uses) and the independent message service
 * (`message-docker-service`, which owns message requests). One base URL cannot
 * describe both, so this resolver answers the second question with the same
 * discipline the first resolver has.
 *
 * Three rules, in precedence order:
 *
 * 1. **An explicit variable wins** — `EXPO_PUBLIC_MESSAGE_API_BASE_URL`, with
 *    the same platform scoping as the main variable: `_WEB` on web, `_LAN` on
 *    a physical Android device. This is how a *deployed* message service is
 *    pointed at (its Render URL), and the only way to use one on real
 *    hardware.
 * 2. **Otherwise it is derived from the resolved main API base** by swapping
 *    the port to {@link DEFAULT_MESSAGE_SERVICE_PORT} when the main base is a
 *    *local development* host (loopback, the emulator alias, or a private LAN
 *    address). Local development then needs no `.env` edit at all: the main
 *    API on `:8000` implies the message service on `:8001`.
 * 3. **Otherwise it is `null`** — unconfigured. A main API base that is a
 *    public host (the deployed backend) cannot have a port guessed for it, so
 *    the feature says "not configured" honestly instead of emitting a URL
 *    that cannot work. `null` is never silently replaced.
 *
 * No `new URL()` — React Native's `URL` is a hand-regex'd class that behaves
 * differently from Node's, so everything below is plain string work the unit
 * tests and the device agree on.
 */

import { hostKindFor, type PlatformName } from '@/lib/apiBaseUrl';

/** The local development port of `message-docker-service` (see its README). */
export const DEFAULT_MESSAGE_SERVICE_PORT = 8001;

const AUTHORITY = /^https?:\/\/([^/?#\s]+)/i;

/** Emulator aliases and loopback: hosts that can only be a dev machine. */
const DEV_HOSTS = new Set(['10.0.2.2', '10.0.3.2', 'localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * True when `baseUrl` points at something that can only be a developer
 * machine — the only case where port-derivation is safe. A public host
 * (whatever `EXPO_PUBLIC_API_BASE_URL` points at in production) is NOT: there
 * is no default port to swap to.
 */
export function isLocalDevBase(baseUrl: string): boolean {
  const authority = AUTHORITY.exec(baseUrl)?.[1];
  if (!authority) return false;
  const host = authority.replace(/:\d+$/, '').toLowerCase();
  if (DEV_HOSTS.has(host)) return true;
  // A private LAN address (192.168.x / 10.x / 172.16-31.x) is the phone-on-
  // Wi-Fi case: a real device reaching a dev machine over the network.
  return hostKindFor(baseUrl) === 'lan' && /^(\d{1,3}\.){3}\d{1,3}$/.test(host)
    ? isPrivateIpv4(host)
    : false;
}

function isPrivateIpv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  return a === 172 && b >= 16 && b <= 31;
}

/** Replace (or add) the port on an http(s) authority. Input must have one. */
export function withPort(baseUrl: string, port: number): string | null {
  const match = /^([a-zA-Z][a-zA-Z\d+.\-]*:\/\/)([^/?#]+)/.exec(baseUrl);
  if (!match) return null;
  const [scheme, authority] = [match[1], match[2]];
  const host = authority.replace(/:\d+$/, '');
  return `${scheme}${host}:${port}${baseUrl.slice(match[0].length)}`;
}

export interface ResolvedMessageBase {
  /** `null` only when nothing configures it and nothing can be derived. */
  baseUrl: string | null;
  source: 'explicit' | 'derived' | 'unconfigured';
}

/**
 * @param explicit `EXPO_PUBLIC_MESSAGE_API_BASE_URL`
 * @param platformOverride `EXPO_PUBLIC_MESSAGE_API_BASE_URL_WEB` (web only)
 * @param lanOverride `EXPO_PUBLIC_MESSAGE_API_BASE_URL_LAN` (Android + hardware only)
 * @param apiBaseUrl the *resolved* main API base URL (`env.apiBaseUrl`)
 * @param platform this bundle's platform
 */
export function resolveMessageServiceBase(
  explicit: string | undefined,
  platformOverride: string | undefined,
  lanOverride: string | undefined,
  apiBaseUrl: string,
  platform: PlatformName,
): ResolvedMessageBase {
  const trimmed = explicit?.trim();
  if (trimmed) return { baseUrl: trimmed.replace(/\/+$/, ''), source: 'explicit' };

  // Same platform scoping the main resolver applies: a web-only variable must
  // not repoint Android, and a LAN value is only meaningful on real hardware.
  const web = platformOverride?.trim();
  if (platform === 'web' && web) return { baseUrl: web.replace(/\/+$/, ''), source: 'explicit' };

  const lan = lanOverride?.trim();
  if (platform === 'android' && lan && hostKindFor(lan) === 'lan') {
    return { baseUrl: lan.replace(/\/+$/, ''), source: 'explicit' };
  }

  if (isLocalDevBase(apiBaseUrl)) {
    const derived = withPort(apiBaseUrl, DEFAULT_MESSAGE_SERVICE_PORT);
    if (derived) return { baseUrl: derived.replace(/\/+$/, ''), source: 'derived' };
  }

  return { baseUrl: null, source: 'unconfigured' };
}
