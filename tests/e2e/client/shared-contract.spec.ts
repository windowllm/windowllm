import { expect, test } from '@playwright/test';

interface ContractResult {
  readonly status: 'pass' | 'fail';
  readonly name: string;
}

test('iframe mode satisfies the shared window.llm contract', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const vaultPage = await context.newPage();

  await vaultPage.goto('https://windowllm.localhost:3100');
  await vaultPage.waitForFunction(() => window.vaultAPI !== undefined);
  await vaultPage.evaluate(async () => {
    await window.vaultAPI!.providers.create({
      type: 'mock',
      name: 'Shared Contract Provider',
      enabled: true,
      defaultModel: 'mock/test-model',
    });
    await window.vaultAPI!.permissions.grant({
      origin: 'https://test.localhost:3101',
      capabilities: ['chat', 'streaming'],
      grantedAt: Date.now(),
    });
  });

  const page = await context.newPage();
  await page.goto('https://test.localhost:3101/contract.html');
  await page.waitForFunction(() => typeof (window as any).llm !== 'undefined');

  const results = await page.evaluate(async () => {
    const contractUrl = new URL('/window-llm-contract.mjs', location.href).href;
    const { runWindowLLMContract } = await import(contractUrl);
    return runWindowLLMContract({
      expectedProvider: 'iframe',
      expectedModelId: 'mock/mock/test-model',
      expectedCompletionText: 'mock response',
    });
  }) as ContractResult[];

  expect(results.filter(result => result.status === 'fail')).toEqual([]);
  expect(results).toHaveLength(8);
  await context.close();
});

declare global {
  interface Window {
    vaultAPI?: {
      providers: { create(config: unknown): Promise<unknown> };
      permissions: { grant(permission: unknown): Promise<void> };
    };
  }
}
