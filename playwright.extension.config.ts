import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/extension/chromium',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: 'test-results/extension-chromium',
  webServer: {
    command: 'node tests/extension/server.mjs',
    url: 'http://127.0.0.1:3199/health',
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
