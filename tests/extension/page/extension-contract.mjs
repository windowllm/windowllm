function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runExtensionContract() {
  const results = [];

  async function test(name, callback) {
    const startedAt = performance.now();
    try {
      await callback();
      results.push({
        scope: 'extension-runtime',
        name,
        status: 'pass',
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      results.push({
        scope: 'extension-runtime',
        name,
        status: 'fail',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  }

  await test('injects before the page first script', async () => {
    assert(globalThis.__windowllmAtFirstScript === true, 'window.llm was absent at the page first script');
  });

  await test('installs the extension provider as a hardened global', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'llm');
    assert(globalThis.llm?.provider === 'extension', 'the extension provider did not win injection');
    assert(descriptor?.writable === false, 'window.llm is writable');
    assert(descriptor?.configurable === false, 'window.llm is configurable');
  });

  await test('uses the background runtime rather than the iframe fallback', async () => {
    const fallbackFrame = [...document.querySelectorAll('iframe')].find(frame =>
      frame.src.includes('frame.html'),
    );
    assert(!fallbackFrame, 'the iframe fallback was created while extension mode was active');
    const models = await globalThis.llm.models.list();
    assert(models.some(model => model.id === 'ollama/extension-e2e'), 'background model bridge is unavailable');
  });

  await test('runs CSS query and write tools in the isolated content script', async () => {
    let mixedToolsError = '';
    try {
      await globalThis.llm.requestSession({
        model: 'ollama/extension-e2e',
        page: { access: 'read' },
        tools: [{ name: 'site_tool', description: 'site', parameters: { type: 'object', properties: {} } }],
      });
    } catch (error) {
      mixedToolsError = error instanceof Error ? error.message : String(error);
    }
    assert(mixedToolsError.includes('cannot be combined'), 'mixed site/page tools were not rejected');

    const session = await globalThis.llm.requestSession({
      model: 'ollama/extension-e2e',
      page: { access: 'read-write', scope: '#page-agent-fixture' },
    });
    assert(
      session.tools.some(tool => tool.name === 'windowllm_page_query_selector'),
      'querySelector page tool was not registered',
    );
    const singleTurn = await session.complete('Extension page complete stays single-turn');
    assert(singleTurn.message.content === 'Page tools stayed in run.', 'complete() advertised page tools');
    const result = await session.run('Extension E2E page agent');
    assert(result.steps === 3, `expected three agent steps, got ${result.steps}`);
    assert(result.stopReason === 'complete', `unexpected stop reason: ${result.stopReason}`);
    assert(result.pageToolExecutions.length === 2, 'page tool execution trace is incomplete');
    assert(
      document.querySelector('#page-agent-target')?.textContent === 'Changed by the local page agent',
      'page write did not affect the local DOM',
    );
    assert(result.message.content === 'The page element was updated.', 'agent did not return its final answer');

    const controller = new AbortController();
    const abortedRun = session.run('Extension E2E aborted page agent', { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    let abortError;
    try {
      await abortedRun;
    } catch (error) {
      abortError = error;
    }
    assert(abortError?.name === 'AbortError', 'an active page run did not reject with AbortError');
    assert(
      document.querySelector('#page-agent-target')?.textContent === 'Changed by the local page agent',
      'a page mutation ran after cancellation',
    );
  });

  await test('executes every mutation tool against the real page DOM', async () => {
    const button = document.querySelector('#page-agent-button');
    const input = document.querySelector('#page-agent-input');
    let clicks = 0;
    const events = [];
    button.addEventListener('click', () => { clicks += 1; });
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    const session = await globalThis.llm.requestSession({
      model: 'ollama/extension-e2e',
      page: { access: 'read-write', scope: '#page-agent-fixture' },
    });
    const result = await session.run('Extension E2E mutation matrix');
    const attributes = document.querySelector('#page-agent-attributes');

    assert(clicks === 1, `expected one click, got ${clicks}`);
    assert(events.join(',') === 'input,change', `unexpected value events: ${events.join(',')}`);
    assert(input.value === 'updated input', `unexpected input value: ${input.value}`);
    assert(document.querySelector('#page-agent-text')?.textContent === 'updated text', 'text was not updated');
    assert(attributes?.getAttribute('aria-live') === 'polite', 'safe attribute was not set');
    assert(!attributes?.hasAttribute('data-remove'), 'safe attribute was not removed');
    assert(result.steps === 3, `expected three agent steps, got ${result.steps}`);
    assert(result.pageToolExecutions.length === 6, 'mutation execution trace is incomplete');
    assert(
      result.pageToolExecutions.every(execution => execution.result.success),
      'a mutation tool execution failed',
    );
  });

  return results;
}
