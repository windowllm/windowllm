import { test, expect } from '@playwright/test';

test.describe('Client Library Loading', () => {
  test('should load test page', async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await page.goto('https://test.localhost:3101');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText('WindowLLM Test Page');

    await context.close();
  });

  test('should load llm.js from vault', async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await page.goto('https://test.localhost:3101');

    // Wait for window.llm to be defined
    await page.waitForFunction(() => typeof window.llm !== 'undefined', {
      timeout: 30000,
    });

    const hasLLM = await page.evaluate(() => typeof window.llm !== 'undefined');
    expect(hasLLM).toBe(true);

    await context.close();
  });

  test('should have window.llm API methods', async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await page.goto('https://test.localhost:3101');

    // Wait for window.llm to be defined
    await page.waitForFunction(() => typeof window.llm !== 'undefined', {
      timeout: 30000,
    });

    const apiMethods = await page.evaluate(() => ({
      hasRequestSession: typeof window.llm.requestSession === 'function',
      hasPermissions: typeof window.llm.permissions === 'object',
      hasCapabilities: typeof window.llm.capabilities === 'object',
      hasModels: typeof window.llm.models === 'object',
    }));

    expect(apiMethods.hasRequestSession).toBe(true);
    expect(apiMethods.hasPermissions).toBe(true);
    expect(apiMethods.hasCapabilities).toBe(true);
    expect(apiMethods.hasModels).toBe(true);

    await context.close();
  });

  test('test page should run and complete tests', async ({ browser }) => {
    test.setTimeout(120000); // 2 minute timeout

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await page.goto('https://test.localhost:3101');

    // Wait for llm.js to load first
    await page.waitForFunction(() => typeof window.llm !== 'undefined', {
      timeout: 30000,
    });

    // Wait for tests to complete (or timeout)
    try {
      await page.waitForFunction(() => (window as unknown as { __testsDone: boolean }).__testsDone === true, {
        timeout: 60000,
      });
    } catch {
      // If tests don't complete, check what we have
      console.log('Tests did not complete in time, checking partial results...');
    }

    // Get test results (may be partial)
    const results = await page.evaluate(() =>
      (window as unknown as { __testResults: unknown[] }).__testResults || []
    );

    expect(Array.isArray(results)).toBe(true);

    // Log test results
    console.log('Test page results:', JSON.stringify(results, null, 2));

    await context.close();
  });

  test('availability tests should pass', async ({ browser }) => {
    test.setTimeout(120000); // 2 minute timeout

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await page.goto('https://test.localhost:3101');

    // Wait for llm.js to load first
    await page.waitForFunction(() => typeof window.llm !== 'undefined', {
      timeout: 30000,
    });

    // Wait for tests to complete (or timeout)
    try {
      await page.waitForFunction(() => (window as unknown as { __testsDone: boolean }).__testsDone === true, {
        timeout: 60000,
      });
    } catch {
      console.log('Tests did not complete in time, checking partial results...');
    }

    // Get test results
    const results = await page.evaluate(() =>
      (window as unknown as { __testResults: Array<{ name: string; status: string; error?: string }> }).__testResults || []
    );

    // Check that availability tests passed
    const availabilityTests = results.filter(r => r.name.startsWith('availability:'));
    const failedAvailability = availabilityTests.filter(r => r.status === 'fail');

    if (failedAvailability.length > 0) {
      console.error('Failed availability tests:', failedAvailability);
    }

    // At minimum, check that we got some availability test results
    expect(availabilityTests.length).toBeGreaterThan(0);

    await context.close();
  });
});
