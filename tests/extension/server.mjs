import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pageDir = resolve(root, 'tests/extension/page');
const sharedContract = resolve(root, 'tests/pages/window-llm-contract.mjs');

const model = {
  name: 'extension-e2e',
  model: 'extension-e2e',
  modified_at: '2026-01-01T00:00:00Z',
  size: 1,
  digest: 'extension-e2e',
  details: {
    parent_model: '',
    format: 'gguf',
    family: 'qwen',
    families: ['qwen'],
    parameter_size: '1B',
    quantization_level: 'Q4_0',
  },
};

function json(response, status, value) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function serveFile(response, path, contentType) {
  try {
    const content = await readFile(path);
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': contentType,
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

export async function startExtensionE2EServer({ port = 3199, resultFile } = {}) {
  const metrics = { tags: 0, completions: 0, streams: 0 };
  let resolveResult;
  const result = new Promise(resolve => { resolveResult = resolve; });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    if (process.env.EXTENSION_E2E_VERBOSE) {
      console.error(`[extension-e2e] ${request.method} ${url.pathname}${url.search}`);
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Origin': '*',
      });
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      await serveFile(response, resolve(pageDir, 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/window-llm-contract.mjs') {
      await serveFile(response, sharedContract, 'text/javascript; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/extension-contract.mjs') {
      await serveFile(response, resolve(pageDir, 'extension-contract.mjs'), 'text/javascript; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/tags') {
      metrics.tags += 1;
      json(response, 200, { models: [model] });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/chat') {
      const body = await requestBody(request);
      if (body.stream) {
        metrics.streams += 1;
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/x-ndjson',
        });
        response.write(`${JSON.stringify({
          model: 'extension-e2e',
          message: { role: 'assistant', content: 'Extension E2E ' },
          done: false,
        })}\n`);
        response.write(`${JSON.stringify({
          model: 'extension-e2e',
          message: { role: 'assistant', content: 'response' },
          done: false,
        })}\n`);
        response.end(`${JSON.stringify({
          model: 'extension-e2e',
          message: { role: 'assistant', content: '' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 4,
          eval_count: 3,
        })}\n`);
      } else {
        metrics.completions += 1;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const lastMessage = messages.at(-1);
        if (lastMessage?.role === 'user' && lastMessage.content === 'Extension page complete stays single-turn') {
          const tools = Array.isArray(body.tools) ? body.tools : [];
          const leaked = tools.some(tool => tool.function?.name?.startsWith('windowllm_page_'));
          json(response, 200, {
            model: 'extension-e2e',
            message: { role: 'assistant', content: leaked ? 'Page tools leaked into complete.' : 'Page tools stayed in run.' },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 4,
            eval_count: 3,
          });
          return;
        }
        if (lastMessage?.role === 'user' && lastMessage.content === 'Extension E2E aborted page agent') {
          const priorQueryResult = messages.find(message => {
            if (message.role !== 'tool') return false;
            try {
              return Boolean(JSON.parse(message.content || '{}').match?.ref);
            } catch {
              return false;
            }
          });
          const ref = JSON.parse(priorQueryResult?.content || '{}').match?.ref;
          await new Promise(resolve => setTimeout(resolve, 75));
          json(response, 200, {
            model: 'extension-e2e',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                function: {
                  name: 'windowllm_page_set_text_content',
                  arguments: { ref, value: 'This mutation must be cancelled' },
                },
              }],
            },
            done: true,
            done_reason: 'tool_calls',
            prompt_eval_count: 4,
            eval_count: 3,
          });
          return;
        }
        if (lastMessage?.role === 'user' && lastMessage.content === 'Extension E2E page agent') {
          json(response, 200, {
            model: 'extension-e2e',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                function: {
                  name: 'windowllm_page_query_selector',
                  arguments: { selector: '#page-agent-target' },
                },
              }],
            },
            done: true,
            done_reason: 'tool_calls',
            prompt_eval_count: 4,
            eval_count: 3,
          });
          return;
        }
        if (lastMessage?.role === 'user' && lastMessage.content === 'Extension E2E mutation matrix') {
          json(response, 200, {
            model: 'extension-e2e',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                function: {
                  name: 'windowllm_page_query_selector_all',
                  arguments: { selector: '#page-agent-controls > *' },
                },
              }],
            },
            done: true,
            done_reason: 'tool_calls',
            prompt_eval_count: 4,
            eval_count: 3,
          });
          return;
        }
        if (lastMessage?.role === 'tool') {
          const previousCall = messages.at(-2)?.tool_calls?.[0]?.function?.name;
          if (previousCall === 'windowllm_page_query_selector') {
            const queried = JSON.parse(lastMessage.content || '{}');
            json(response, 200, {
              model: 'extension-e2e',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{
                  function: {
                    name: 'windowllm_page_set_text_content',
                    arguments: { ref: queried.match.ref, value: 'Changed by the local page agent' },
                  },
                }],
              },
              done: true,
              done_reason: 'tool_calls',
              prompt_eval_count: 4,
              eval_count: 3,
            });
            return;
          }
          if (previousCall === 'windowllm_page_query_selector_all') {
            const queried = JSON.parse(lastMessage.content || '{}');
            const [button, input, text, attributes] = queried.matches;
            json(response, 200, {
              model: 'extension-e2e',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    function: {
                      name: 'windowllm_page_click',
                      arguments: { ref: button.ref },
                    },
                  },
                  {
                    function: {
                      name: 'windowllm_page_set_value',
                      arguments: { ref: input.ref, value: 'updated input' },
                    },
                  },
                  {
                    function: {
                      name: 'windowllm_page_set_text_content',
                      arguments: { ref: text.ref, value: 'updated text' },
                    },
                  },
                  {
                    function: {
                      name: 'windowllm_page_set_attribute',
                      arguments: { ref: attributes.ref, name: 'aria-live', value: 'polite' },
                    },
                  },
                  {
                    function: {
                      name: 'windowllm_page_remove_attribute',
                      arguments: { ref: attributes.ref, name: 'data-remove' },
                    },
                  },
                ],
              },
              done: true,
              done_reason: 'tool_calls',
              prompt_eval_count: 4,
              eval_count: 3,
            });
            return;
          }
          if (previousCall === 'windowllm_page_set_text_content') {
            json(response, 200, {
              model: 'extension-e2e',
              message: { role: 'assistant', content: 'The page element was updated.' },
              done: true,
              done_reason: 'stop',
              prompt_eval_count: 4,
              eval_count: 3,
            });
            return;
          }
        }
        json(response, 200, {
          model: 'extension-e2e',
          message: { role: 'assistant', content: 'Extension E2E response' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 4,
          eval_count: 3,
        });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/results') {
      const report = await requestBody(request);
      if (resultFile) await writeFile(resultFile, `${JSON.stringify(report, null, 2)}\n`);
      resolveResult(report);
      json(response, 200, { ok: true });
      return;
    }

    response.writeHead(404);
    response.end('Not found');
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });

  return {
    metrics,
    result,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolveClose, reject) => {
      server.close(error => error ? reject(error) : resolveClose());
      server.closeAllConnections?.();
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3199);
  const running = await startExtensionE2EServer({ port, resultFile: process.env.RESULT_FILE });
  console.log(`[extension-e2e] server listening at ${running.url}`);

  const close = async () => {
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
