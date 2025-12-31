import { test, expect, clearVault, grantTestPermission } from '../fixtures/vault.fixture';

test.describe('Vault Permission Operations', () => {
  test.beforeEach(async ({ vaultPage }) => {
    await clearVault(vaultPage);
  });

  test('should list permissions (empty)', async ({ vaultPage }) => {
    const permissions = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.list();
    });

    expect(permissions).toEqual([]);
  });

  test('should grant permission', async ({ vaultPage }) => {
    await vaultPage.evaluate(async () => {
      await window.vaultAPI!.permissions.grant({
        origin: 'https://example.com',
        capabilities: ['chat', 'streaming'],
        grantedAt: Date.now(),
      });
    });

    const permissions = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.list();
    });

    expect(permissions).toHaveLength(1);
    expect((permissions[0] as { origin: string }).origin).toBe('https://example.com');
  });

  test('should get permission by origin', async ({ vaultPage }) => {
    await grantTestPermission(vaultPage, 'https://example.com');

    const permission = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.get('https://example.com');
    });

    expect(permission).toMatchObject({
      origin: 'https://example.com',
      capabilities: ['chat', 'streaming'],
    });
  });

  test('should return null for unknown origin', async ({ vaultPage }) => {
    const permission = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.get('https://unknown.com');
    });

    expect(permission).toBeNull();
  });

  test('should revoke permission', async ({ vaultPage }) => {
    await grantTestPermission(vaultPage, 'https://example.com');

    await vaultPage.evaluate(async () => {
      await window.vaultAPI!.permissions.revoke('https://example.com');
    });

    const permission = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.get('https://example.com');
    });

    expect(permission).toBeNull();
  });

  test('should check capability (granted)', async ({ vaultPage }) => {
    await grantTestPermission(vaultPage, 'https://example.com');

    const hasChat = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.check('https://example.com', 'chat');
    });

    expect(hasChat).toBe(true);
  });

  test('should check capability (not granted)', async ({ vaultPage }) => {
    await grantTestPermission(vaultPage, 'https://example.com');

    const hasVision = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.check('https://example.com', 'vision');
    });

    expect(hasVision).toBe(false);
  });

  test('should check capability (unknown origin)', async ({ vaultPage }) => {
    const hasChat = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.check('https://unknown.com', 'chat');
    });

    expect(hasChat).toBe(false);
  });

  test('should update existing permission', async ({ vaultPage }) => {
    await grantTestPermission(vaultPage, 'https://example.com');

    // Update with additional capabilities
    await vaultPage.evaluate(async () => {
      await window.vaultAPI!.permissions.grant({
        origin: 'https://example.com',
        capabilities: ['chat', 'streaming', 'vision'],
        grantedAt: Date.now(),
      });
    });

    const hasVision = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.check('https://example.com', 'vision');
    });

    expect(hasVision).toBe(true);
  });

  test('should handle multiple origins', async ({ vaultPage }) => {
    await grantTestPermission(vaultPage, 'https://site1.com');
    await grantTestPermission(vaultPage, 'https://site2.com');
    await grantTestPermission(vaultPage, 'https://site3.com');

    const permissions = await vaultPage.evaluate(async () => {
      return window.vaultAPI!.permissions.list();
    });

    expect(permissions).toHaveLength(3);
  });
});
