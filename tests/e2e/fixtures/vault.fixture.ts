import { test as base, expect, type Page } from '@playwright/test';

/**
 * VaultAPI type for page evaluation
 */
interface VaultAPI {
  providers: {
    list(): Promise<unknown[]>;
    get(id: string): Promise<unknown | null>;
    create(config: unknown): Promise<unknown>;
    update(id: string, updates: unknown): Promise<unknown>;
    delete(id: string): Promise<void>;
    test(id: string): Promise<boolean>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    getEnabled(): Promise<unknown[]>;
  };
  permissions: {
    list(): Promise<unknown[]>;
    get(origin: string): Promise<unknown | null>;
    grant(permission: unknown): Promise<void>;
    revoke(origin: string): Promise<void>;
    check(origin: string, capability: string): Promise<boolean>;
  };
  settings: {
    get(): Promise<unknown>;
    update(settings: unknown): Promise<void>;
  };
  encryption_: {
    isSetUp(): Promise<boolean>;
    isLocked(): boolean;
    setup(passphrase: string): Promise<boolean>;
    unlock(passphrase: string): Promise<boolean>;
    lock(): Promise<void>;
  };
  isConfigured(): Promise<boolean>;
  clear(): Promise<void>;
}

declare global {
  interface Window {
    vaultAPI?: VaultAPI;
  }
}

/**
 * Extended test fixture with vault helpers
 */
export const test = base.extend<{
  vaultPage: Page;
  testPage: Page;
}>({
  vaultPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    await page.goto('https://windowllm.localhost:3100');

    // Wait for vaultAPI to be available
    await page.waitForFunction(() => window.vaultAPI !== undefined, {
      timeout: 10000,
    });

    await use(page);
    await context.close();
  },

  testPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    await page.goto('https://test.localhost:3101');

    await use(page);
    await context.close();
  },
});

export { expect };

/**
 * Helper to get VaultAPI from page
 */
export async function getVaultAPI(page: Page): Promise<VaultAPI> {
  await page.waitForFunction(() => window.vaultAPI !== undefined, {
    timeout: 10000,
  });
  return page.evaluate(() => window.vaultAPI!) as Promise<VaultAPI>;
}

/**
 * Helper to clear vault storage before tests
 */
export async function clearVault(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (window.vaultAPI) {
      await window.vaultAPI.clear();
    }
    // Also clear localStorage directly
    localStorage.clear();
  });
}

/**
 * Helper to create a mock provider for testing
 */
export async function createMockProvider(page: Page, config?: {
  name?: string;
  type?: string;
  enabled?: boolean;
}): Promise<string> {
  const id = await page.evaluate(async (cfg) => {
    if (!window.vaultAPI) throw new Error('VaultAPI not available');
    const provider = await window.vaultAPI.providers.create({
      type: cfg?.type || 'mock',
      name: cfg?.name || 'Test Provider',
      enabled: cfg?.enabled ?? true,
      apiKey: 'test-key',
    });
    return (provider as { id: string }).id;
  }, config);
  return id;
}

/**
 * Helper to grant permission for a test origin
 */
export async function grantTestPermission(page: Page, origin: string): Promise<void> {
  await page.evaluate(async (o) => {
    if (!window.vaultAPI) throw new Error('VaultAPI not available');
    await window.vaultAPI.permissions.grant({
      origin: o,
      capabilities: ['chat', 'streaming'],
      grantedAt: Date.now(),
    });
  }, origin);
}
