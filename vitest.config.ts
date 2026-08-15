import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    include: [
      '__tests__/**/*.test.ts',
      'lib/**/__tests__/**/*.test.ts',
      'components/**/__tests__/**/*.test.{ts,tsx}',
      'tests/branding/**/*.test.{ts,tsx}',
      'tests/auth/**/*.test.{ts,tsx}',
      'tests/boarding/**/*.test.{ts,tsx}',
      'tests/audit/**/*.test.{ts,tsx}',
      'tests/security/**/*.test.ts',
      'tests/security/**/*.test.tsx',
    ],
    env: {
      TZ: 'UTC',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
