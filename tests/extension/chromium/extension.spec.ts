import { expect, test } from './fixtures';

interface ContractResult {
  readonly done: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly tests: ReadonlyArray<{
    readonly scope: string;
    readonly name: string;
    readonly status: 'pass' | 'fail';
    readonly error?: string;
  }>;
}

test('real extension satisfies the shared API and extension runtime contracts', async ({ page }) => {
  await page.goto('http://127.0.0.1:3199/?runner=chromium');
  await page.waitForFunction(() => Boolean((window as any).__windowllmExtensionE2E?.done));

  const result = await page.evaluate(() => (window as any).__windowllmExtensionE2E) as ContractResult;
  expect(result.tests.filter(contract => contract.status === 'fail')).toEqual([]);
  expect(result.failed).toBe(0);
  expect(result.passed).toBe(11);
});

test('Chrome MV3 worker and extension-owned UI load', async ({ context, extensionId, serviceWorker }) => {
  const pageErrors: string[] = [];
  const manifest = await serviceWorker.evaluate(() => (globalThis as any).chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.background.service_worker).toBe('background.js');

  await expect.poll(() => context.pages().some(candidate => candidate.url().endsWith('/options.html'))).toBe(true);
  const installedOptionsPage = context.pages().find(candidate => candidate.url().endsWith('/options.html'))!;
  installedOptionsPage.on('pageerror', error => pageErrors.push(error.message));
  await expect(
    installedOptionsPage.getByText('Set Up Your Vault', { exact: true }),
    `options errors: ${pageErrors.join('; ')}; body: ${await installedOptionsPage.locator('body').innerText()}`,
  ).toBeVisible();

  const popupPage = await context.newPage();
  popupPage.on('pageerror', error => pageErrors.push(error.message));
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    popupPage.getByText('Set Up Your Vault', { exact: true }),
    `popup errors: ${pageErrors.join('; ')}; body: ${await popupPage.locator('body').innerText()}`,
  ).toBeVisible();
});
