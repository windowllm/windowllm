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
    await window.vaultAPI!.providers.create({
      type: 'openai',
      name: 'Page Agent E2E Provider',
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://test.localhost:3101/v1',
      defaultModel: 'gpt-4o-mini',
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

  const pageAgent = await page.evaluate(async () => {
    const llm = (window as any).llm;
    let mixedToolsError = '';
    try {
      await llm.requestSession({
        model: 'openai/gpt-4o-mini',
        page: { access: 'read' },
        tools: [{ name: 'site_tool', description: 'site', parameters: { type: 'object', properties: {} } }],
      });
    } catch (error) {
      mixedToolsError = error instanceof Error ? error.message : String(error);
    }
    const session = await llm.requestSession({
      model: 'openai/gpt-4o-mini',
      page: { access: 'read-write', scope: '#iframe-agent-scope' },
    });
    const singleTurn = await session.complete('Iframe page complete stays single-turn');
    const result = await session.run('Iframe E2E page agent');
    return {
      text: document.querySelector('#iframe-agent-target')?.textContent,
      result,
      tools: session.tools.map((tool: { name: string }) => tool.name),
      mixedToolsError,
      singleTurn: singleTurn.message.content,
    };
  });

  expect(pageAgent.tools).toContain('windowllm_page_query_selector');
  expect(pageAgent.mixedToolsError).toContain('cannot be combined');
  expect(pageAgent.singleTurn).toBe('Page tools stayed in run.');
  expect(pageAgent.text, JSON.stringify(pageAgent.result, null, 2)).toBe('Changed through iframe mode');
  expect(pageAgent.result.steps).toBe(3);
  expect(pageAgent.result.stopReason).toBe('complete');
  expect(pageAgent.result.pageToolExecutions).toHaveLength(2);
  expect(pageAgent.result.message.content).toBe('The iframe page element was updated.');

  const mutationMatrix = await page.evaluate(async () => {
    const button = document.querySelector('#iframe-agent-button') as HTMLButtonElement;
    const input = document.querySelector('#iframe-agent-input') as HTMLInputElement;
    let clicks = 0;
    const events: string[] = [];
    button.addEventListener('click', () => { clicks += 1; });
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    const session = await (window as any).llm.requestSession({
      model: 'openai/gpt-4o-mini',
      page: { access: 'read-write', scope: '#iframe-agent-scope' },
    });
    const result = await session.run('Iframe E2E mutation matrix');
    const attributes = document.querySelector('#iframe-agent-attributes');
    return {
      clicks,
      events,
      inputValue: input.value,
      text: document.querySelector('#iframe-agent-text')?.textContent,
      ariaLive: attributes?.getAttribute('aria-live'),
      removed: !attributes?.hasAttribute('data-remove'),
      steps: result.steps,
      executions: result.pageToolExecutions.length,
      failures: result.pageToolExecutions.filter((execution: { result: { success: boolean } }) =>
        !execution.result.success),
    };
  });

  expect(mutationMatrix).toMatchObject({
    clicks: 1,
    events: ['input', 'change'],
    inputValue: 'updated input',
    text: 'updated text',
    ariaLive: 'polite',
    removed: true,
    steps: 3,
    executions: 6,
    failures: [],
  });
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
