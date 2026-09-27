import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests cover the pure business logic that must stay identical to the
 * backend: API base-URL resolution, the error contract, password rules, role
 * routing, and the canonical status vocabulary.
 *
 * They run in Node (no native runtime) so `npm test` works on any machine that
 * can install dependencies — including one without an Android SDK or Xcode.
 * Component rendering is verified on a real device/emulator instead.
 *
 * `.mts` because this package is CommonJS by default and the config uses ESM
 * syntax; the extension keeps Vite from warning about the loader.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
