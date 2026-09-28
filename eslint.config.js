// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // `npm run lint` runs `expo lint src app`, but `/app` is the gitignored
    // stray Android Studio project (see .gitignore), not this app's routes —
    // those live in `src/app`. Without these ignores ESLint aborts with "all of
    // the files matching the glob pattern are ignored".
    ignores: ["dist/*", "app/*", "build/*", "android/*"],
  }
]);
