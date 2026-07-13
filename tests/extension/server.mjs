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
    family: 'llama',
    families: ['llama'],
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
