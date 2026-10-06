import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// CI must execute the PostgreSQL suites rather than silently skipping them.
if (process.env.CI === 'true' && !process.env.TEST_DATABASE_URL) {
  throw new Error(
    'API E2E in CI requires TEST_DATABASE_URL for a migrated test database',
  );
}

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      JWT_SECRET: 'e2e-tests-only-secret',
      ALERT_SCAN_ENABLED: 'false',
      FABRIC_ENABLED: 'false',
    },
  },
});
