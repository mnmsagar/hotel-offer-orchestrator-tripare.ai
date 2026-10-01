import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Temporal's test server is downloaded and started on first use; give it room.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
