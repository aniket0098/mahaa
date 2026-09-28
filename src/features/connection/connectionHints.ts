/**
 * Connection failure hints — pure, so it is unit testable in Node.
 *
 * Kept separate from `useApiConnection` on purpose: that hook imports
 * `react-native` (through `@/lib/env`), and importing it from a Node test would
 * pull React Native's Flow sources into the test runner. This is the same split
 * as `@/lib/apiBaseUrl` and `@/lib/env`.
 */

/** Extra context the hint needs that the URL alone cannot carry. */
export interface HintContext {
  /**
   * The app fell back to a platform default that cannot be reached from real
   * hardware. This is the failure that used to reach the user as a bare
   * "Network request failed", so it gets a dedicated, unambiguous message.
   */
  needsDeviceConfiguration?: boolean;
}

/** The one place that turns a base URL into a concrete next action. */
export function hintForBaseUrl(baseUrl: string, context: HintContext = {}): string {
  if (context.needsDeviceConfiguration) {
    return (
      `This build is on a physical phone, but it is using ${baseUrl}, which only exists ` +
      'inside an Android emulator. Set EXPO_PUBLIC_API_BASE_URL_LAN in .env to ' +
      "this computer's LAN address (find it with `ipconfig`; it looks like " +
      'http://192.168.1.5:8000/api/v1), then restart the dev server with ' +
      '"npm run start:clear" so the new value is inlined into the bundle. ' +
      'Chrome reaching the API proves the network is fine — the app is pointed ' +
      'somewhere else.'
    );
  }
  if (baseUrl.includes('10.0.2.2')) {
    // Deliberately *not* the cache-clearing restart: this branch means somebody
    // typed this value themselves, so the fix is simply to correct it. The
    // "restart the dev server" advice is reserved for the branch above, where the
    // value was a silent fallback the user never chose and therefore cannot
    // diagnose on their own.
    return "This is the Android emulator address. On a physical phone, set EXPO_PUBLIC_API_BASE_URL_LAN in .env to your computer's LAN address (find it with `ipconfig`; it looks like http://192.168.1.5:8000/api/v1).";
  }
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    return 'A phone cannot reach "localhost" — that means the phone itself. Set EXPO_PUBLIC_API_BASE_URL_LAN in .env to your computer\'s LAN address.';
  }
  if (baseUrl.startsWith('http://')) {
    return 'Android blocks plain http:// in a standalone build. Expo Go normally allows it, so check the phone and this computer are on the same Wi-Fi; if the URL is right and it still fails, you need a development build with usesCleartextTraffic enabled.';
  }
  return 'Check that the phone and this computer are on the same Wi-Fi, and that the API is running.';
}
