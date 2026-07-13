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

  return results;
}
