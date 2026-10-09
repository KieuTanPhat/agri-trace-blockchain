import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

if (!process.env.TEST_DATABASE_URL?.trim()) {
  throw new Error(
    'TEST_DATABASE_URL is required; use a dedicated migrated test database for E2E checks',
  );
}

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
