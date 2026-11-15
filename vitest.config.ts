import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Corpus/API suites are CPU-heavy; bound contention without relaxing timeouts.
    maxWorkers: 2,
  },
});
