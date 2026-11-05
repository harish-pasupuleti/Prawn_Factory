import { defineConfig } from 'vitest/config';

// Integration tests make many sequential database round trips. Against a remote database
// (for example Neon in another continent) a single multi-step workflow test can take minutes,
// so timeouts are generous. Override with TEST_TIMEOUT_MS if needed.
const timeout = Number(process.env.TEST_TIMEOUT_MS) || 180_000;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: timeout,
    hookTimeout: timeout,
  },
});
