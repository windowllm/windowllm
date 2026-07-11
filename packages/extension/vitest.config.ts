import { defineConfig } from 'vitest/config';

// Dedicated test config so vitest does not pick up the multi-entry IIFE build
// pipeline in vite.config.ts (whose closeBundle hook rebuilds the bundles).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
