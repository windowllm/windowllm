import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/index.ts'],
      reporter: ['text'],
      thresholds: {
        statements: 98,
        branches: 90,
        functions: 100,
        lines: 100,
      },
    },
  },
});
