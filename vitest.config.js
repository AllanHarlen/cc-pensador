import { defineConfig } from 'vitest/config';

// Many suites spawn real subprocesses (node engine, `docker exec`, the full preflight) and run in
// parallel worker files. The 5s default flaked under CPU/IO load (measured: 5-27s per test with 6
// concurrent runs), so the ceiling is generous; it only bounds a hung test, it never slows a healthy one.
export default defineConfig({
  test: {
    setupFiles: ['./test/helpers/approval-key-setup.js'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
