/**
 * OpenAI-Compatible Adapter
 *
 * Works with OpenAI, Azure OpenAI, OpenRouter, and other OpenAI-compatible APIs
 */

import type {
  Message,
  ToolDefinition,
  ToolCall,
  LLMModel,
  ModelCapabilities,
  ModelLimits,
  ContentPart,
} from '@windowllm/types';

import type {
  ProviderAdapter,
  ProviderConfig,
  NormalizedRequest,
  NormalizedResponse,
  NormalizedChunk,
} from './index.js';
import { mapHttpError } from './index.js';

/**
 * OpenAI-specific configuration
 */
export interface OpenAIConfig extends ProviderConfig {
  organization?: string;
}

/**
 * OpenAI API message format
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

interface OpenAICompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

// Compact capability builder for the known-model table below.
const cap = (o: Partial<ModelCapabilities> = {}): ModelCapabilities => ({
  chat: true, streaming: true, vision: false, tools: true, embeddings: false,
  jsonMode: true, systemPrompt: true, multiTurn: true, audioInput: false, audioOutput: false,
  ...o,
});

// Chat/embedding filter for the live /v1/models response. Includes the GPT and
// o-series (reasoning) families; excludes audio/image/moderation/instruct variants.
function isChatOrEmbeddingModel(id: string): boolean {
  if (/embedding/.test(id)) return true;
  if (!/^(gpt-|chatgpt-|o1|o3|o4)/.test(id)) return false;
  if (/(audio|realtime|transcribe|tts|whisper|dall-e|moderation|image|instruct)/.test(id)) return false;
  // Hide dated snapshots (gpt-4o-2024-05-13, gpt-4-0613, gpt-4-1106-preview) so the
  // list stays clean and fast; a pinned snapshot is still usable by its exact id.
  if (/\d{4}-\d{2}-\d{2}/.test(id)) return false;
  if (/-\d{4}(-preview)?$/.test(id)) return false;
  return true;
}

// Reasoning families — the o-series (o1/o3/o4/…) and gpt-5-and-newer. These apply
// a default reasoning_effort server-side; the rest (gpt-4o, gpt-4.1, gpt-3.5) are
// not reasoning models and reject the reasoning_effort field outright. Used only
// to opt out of that default when function tools are present (see buildRequestBody).
function isReasoningModel(id: string): boolean {
  return /^o\d/.test(id) || /^gpt-([5-9]|\d\d)/.test(id);
}

// Hand-maintained fallback list, used ONLY when GET /v1/models is unreachable
// (no key / offline). OpenAI has no public unauthenticated model list, so this is
// a static snapshot; entries built from it are marked fallback:true for the UI.
const OPENAI_FALLBACK_MODELS = [
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini',
  'o3', 'o4-mini', 'o3-mini', 'o1', 'gpt-3.5-turbo',
];

/**
 * Well-known OpenAI models with their capabilities. Ordered most-specific-first
 * so findKnownModel()'s prefix match resolves e.g. gpt-4.1 before gpt-4.
 */
const KNOWN_MODELS: Record<string, { capabilities: ModelCapabilities; limits: ModelLimits }> = {
  'gpt-4.1-nano': { capabilities: cap({ vision: true }), limits: { contextWindow: 1047576, maxOutputTokens: 32768, maxImageCount: 20 } },
  'gpt-4.1-mini': { capabilities: cap({ vision: true }), limits: { contextWindow: 1047576, maxOutputTokens: 32768, maxImageCount: 20 } },
  'gpt-4.1': { capabilities: cap({ vision: true }), limits: { contextWindow: 1047576, maxOutputTokens: 32768, maxImageCount: 20 } },
  'o4-mini': { capabilities: cap({ vision: true }), limits: { contextWindow: 200000, maxOutputTokens: 100000, maxImageCount: 20 } },
  'o3-mini': { capabilities: cap(), limits: { contextWindow: 200000, maxOutputTokens: 100000 } },
  'o3': { capabilities: cap({ vision: true }), limits: { contextWindow: 200000, maxOutputTokens: 100000, maxImageCount: 20 } },
  'o1-mini': { capabilities: cap(), limits: { contextWindow: 128000, maxOutputTokens: 65536 } },
  'o1': { capabilities: cap({ vision: true }), limits: { contextWindow: 200000, maxOutputTokens: 100000, maxImageCount: 20 } },
  'gpt-4o': {
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: true,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      maxImageCount: 20,
    },
  },
  'gpt-4o-mini': {
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: true,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      maxImageCount: 20,
    },
  },
  'gpt-4-turbo': {
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: true,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 128000,
      maxOutputTokens: 4096,
      maxImageCount: 20,
    },
  },
  'gpt-4': {
    capabilities: {
      chat: true,
      streaming: true,
      vision: false,
      tools: true,
      embeddings: false,
      jsonMode: true,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 8192,
      maxOutputTokens: 4096,
    },
  },
  'gpt-3.5-turbo': {
    capabilities: {
      chat: true,
      streaming: true,
      vision: false,
      tools: true,
      embeddings: false,
      jsonMode: true,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 16385,
      maxOutputTokens: 4096,
    },
  },
  'text-embedding-3-small': {
    capabilities: {
      chat: false,
      streaming: false,
      vision: false,
      tools: false,
      embeddings: true,
      jsonMode: false,
      systemPrompt: false,
      multiTurn: false,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 8191,
      maxOutputTokens: 0,
      embeddingDimensions: 1536,
    },
  },
  'text-embedding-3-large': {
    capabilities: {
      chat: false,
      streaming: false,
      vision: false,
      tools: false,
      embeddings: true,
      jsonMode: false,
      systemPrompt: false,
      multiTurn: false,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 8191,
      maxOutputTokens: 0,
      embeddingDimensions: 3072,
    },
  },
};

/**
 * OpenAI-compatible provider adapter
 */
export class OpenAIAdapter implements ProviderAdapter {
  readonly id: string;
  readonly name: string;
  // As of 2026 api.openai.com sends CORS headers, so browser-direct works
  // (undocumented; error responses may be opaque). Custom baseUrl proxies also.
  readonly browserDirect = true;
  private config: OpenAIConfig;
  private baseUrl: string;

  constructor(config: OpenAIConfig, id = 'openai', name = 'OpenAI') {
    this.id = id;
    this.name = name;
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    if (this.config.organization) {
      headers['OpenAI-Organization'] = this.config.organization;
    }

    return headers;
  }

  async listModels(): Promise<LLMModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.statusText}`);
      }

      const data = await response.json() as { data: OpenAIModelInfo[] };
      const models: LLMModel[] = [];

      // Newest first (by the API's `created` timestamp) so consumers that pick
      // the first model default to a current one, not an old gpt-3.5-turbo.
      const sorted = [...data.data].sort((a, b) => (b.created || 0) - (a.created || 0));
      for (const model of sorted) {
        if (!isChatOrEmbeddingModel(model.id)) continue;
        const known = this.findKnownModel(model.id);
        models.push({
          id: `${this.id}/${model.id}`,
          name: this.formatModelName(model.id),
          provider: this.id,
          capabilities: known?.capabilities || this.defaultCapabilities(model.id),
          limits: known?.limits || this.defaultLimits(model.id),
        });
      }

      // Some proxies hide /v1/models; if nothing usable came back, fall back.
      return models.length > 0 ? models : this.fallbackModels();
    } catch {
      return this.fallbackModels();
    }
  }

  /** Static, hand-maintained list used only when /v1/models is unreachable. */
  private fallbackModels(): LLMModel[] {
    return OPENAI_FALLBACK_MODELS.map((id) => {
      const known = this.findKnownModel(id);
      return {
        id: `${this.id}/${id}`,
        name: this.formatModelName(id),
        provider: this.id,
        capabilities: known?.capabilities || this.defaultCapabilities(id),
        limits: known?.limits || this.defaultLimits(id),
        fallback: true,
      };
    });
  }

  async getModel(id: string): Promise<LLMModel | null> {
    // Strip provider prefix if present
    const modelId = id.startsWith(`${this.id}/`) ? id.slice(this.id.length + 1) : id;
    const known = this.findKnownModel(modelId);

    if (known) {
      return {
        id: `${this.id}/${modelId}`,
        name: this.formatModelName(modelId),
        provider: this.id,
        capabilities: known.capabilities,
        limits: known.limits,
      };
    }

    // Try to fetch from API
    const models = await this.listModels();
    return models.find(m => m.id === id || m.id === `${this.id}/${modelId}`) || null;
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const body = this.buildRequestBody(request);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw mapHttpError(response.status, error.error?.message || response.statusText, response.headers);
    }

    const data = await response.json() as OpenAICompletionResponse;
    return this.parseResponse(data);
  }

  async *stream(request: NormalizedRequest): AsyncIterable<NormalizedChunk> {
    const body = this.buildRequestBody(request);
    body.stream = true;
    body.stream_options = { include_usage: true };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw mapHttpError(response.status, error.error?.message || response.statusText, response.headers);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            yield { type: 'done' };
            continue;
          }

          try {
            const chunk = JSON.parse(data) as OpenAIStreamChunk;

            // Usage arrives (with stream_options.include_usage) on a final
            // chunk whose `choices` array is empty — handle it BEFORE the
            // empty-choices guard below, or token accounting is lost.
            if (chunk.usage) {
              yield {
                type: 'usage',
                usage: {
                  inputTokens: chunk.usage.prompt_tokens,
                  outputTokens: chunk.usage.completion_tokens,
                  totalTokens: chunk.usage.total_tokens,
                },
              };
            }

            const choice = chunk.choices[0];

            if (!choice) continue;

            // Handle content
            if (choice.delta.content) {
              yield {
                type: 'text',
                content: choice.delta.content,
              };
            }

            // Handle tool calls
            if (choice.delta.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                let toolCall = toolCalls.get(tc.index);
                if (!toolCall) {
                  toolCall = { id: tc.id || '', name: '', arguments: '' };
                  toolCalls.set(tc.index, toolCall);
                }
                if (tc.id) toolCall.id = tc.id;
                if (tc.function?.name) toolCall.name = tc.function.name;
                if (tc.function?.arguments) toolCall.arguments += tc.function.arguments;
              }
            }

            // Handle finish
            if (choice.finish_reason === 'tool_calls') {
              for (const [_, tc] of toolCalls) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                    complete: true,
                  },
                };
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      // cancel() aborts the underlying HTTP stream so the provider stops
      // generating (and billing) when the consumer stops early.
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async embed(texts: string[], model?: string): Promise<Float32Array[]> {
    const embeddingModel = model || 'text-embedding-3-small';

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: embeddingModel,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw mapHttpError(response.status, error.error?.message || response.statusText, response.headers);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index and convert to Float32Array
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => new Float32Array(d.embedding));
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildRequestBody(request: NormalizedRequest): Record<string, unknown> {
    const messages = this.convertMessages(request.messages, request.systemPrompt);

    // Strip the registry prefix (e.g. "openai/gpt-4o" -> "gpt-4o"); the wire
    // API 404s on a namespaced id.
    const model = request.model.startsWith('openai/')
      ? request.model.slice(7)
      : request.model;

    const body: Record<string, unknown> = {
      model,
      messages,
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      // OpenAI deprecated `max_tokens` on chat completions in favor of
      // `max_completion_tokens`; reasoning models reject the old field.
      body.max_completion_tokens = request.maxTokens;
    }

    if (request.stopSequences?.length) {
      body.stop = request.stopSequences;
    }

    if (request.tools?.length) {
      body.tools = request.tools.map(t => this.convertTool(t));

      // Reasoning models default to a non-none reasoning_effort, which
      // /v1/chat/completions rejects alongside function tools:
      //   "Function tools with reasoning_effort are not supported for <model> in
      //    /v1/chat/completions. ... set reasoning_effort to 'none'."
      // Opt out explicitly so tool calling works on this endpoint. Gated to
      // reasoning models because non-reasoning ones reject the field entirely.
      if (isReasoningModel(model)) {
        body.reasoning_effort = 'none';
      }
    }

    return body;
  }

  private convertMessages(messages: Message[], systemPrompt?: string): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        const content = this.convertContent(msg.content);
        const openaiMsg: OpenAIMessage = {
          role: msg.role,
          content,
        };

        if (msg.role === 'assistant' && msg.toolCalls?.length) {
          openaiMsg.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }

        result.push(openaiMsg);
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          tool_call_id: msg.toolCallId || '',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      }
    }

    return result;
  }

  private convertContent(content: string | ContentPart[]): string | OpenAIContentPart[] {
    if (typeof content === 'string') return content;

    return content.map(part => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: part.text };
      } else if (part.type === 'image') {
        return {
          type: 'image_url' as const,
          image_url: {
            url: part.data.startsWith('data:')
              ? part.data
              : `data:${part.mimeType};base64,${part.data}`,
          },
        };
      }
      throw new Error(`Unsupported content type: ${(part as ContentPart).type}`);
    });
  }

  private convertTool(tool: ToolDefinition): OpenAITool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  private parseResponse(data: OpenAICompletionResponse): NormalizedResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('No choice returned from OpenAI API');
    }
    const msg = choice.message;

    const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content?.map(c => c.text || '').join('') || '';

    const finishReason = this.mapFinishReason(choice.finish_reason);

    return {
      message: {
        role: 'assistant',
        content,
        toolCalls,
      },
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      finishReason,
    };
  }

  private mapFinishReason(reason: string): NormalizedResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'complete';
      case 'length': return 'length';
      case 'tool_calls': return 'tool_use';
      case 'content_filter': return 'content_filter';
      default: return 'complete';
    }
  }

  private findKnownModel(id: string): { capabilities: ModelCapabilities; limits: ModelLimits } | undefined {
    // Direct match
    if (KNOWN_MODELS[id]) return KNOWN_MODELS[id];

    // Prefix match (e.g., gpt-4o-2024-05-13 -> gpt-4o)
    for (const [knownId, info] of Object.entries(KNOWN_MODELS)) {
      if (id.startsWith(knownId)) return info;
    }

    return undefined;
  }

  private defaultCapabilities(id: string): ModelCapabilities {
    const isEmbedding = id.includes('embedding');
    return {
      chat: !isEmbedding,
      streaming: !isEmbedding,
      vision: id.includes('vision') || id.includes('4o') || /^(o3|o4)/.test(id),
      tools: !isEmbedding,
      embeddings: isEmbedding,
      jsonMode: !isEmbedding,
      systemPrompt: !isEmbedding,
      multiTurn: !isEmbedding,
      audioInput: false,
      audioOutput: false,
    };
  }

  private defaultLimits(_id: string): ModelLimits {
    // Modern chat default; older/unknown models are refined by KNOWN_MODELS.
    return {
      contextWindow: 128000,
      maxOutputTokens: 16384,
    };
  }

  private formatModelName(id: string): string {
    return id
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/Gpt/g, 'GPT')
      .replace(/4o/g, '4o');
  }
}

/**
 * Create an OpenAI adapter
 */
export function createOpenAIAdapter(config: OpenAIConfig): OpenAIAdapter {
  return new OpenAIAdapter(config);
}
