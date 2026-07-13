function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForWindowLLM(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (globalThis.llm) return globalThis.llm;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('window.llm was not installed before the contract timeout');
}

/**
 * Browser-side contract shared by iframe and real-extension E2E runners.
 */
export async function runWindowLLMContract(options) {
  const {
    expectedProvider,
    expectedModelId,
    expectedCompletionText,
    scope = 'shared-api',
  } = options;
  const results = [];

  async function test(name, callback) {
    const startedAt = performance.now();
    try {
      await callback();
      results.push({ scope, name, status: 'pass', durationMs: Math.round(performance.now() - startedAt) });
    } catch (error) {
      results.push({
        scope,
        name,
        status: 'fail',
        error: errorMessage(error),
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  }

  const llm = await waitForWindowLLM();
  let selectedModel;
  let session;

  await test('API identity and surface', async () => {
    assert(llm.provider === expectedProvider, `expected provider ${expectedProvider}, got ${llm.provider}`);
    assert(llm.available === true, 'window.llm.available is not true');
    assert(typeof llm.requestSession === 'function', 'requestSession is missing');
    assert(typeof llm.models?.list === 'function', 'models.list is missing');
    assert(typeof llm.permissions?.query === 'function', 'permissions.query is missing');
    assert(typeof llm.capabilities?.has === 'function', 'capabilities.has is missing');
  });

  await test('permission query follows the Permissions API shape', async () => {
    const permission = await llm.permissions.query({ name: 'chat' });
    assert(permission instanceof EventTarget, 'permission status is not an EventTarget');
    assert(permission.state === 'granted', `expected granted permission, got ${permission.state}`);
    assert('onchange' in permission, 'permission status has no onchange property');
  });

  await test('permission request is idempotent when already granted', async () => {
    const permission = await llm.permissions.request({ name: 'chat' });
    assert(permission.state === 'granted', `expected granted permission, got ${permission.state}`);
  });

  await test('model registry lists, gets, and matches the configured model', async () => {
    const models = await llm.models.list();
    assert(Array.isArray(models) && models.length > 0, 'models.list returned no models');
    selectedModel = models.find(model => model.id === expectedModelId);
    assert(selectedModel, `model ${expectedModelId} was not returned`);

    const fetched = await llm.models.get(expectedModelId);
    assert(fetched?.id === expectedModelId, 'models.get did not return the selected model');

    const matches = await llm.models.match({ capabilities: { required: ['chat'] } });
    assert(matches.some(model => model.id === expectedModelId), 'models.match omitted the chat model');
  });

  await test('waitForReady resolves with a configured provider', async () => {
    await llm.waitForReady();
  });

  await test('session completion crosses the provider adapter', async () => {
    session = await llm.requestSession({ model: expectedModelId, systemPrompt: 'E2E system prompt' });
    assert(session.model?.id === expectedModelId, `session selected ${session.model?.id}`);
    const completion = await session.complete('Extension E2E completion');
    assert(
      completion.message?.content?.includes(expectedCompletionText),
      `unexpected completion: ${completion.message?.content}`,
    );
    assert(completion.usage?.totalTokens > 0, 'completion usage is missing');
  });

  await test('session streaming returns text and a terminal result', async () => {
    session ??= await llm.requestSession({ model: expectedModelId });
    const chunks = [];
    for await (const chunk of session.stream('Extension E2E stream')) {
      chunks.push(chunk);
      if (chunk.type === 'done') break;
    }
    const text = chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join('');
    const done = chunks.find(chunk => chunk.type === 'done');
    assert(text.includes(expectedCompletionText), `unexpected streamed text: ${text}`);
    assert(
      done?.result?.message?.content === text,
      `stream terminal result ${JSON.stringify(done?.result?.message?.content)} does not match ${JSON.stringify(text)}`,
    );
  });

  await test('session lifecycle methods remain usable after requests', async () => {
    assert(session, 'session was not initialized');
    const cloned = await session.clone();
    assert(cloned !== session, 'clone returned the original session object');
    assert(cloned.messages.length === session.messages.length, 'clone did not preserve message history');
    const clonedMessageCount = cloned.messages.length;
    session.reset();
    assert(session.messages.length === 0, 'reset did not clear message history');
    assert(cloned.messages.length === clonedMessageCount, 'reset mutated the cloned message history');
    cloned.destroy();
    session.destroy();
  });

  return results;
}
