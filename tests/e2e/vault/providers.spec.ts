import { test, expect, clearVault, createMockProvider } from '../fixtures/vault.fixture';

test.describe('Vault Provider Operations', () => {
  test.beforeEach(async ({ vaultPage }) => {
    await clearVault(vaultPage);
  });

  test('should list providers (empty)', async ({ vaultPage }) => {
    const providers = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.providers.list();
    });

    expect(providers).toEqual([]);
  });

  test('should create a provider', async ({ vaultPage }) => {
    const provider = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.providers.create({
        type: 'openai',
        name: 'My OpenAI',
        enabled: true,
        apiKey: 'sk-test-123',
      });
    });

    expect(provider).toMatchObject({
      type: 'openai',
      name: 'My OpenAI',
      enabled: true,
    });
    expect((provider as { id: string }).id).toBeTruthy();
  });

  test('should list providers after creation', async ({ vaultPage }) => {
    await createMockProvider(vaultPage, { name: 'Provider 1' });
    await createMockProvider(vaultPage, { name: 'Provider 2' });

    const providers = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.providers.list();
    });

    expect(providers).toHaveLength(2);
  });

  test('should get a provider by ID', async ({ vaultPage }) => {
    const id = await createMockProvider(vaultPage, { name: 'Test Provider' });

    const provider = await vaultPage.evaluate(async (providerId) => {
      return window.vaultAPI!.providers.get(providerId);
    }, id);

    expect(provider).toMatchObject({
      id,
      name: 'Test Provider',
    });
  });

  test('should return null for non-existent provider', async ({ vaultPage }) => {
    const provider = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.providers.get('non-existent-id');
    });

    expect(provider).toBeNull();
  });

  test('should update a provider', async ({ vaultPage }) => {
    const id = await createMockProvider(vaultPage, { name: 'Original Name' });

    const updated = await vaultPage.evaluate(async (providerId) => {
      return window.vaultAPI!.providers.update(providerId, {
        name: 'Updated Name',
      });
    }, id);

    expect(updated).toMatchObject({
      id,
      name: 'Updated Name',
    });
  });

  test('should delete a provider', async ({ vaultPage }) => {
    const id = await createMockProvider(vaultPage);

    await vaultPage.evaluate(async (providerId) => {
      await window.vaultAPI!.providers.delete(providerId);
    }, id);

    const provider = await vaultPage.evaluate(async (providerId) => {
      return window.vaultAPI!.providers.get(providerId);
    }, id);

    expect(provider).toBeNull();
  });

  test('should enable/disable a provider', async ({ vaultPage }) => {
    const id = await createMockProvider(vaultPage, { enabled: true });

    await vaultPage.evaluate(async (providerId) => {
      await window.vaultAPI!.providers.setEnabled(providerId, false);
    }, id);

    const provider = await vaultPage.evaluate(async (providerId) => {
      return window.vaultAPI!.providers.get(providerId);
    }, id);

    expect((provider as { enabled: boolean }).enabled).toBe(false);
  });

  test('should list enabled providers', async ({ vaultPage }) => {
    await createMockProvider(vaultPage, { name: 'Enabled', enabled: true });
    await createMockProvider(vaultPage, { name: 'Disabled', enabled: false });

    const enabled = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.providers.getEnabled();
    });

    expect(enabled).toHaveLength(1);
    expect((enabled[0] as { name: string }).name).toBe('Enabled');
  });

  test('isConfigured should return false when no providers enabled', async ({ vaultPage }) => {
    const configured = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.isConfigured();
    });

    expect(configured).toBe(false);
  });

  test('isConfigured should return true when provider is enabled', async ({ vaultPage }) => {
    await createMockProvider(vaultPage, { enabled: true });

    const configured = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.isConfigured();
    });

    expect(configured).toBe(true);
  });
});
