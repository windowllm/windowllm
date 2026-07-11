import { defineConfig } from 'vitest/config';

// Dedicated test config so vitest doesn't pull in the app's React vite build.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
