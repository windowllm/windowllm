import { test, expect, clearVault } from '../fixtures/vault.fixture';

test.describe('Vault Settings Operations', () => {
  test.beforeEach(async ({ vaultPage }) => {
    await clearVault(vaultPage);
  });

  test('should get default settings', async ({ vaultPage }) => {
    const settings = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.settings.get();
    });

    expect(settings).toMatchObject({
      requireApproval: true,
      autoApproveOrigins: [],
      globalRateLimit: {
        requestsPerMinute: 60,
        tokensPerDay: 100000,
      },
    });
  });

  test('should update requireApproval setting', async ({ vaultPage }) => {
    await vaultPage.evaluate(async () => {
      await window.vaultAPI!.settings.update({
        requireApproval: false,
      });
    });

    const settings = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.settings.get();
    });

    expect((settings as { requireApproval: boolean }).requireApproval).toBe(false);
  });

  test('should update rate limit settings', async ({ vaultPage }) => {
    await vaultPage.evaluate(async () => {
      await window.vaultAPI!.settings.update({
        globalRateLimit: {
          requestsPerMinute: 30,
          tokensPerDay: 50000,
        },
      });
    });

    const settings = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.settings.get();
    });

    expect((settings as { globalRateLimit: { requestsPerMinute: number; tokensPerDay: number } }).globalRateLimit).toEqual({
      requestsPerMinute: 30,
      tokensPerDay: 50000,
    });
  });

  test('should update auto-approve origins', async ({ vaultPage }) => {
    await vaultPage.evaluate(async () => {
      await window.vaultAPI!.settings.update({
        autoApproveOrigins: ['https://trusted.com', 'https://mysite.com'],
      });
    });

    const settings = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.settings.get();
    });

    expect((settings as { autoApproveOrigins: string[] }).autoApproveOrigins).toEqual([
      'https://trusted.com',
      'https://mysite.com',
    ]);
  });

  test('should preserve unmodified settings', async ({ vaultPage }) => {
    // First update only requireApproval
    await vaultPage.evaluate(async () => {
      await window.vaultAPI!.settings.update({
        requireApproval: false,
      });
    });

    // Then update only rate limits
    await vaultPage.evaluate(async () => {
      await window.vaultAPI!.settings.update({
        globalRateLimit: {
          requestsPerMinute: 120,
          tokensPerDay: 200000,
        },
      });
    });

    const settings = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.settings.get();
    }) as { requireApproval: boolean; globalRateLimit: { requestsPerMinute: number; tokensPerDay: number } };

    // Both updates should be preserved
    expect(settings.requireApproval).toBe(false);
    expect(settings.globalRateLimit).toEqual({
      requestsPerMinute: 120,
      tokensPerDay: 200000,
    });
  });

  test('should set default provider', async ({ vaultPage }) => {
    await vaultPage.evaluate(async () => {
      await window.vaultAPI!.settings.update({
        defaultProvider: 'anthropic',
      });
    });

    const settings = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.settings.get();
    });

    expect((settings as { defaultProvider: string }).defaultProvider).toBe('anthropic');
  });
});
