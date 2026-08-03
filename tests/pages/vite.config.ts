import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

function jsonResponse(response: import('http').ServerResponse, value: unknown): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.end(JSON.stringify(value));
}

async function readJson(request: import('http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function pageAgentProvider() {
  return {
    name: 'page-agent-provider',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/v1', async (request, response, next) => {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        if (request.method === 'OPTIONS') {
          response.statusCode = 204;
          response.end();
          return;
        }
        if (request.method === 'GET' && request.url === '/models') {
          jsonResponse(response, { object: 'list', data: [{ id: 'gpt-4o-mini', object: 'model', created: 1, owned_by: 'windowllm' }] });
          return;
        }
        if (request.method !== 'POST' || request.url !== '/chat/completions') {
          next();
          return;
        }

        const body = await readJson(request);
        const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
        const last = messages.at(-1);
        const previous = messages.at(-2);
        let message: Record<string, unknown> = { role: 'assistant', content: 'The iframe page element was updated.' };
        let finishReason = 'stop';

        if (last?.role === 'user' && last.content === 'Iframe page complete stays single-turn') {
          const tools = Array.isArray(body.tools) ? body.tools as Array<{ function?: { name?: string } }> : [];
          const leaked = tools.some(tool => tool.function?.name?.startsWith('windowllm_page_'));
          message = { role: 'assistant', content: leaked ? 'Page tools leaked into complete.' : 'Page tools stayed in run.' };
        } else if (last?.role === 'user' && last.content === 'Iframe E2E page agent') {
          message = {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'iframe_query',
              type: 'function',
              function: { name: 'windowllm_page_query_selector', arguments: '{"selector":"#iframe-agent-target"}' },
            }],
          };
          finishReason = 'tool_calls';
        } else if (last?.role === 'user' && last.content === 'Iframe E2E mutation matrix') {
          message = {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'iframe_matrix_query',
              type: 'function',
              function: {
                name: 'windowllm_page_query_selector_all',
                arguments: '{"selector":"#iframe-agent-controls > *"}',
              },
            }],
          };
          finishReason = 'tool_calls';
        } else if (last?.role === 'tool') {
          const calls = previous?.tool_calls as Array<{ function?: { name?: string } }> | undefined;
          if (calls?.[0]?.function?.name === 'windowllm_page_query_selector') {
            const queried = JSON.parse(String(last.content || '{}')) as { match: { ref: string } };
            message = {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'iframe_write',
                type: 'function',
                function: {
                  name: 'windowllm_page_set_text_content',
                  arguments: JSON.stringify({ ref: queried.match.ref, value: 'Changed through iframe mode' }),
                },
              }],
            };
            finishReason = 'tool_calls';
          } else if (calls?.[0]?.function?.name === 'windowllm_page_query_selector_all') {
            const queried = JSON.parse(String(last.content || '{}')) as { matches: Array<{ ref: string }> };
            const [button, input, text, attributes] = queried.matches;
            message = {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'iframe_matrix_click',
                  type: 'function',
                  function: { name: 'windowllm_page_click', arguments: JSON.stringify({ ref: button?.ref }) },
                },
                {
                  id: 'iframe_matrix_value',
                  type: 'function',
                  function: {
                    name: 'windowllm_page_set_value',
                    arguments: JSON.stringify({ ref: input?.ref, value: 'updated input' }),
                  },
                },
                {
                  id: 'iframe_matrix_text',
                  type: 'function',
                  function: {
                    name: 'windowllm_page_set_text_content',
                    arguments: JSON.stringify({ ref: text?.ref, value: 'updated text' }),
                  },
                },
                {
                  id: 'iframe_matrix_set_attribute',
                  type: 'function',
                  function: {
                    name: 'windowllm_page_set_attribute',
                    arguments: JSON.stringify({ ref: attributes?.ref, name: 'aria-live', value: 'polite' }),
                  },
                },
                {
                  id: 'iframe_matrix_remove_attribute',
                  type: 'function',
                  function: {
                    name: 'windowllm_page_remove_attribute',
                    arguments: JSON.stringify({ ref: attributes?.ref, name: 'data-remove' }),
                  },
                },
              ],
            };
            finishReason = 'tool_calls';
          }
        }

        jsonResponse(response, {
          id: `page-agent-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o-mini',
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
        });
      });
    },
  };
}

// Check if we have local certificates for HTTPS
const certsDir = resolve(__dirname, '../../.certs');
const hasLocalCerts = fs.existsSync(resolve(certsDir, 'key.pem')) &&
                       fs.existsSync(resolve(certsDir, 'cert.pem'));

export default defineConfig({
  root: __dirname,
  plugins: [pageAgentProvider()],
  server: {
    port: 3101,
    strictPort: true,
    // VITE_HOST_ALL binds all interfaces so a VM (Safari tests) can reach the
    // host via its gateway IP; otherwise host to the loopback hostname.
    host: process.env.VITE_HOST_ALL ? true : 'test.localhost',
    allowedHosts: ['.localhost', '.test'],
    ...(hasLocalCerts && {
      https: {
        key: fs.readFileSync(resolve(certsDir, 'key.pem')),
        cert: fs.readFileSync(resolve(certsDir, 'cert.pem')),
      },
    }),
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
