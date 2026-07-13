import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { resolve } from 'node:path';

interface ExtensionFixtures {
  readonly context: BrowserContext;
  readonly extensionId: string;
  readonly serviceWorker: Worker;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use, testInfo) => {
    const extensionPath = resolve(process.cwd(), 'packages/extension/dist');
    const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    await use(serviceWorker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = new URL(serviceWorker.url()).host;
    await use(extensionId);
  },
});

export { expect } from '@playwright/test';
