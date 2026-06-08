import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';

// WSL-only verification config. Identical to vitest.config.ts EXCEPT it routes
// the `better-sqlite3` import to a node:sqlite-backed shim, so the DB suites can
// run under WSL without the Windows native binary. Invoke via `npm run test:wsl`
// (which also sets --experimental-sqlite). Windows keeps using vitest.config.ts
// + the real better-sqlite3 binary — this file changes nothing there.
export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      'better-sqlite3': fileURLToPath(new URL('./tests/_shims/better-sqlite3.mjs', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
