/**
 * Typed access to build-time configuration.
 *
 * Only public `EXPO_PUBLIC_*` values belong here — backend secrets are never
 * exposed to the mobile app (docs/SECURITY.md, Stage 4 section).
 */

import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { resolveApiBaseUrl, type PlatformName } from '@/lib/apiBaseUrl';

function currentPlatform(): PlatformName {
  if (Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web') {
    return Platform.OS;
  }
  return 'ios';
}

/**
 * True only for real hardware.
 *
 * This is the one distinction the whole base-URL story hinges on: `10.0.2.2` and
 * `localhost` are correct inside an emulator/simulator and unresolvable on a
 * phone. `expo-device` is already a dependency, so the app can tell the two
 * apart instead of guessing from the platform alone.
 */
function isPhysicalDevice(): boolean {
  try {
    return Device.isDevice === true;
  } catch {
    // Never let a missing native module stop the app from starting.
    return false;
  }
}

const platform = currentPlatform();

const resolved = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL,
  platform,
  isPhysicalDevice(),
  // Expo has no per-platform env files, so the web bundle needs its own
  // variable. It is read here rather than in `apiBaseUrl.ts` so the resolver
  // stays a pure function that the unit tests can drive directly. Only `web`
  // has an override: iOS shares the host loopback, and Android must keep the
  // `10.0.2.2` emulator alias.
  platform === 'web' ? process.env.EXPO_PUBLIC_API_BASE_URL_WEB : undefined,
  // The same reason, pointed the other way: a physical phone is the one target
  // the shared value cannot serve, so it gets a LAN address of its own. That
  // means a phone on the same Wi-Fi reaches the developer machine without
  // editing the emulator's `10.0.2.2` value or breaking the emulator in the
  // process. Set it to this computer's LAN IPv4 (find it with `ipconfig`).
  platform === 'android' ? process.env.EXPO_PUBLIC_API_BASE_URL_LAN : undefined,
);

export const env = {
  apiBaseUrl: resolved.baseUrl,
  apiBaseUrlSource: resolved.source,
  apiHostKind: resolved.hostKind,
  isPhysicalDevice: isPhysicalDevice(),
  /**
   * The app is on a phone but is using a host that cannot exist there, so every
   * request is certain to fail. The client and the connection panel name this
   * instead of leaving the user with a bare "Network request failed".
   */
  needsDeviceConfiguration: resolved.needsDeviceConfiguration,
} as const;
