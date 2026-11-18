import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Run test files sequentially to avoid database conflicts
    fileParallelism: false,
    sequence: {
      shuffle: false,
      concurrent: false,
    },
    // Increase timeout for database operations
    hookTimeout: 60000,
    testTimeout: 60000,
    // Setup files run in the same process as tests
    setupFiles: ['server/tests/db-singleton.ts'],
    // Environment
    environment: 'node',
    // Include patterns
    include: ['server/tests/**/*.test.ts'],
    // Exclude patterns
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});