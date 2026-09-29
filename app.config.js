// Dynamic Expo configuration.
//
// Why this file exists: `usesCleartextTraffic` used to be hard-coded to `true`
// for every build, which meant the PRODUCTION Android app also allowed plaintext
// HTTP. Cleartext is genuinely required locally — the dev backend is plain
// `http://10.0.2.2:8000` — so the fix is to scope the exception to the profiles
// that actually need it rather than to delete it and break local development.
//
// How the profile is detected:
//   * EAS Build sets `EAS_BUILD_PROFILE` for every remote build.
//   * A local `npx expo start` / `npx expo prebuild` leaves it unset, which we
//     treat as development (the safe, permissive-for-debugging case).
//
// Anything that is not the `production` profile keeps cleartext enabled so the
// emulator, a physical phone on LAN, and the `preview` APK all keep working.
// The `production` profile gets an explicit `false` rather than relying on the
// platform default, so the release manifest is unambiguous when audited.

const CLEAR_TEXT_PLUGIN = 'expo-build-properties';

const appJson = require('./app.json');

const buildProfile = process.env.EAS_BUILD_PROFILE ?? 'development';
const isProductionBuild = buildProfile === 'production';

/**
 * Drop any existing `expo-build-properties` entry so this file is the single
 * source of truth for native build properties. Leaving the old entry in
 * `app.json` as well would produce two competing declarations.
 */
const pluginsWithoutBuildProperties = (appJson.expo.plugins ?? []).filter(
  (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== CLEAR_TEXT_PLUGIN
);

module.exports = {
  ...appJson.expo,
  plugins: [
    ...pluginsWithoutBuildProperties,
    [
      CLEAR_TEXT_PLUGIN,
      {
        android: {
          // Release builds must not permit plaintext. Debug/preview keep it so
          // the local HTTP backend stays reachable.
          usesCleartextTraffic: !isProductionBuild,
        },
      },
    ],
  ],
};
