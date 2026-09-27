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

const resolved = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL,
  currentPlatform(),
  isPhysicalDevice(),
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
