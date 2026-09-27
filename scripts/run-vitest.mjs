/**
 * Cross-platform Vitest launcher with one Windows-specific job.
 *
 * On Windows, Vitest loads its runtime twice when the project is opened from a
 * path whose drive letter is lowercase (`c:\mahajob`): the CLI is imported
 * through the working directory's spelling while Vite normalises module ids to
 * the on-disk case (`C:/mahajob/...`). A test file then imports a second copy of
 * the runtime whose collector state was never populated, and the first
 * `describe()` throws "Cannot read properties of undefined (reading 'config')"
 * (vitest-dev/vitest#10692). The failure looks like a broken test suite, but the
 * tests are fine — only the spelling differs.
 *
 * `realpathSync.native` returns the on-disk spelling of the directory, so the
 * CLI is launched from that path and both spellings agree. Everywhere else the
 * arguments are passed through untouched.
 *
 * Usage (through the package scripts): `npm test`, `npm run test:watch`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

let cwd = process.cwd();
if (process.platform === 'win32') {
  try {
    cwd = realpathSync.native(cwd);
  } catch {
    // Keep the original path when the directory cannot be canonicalised.
  }
}

const vitestCli = join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
if (!existsSync(vitestCli)) {
  console.error(`Vitest is not installed at ${vitestCli}. Run "npm install" first.`);
  process.exit(1);
}

const forwarded = process.argv.slice(2);
const args = forwarded.includes('--watch') ? forwarded : ['run', ...forwarded];

const result = spawnSync(process.execPath, [vitestCli, ...args], {
  cwd,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
