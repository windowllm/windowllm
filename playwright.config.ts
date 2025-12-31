import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for WindowLLM E2E tests
 *
 * Tests vault operations and client API across Chrome and Firefox.
 * The tests use local development servers for vault and test page.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],

  use: {
    // Ignore HTTPS errors for local development certs
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  webServer: [
    {
      command: 'npm run dev:test-vault',
      url: 'https://windowllm.localhost:3100',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      ignoreHTTPSErrors: true,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev:test-page',
      url: 'https://test.localhost:3101',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      ignoreHTTPSErrors: true,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
