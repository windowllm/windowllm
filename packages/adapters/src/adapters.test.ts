/**
 * Wire-level adapter tests.
 *
 * These mock `fetch` and feed real request/response shapes so they exercise the
 * exact seams that broke before: model-id prefix stripping, the Anthropic
 * Models API, Ollama's object-shaped tool arguments, OpenAI's usage-only final
 * SSE chunk, and multi-byte UTF-8 split across stream reads. The mock adapter
 * cannot catch any of these — only wire-level tests can.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAnthropicAdapter } from './anthropic.js';
import { createOpenAIAdapter } from './openai.js';
import { createOllamaAdapter } from './ollama.js';
import { createGeminiAdapter } from './gemini.js';
import type { NormalizedChunk } from './index.js';

const enc = new TextEncoder();

function jsonResponse(obj: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => obj } as unknown as Response;
}

function streamResponse(parts: Array<string | Uint8Array>, status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(typeof p === 'string' ? enc.encode(p) : p);
      controller.close();
    },
  });
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), body } as unknown as Response;
}

async function collect(iter: AsyncIterable<NormalizedChunk>): Promise<NormalizedChunk[]> {
  const out: NormalizedChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('Anthropic adapter', () => {
  it('lists models from the live Models API', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      data: [{
        id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8',
        max_input_tokens: 1_000_000, max_tokens: 128_000,
        capabilities: { image_input: { supported: true }, structured_outputs: { supported: true } },
      }],
    })) as typeof fetch;

    const a = createAnthropicAdapter({ apiKey: 'k' });
    const models = await a.listModels();
    expect(models[0]!.id).toBe('anthropic/claude-opus-4-8');
    expect(models[0]!.limits.contextWindow).toBe(1_000_000);
    expect(models[0]!.capabilities.jsonMode).toBe(true);
  });

  it('strips the anthropic/ prefix from the request body', async () => {
    let sent: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      sent = JSON.parse(init.body);
      return jsonResponse({
        id: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'hi' }],
        model: 'claude-opus-4-8', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }) as typeof fetch;

    const a = createAnthropicAdapter({ apiKey: 'k' });
    const res = await a.complete({ model: 'anthropic/claude-opus-4-8', messages: [{ role: 'user', content: 'hey' }] });
    expect(sent.model).toBe('claude-opus-4-8');
    expect(res.message.content).toBe('hi');
  });

  it('reassembles multi-byte UTF-8 split across stream reads', async () => {
    const line = 'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '😀' } }) + '\n';
    const bytes = enc.encode(line);
    const mid = Math.floor(bytes.length / 2); // split lands mid-multibyte
    globalThis.fetch = vi.fn(async () => streamResponse([
      bytes.slice(0, mid),
      bytes.slice(mid),
      'data: {"type":"message_stop"}\n',
    ])) as typeof fetch;

    const a = createAnthropicAdapter({ apiKey: 'k' });
    const chunks = await collect(a.stream({ model: 'anthropic/claude-opus-4-8', messages: [{ role: 'user', content: 'x' }] }));
    expect(chunks.find(c => c.type === 'text')?.content).toBe('😀');
  });
});

describe('OpenAI adapter', () => {
  it('strips the openai/ prefix and sends max_completion_tokens', async () => {
    let sent: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      sent = JSON.parse(init.body);
      return jsonResponse({
        id: 'x', object: 'chat.completion', created: 0, model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;

    const o = createOpenAIAdapter({ apiKey: 'k' });
    await o.complete({ model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'x' }], maxTokens: 50 });
    expect(sent.model).toBe('gpt-4o');
    expect(sent.max_completion_tokens).toBe(50);
    expect(sent.max_tokens).toBeUndefined();
  });

  it('yields the usage-only final chunk (empty choices)', async () => {
    globalThis.fetch = vi.fn(async () => streamResponse([
      'data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n',
      'data: [DONE]\n',
    ])) as typeof fetch;

    const o = createOpenAIAdapter({ apiKey: 'k' });
    const chunks = await collect(o.stream({ model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'x' }] }));
    expect(chunks.find(c => c.type === 'usage')?.usage?.totalTokens).toBe(8);
  });

  it("sends reasoning_effort 'none' for a reasoning model with tools, but not for gpt-4o", async () => {
    let sent: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      sent = JSON.parse(init.body);
      return jsonResponse({
        id: 'x', object: 'chat.completion', created: 0, model: sent.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;

    const tools = [{ name: 'get_weather', description: 'w', parameters: { type: 'object' as const, properties: {} } }];
    const o = createOpenAIAdapter({ apiKey: 'k' });

    // Reasoning model (gpt-5.6-luna) + tools → must opt out of the default effort.
    await o.complete({ model: 'openai/gpt-5.6-luna', messages: [{ role: 'user', content: 'x' }], tools });
    expect(sent.reasoning_effort).toBe('none');

    // Non-reasoning model rejects the field entirely, so it must be absent.
    await o.complete({ model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'x' }], tools });
    expect(sent.reasoning_effort).toBeUndefined();

    // And absent even for a reasoning model when no tools are requested.
    await o.complete({ model: 'openai/gpt-5.6-luna', messages: [{ role: 'user', content: 'x' }] });
    expect(sent.reasoning_effort).toBeUndefined();
  });

  it('maps HTTP 429 to a retryable rate-limit error', async () => {
    globalThis.fetch = vi.fn(async () => {
      const h = new Headers({ 'retry-after': '2' });
      return { ok: false, status: 429, headers: h, json: async () => ({ error: { message: 'slow down' } }) } as unknown as Response;
    }) as typeof fetch;

    const o = createOpenAIAdapter({ apiKey: 'k' });
    await expect(o.complete({ model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true, retryAfter: 2000 });
  });
});

describe('Ollama adapter', () => {
  it('parses object-shaped tool arguments without crashing', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      model: 'llama3.1', created_at: '',
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Paris' } } }] },
      done: true, done_reason: 'tool_calls', prompt_eval_count: 1, eval_count: 1,
    })) as typeof fetch;

    const ol = createOllamaAdapter({});
    const res = await ol.complete({ model: 'ollama/llama3.1', messages: [{ role: 'user', content: 'x' }] });
    expect(res.message.toolCalls?.[0]!.arguments).toEqual({ city: 'Paris' });
    expect(res.message.toolCalls?.[0]!.id).toContain('get_weather');
  });

  it('strips the ollama/ prefix from the request body', async () => {
    let sent: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      sent = JSON.parse(init.body);
      return jsonResponse({ model: 'llama3.1', created_at: '', message: { role: 'assistant', content: 'hi' }, done: true });
    }) as typeof fetch;

    const ol = createOllamaAdapter({});
    await ol.complete({ model: 'ollama/llama3.1:8b', messages: [{ role: 'user', content: 'x' }] });
    expect(sent.model).toBe('llama3.1:8b');
  });
});

describe('Gemini adapter', () => {
  it('lists models supporting generateContent and namespaces ids', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      models: [
        { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', inputTokenLimit: 1000000, outputTokenLimit: 8192, supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
      ],
    })) as typeof fetch;

    const g = createGeminiAdapter({ apiKey: 'k' });
    const models = await g.listModels();
    expect(models).toHaveLength(1); // embedding-only model filtered out
    expect(models[0]!.id).toBe('gemini/gemini-2.0-flash');
    expect(models[0]!.limits.contextWindow).toBe(1000000);
  });

  it('strips the prefix into the model path and parses the response', async () => {
    let url: any;
    globalThis.fetch = vi.fn(async (u) => {
      url = String(u);
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
      });
    }) as typeof fetch;

    const g = createGeminiAdapter({ apiKey: 'k' });
    const res = await g.complete({ model: 'gemini/gemini-2.0-flash', messages: [{ role: 'user', content: 'x' }] });
    expect(url).toContain('/models/gemini-2.0-flash:generateContent');
    expect(res.message.content).toBe('hi');
    expect(res.usage.totalTokens).toBe(5);
  });

  it('correlates tool results with the original function name', async () => {
    let sent: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      sent = JSON.parse(init.body);
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      });
    }) as typeof fetch;

    const g = createGeminiAdapter({ apiKey: 'k' });
    await g.complete({
      model: 'gemini/gemini-2.0-flash',
      messages: [
        { role: 'user', content: 'inspect' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_0_page_query', name: 'page_query', arguments: { selector: '#status' } }],
        },
        { role: 'tool', toolCallId: 'call_0_page_query', content: '{"match":null}' },
      ],
    });

    expect(sent.contents[2].parts[0].functionResponse.name).toBe('page_query');
  });
});
