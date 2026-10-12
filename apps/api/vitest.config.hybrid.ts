import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

if (!process.env.TEST_DATABASE_URL || process.env.HYBRID_DRAFT_TESTS !== '1')
  throw new Error(
    'Use an isolated DB with the draft SQL fixtures and HYBRID_DRAFT_TESTS=1',
  );

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    setupFiles: ['test/support/ledger-route-setup.ts'],
    include: ['test/**/*.hybrid-db-spec.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
