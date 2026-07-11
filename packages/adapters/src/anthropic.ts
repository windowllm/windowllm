/**
 * Anthropic Adapter
 *
 * Adapter for Claude models via the Anthropic API
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

import { mapHttpError } from './index.js';
import type {
  ProviderAdapter,
  ProviderConfig,
  NormalizedRequest,
  NormalizedResponse,
  NormalizedChunk,
} from './index.js';

/**
 * Anthropic-specific configuration
 */
export interface AnthropicConfig extends ProviderConfig {
  anthropicVersion?: string;
}

/**
 * Anthropic API message format
 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

type AnthropicImageSource =
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'url'; url: string };

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: AnthropicImageSource }
  | { type: 'tool_use'; id: string; name: string; input: object }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: object;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  // Current Claude models can also return 'refusal', 'pause_turn', and
  // 'model_context_window_exceeded'; keep the type open.
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: AnthropicResponse;
  content_block?: AnthropicContentBlock;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type: string;
    message: string;
  };
}

/** Shape of an entry from GET /v1/models (fields added Mar 2026). */
interface AnthropicModelInfo {
  id: string;
  display_name?: string;
  max_input_tokens?: number;
  max_tokens?: number;
  capabilities?: {
    image_input?: { supported?: boolean };
    structured_outputs?: { supported?: boolean };
  };
}

/** Capabilities shared by all current Claude text models. */
const STANDARD_CAPABILITIES: ModelCapabilities = {
  chat: true,
  streaming: true,
  vision: true,
  tools: true,
  embeddings: false,
  jsonMode: true,        // structured outputs are GA on current models
  systemPrompt: true,
  multiTurn: true,
  audioInput: false,
  audioOutput: false,
};

/**
 * Static fallback catalog, used only when GET /v1/models is unavailable
 * (offline, network error). listModels() prefers the live Models API, which is
 * the authoritative source for the catalog, limits, and capabilities — so this
 * list does not need to be exhaustive, just current enough to be useful.
 */
const FALLBACK_MODELS: Record<string, { name: string; capabilities: ModelCapabilities; limits: ModelLimits }> = {
  'claude-opus-4-8': {
    name: 'Claude Opus 4.8',
    capabilities: STANDARD_CAPABILITIES,
    limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000, maxImageCount: 100 },
  },
  'claude-sonnet-5': {
    name: 'Claude Sonnet 5',
    capabilities: STANDARD_CAPABILITIES,
    limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000, maxImageCount: 100 },
  },
  'claude-haiku-4-5': {
    name: 'Claude Haiku 4.5',
    capabilities: STANDARD_CAPABILITIES,
    limits: { contextWindow: 200_000, maxOutputTokens: 64_000, maxImageCount: 100 },
  },
};

/**
 * Anthropic provider adapter
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  private config: AnthropicConfig;
  private baseUrl: string;
  private modelsCache: LLMModel[] | null = null;

  constructor(config: AnthropicConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': this.config.anthropicVersion || '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',  // Enable CORS for browser access
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    return headers;
  }

  async listModels(): Promise<LLMModel[]> {
    if (this.modelsCache) return this.modelsCache;

    // Anthropic ships a live Models API (GA); it returns the authoritative
    // catalog with per-model limits and capabilities. Fall back to the static
    // list only if the request fails (offline, auth error, etc.).
    try {
      const response = await fetch(`${this.baseUrl}/v1/models?limit=100`, {
        method: 'GET',
        headers: this.getHeaders(),
      });
      if (response.ok) {
        const body = await response.json() as { data?: AnthropicModelInfo[] };
        const models = (body.data ?? []).map(m => this.mapApiModel(m));
        if (models.length > 0) {
          this.modelsCache = models;
          return models;
        }
      }
    } catch {
      // fall through to the static fallback
    }

    return this.fallbackModels();
  }

  async getModel(id: string): Promise<LLMModel | null> {
    const modelId = id.startsWith('anthropic/') ? id.slice(10) : id;
    const models = await this.listModels();
    const found = models.find(m => m.id === `anthropic/${modelId}`);
    if (found) return found;

    const fallback = FALLBACK_MODELS[modelId];
    if (fallback) {
      return {
        id: `anthropic/${modelId}`,
        name: fallback.name,
        provider: this.id,
        capabilities: fallback.capabilities,
        limits: fallback.limits,
      };
    }

    return null;
  }

  private mapApiModel(m: AnthropicModelInfo): LLMModel {
    return {
      id: `anthropic/${m.id}`,
      name: m.display_name ?? m.id,
      provider: this.id,
      capabilities: {
        ...STANDARD_CAPABILITIES,
        vision: m.capabilities?.image_input?.supported ?? STANDARD_CAPABILITIES.vision,
        jsonMode: m.capabilities?.structured_outputs?.supported ?? STANDARD_CAPABILITIES.jsonMode,
      },
      limits: {
        contextWindow: m.max_input_tokens ?? 200_000,
        maxOutputTokens: m.max_tokens ?? 8192,
        maxImageCount: 100,
      },
    };
  }

  private fallbackModels(): LLMModel[] {
    return Object.entries(FALLBACK_MODELS).map(([id, info]) => ({
      id: `anthropic/${id}`,
      name: info.name,
      provider: this.id,
      capabilities: info.capabilities,
      limits: info.limits,
    }));
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const body = this.buildRequestBody(request);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw mapHttpError(response.status, error.error?.message || response.statusText, response.headers);
    }

    const data = await response.json() as AnthropicResponse;
    return this.parseResponse(data);
  }

  async *stream(request: NormalizedRequest): AsyncIterable<NormalizedChunk> {
    const body = this.buildRequestBody(request);
    body.stream = true;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
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
    let currentToolCall: { id: string; name: string; arguments: string } | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

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
          if (!data) continue;

          try {
            const event = JSON.parse(data) as AnthropicStreamEvent;

            switch (event.type) {
              case 'message_start':
                if (event.message?.usage) {
                  inputTokens = event.message.usage.input_tokens;
                }
                break;

              case 'content_block_start':
                if (event.content_block?.type === 'tool_use') {
                  const block = event.content_block as { type: 'tool_use'; id: string; name: string };
                  currentToolCall = {
                    id: block.id,
                    name: block.name,
                    arguments: '',
                  };
                }
                break;

              case 'content_block_delta':
                if (event.delta?.type === 'text_delta' && event.delta.text) {
                  yield { type: 'text', content: event.delta.text };
                } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                  if (currentToolCall) {
                    currentToolCall.arguments += event.delta.partial_json;
                  }
                }
                break;

              case 'content_block_stop':
                if (currentToolCall) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: currentToolCall.id,
                      name: currentToolCall.name,
                      // A tool with no parameters produces no input_json_delta;
                      // emit valid empty-object JSON rather than "".
                      arguments: currentToolCall.arguments || '{}',
                      complete: true,
                    },
                  };
                  currentToolCall = null;
                }
                break;

              case 'message_delta':
                if (event.usage) {
                  outputTokens = event.usage.output_tokens || 0;
                }
                if (event.delta?.stop_reason) {
                  yield {
                    type: 'usage',
                    usage: {
                      inputTokens,
                      outputTokens,
                      totalTokens: inputTokens + outputTokens,
                    },
                  };
                }
                break;

              case 'message_stop':
                yield { type: 'done' };
                break;

              case 'error':
                // Anthropic can emit a terminal error mid-stream (e.g.
                // overloaded_error). Surface it instead of ending silently.
                throw new Error(event.error?.message || `Anthropic stream error: ${event.error?.type || 'unknown'}`);
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

  async embed(_texts: string[], _model?: string): Promise<Float32Array[]> {
    throw new Error('Anthropic does not support embeddings. Use OpenAI or another provider.');
  }

  async testConnection(): Promise<boolean> {
    try {
      // A GET to the Models API validates the key without spending tokens and
      // without depending on any particular (possibly-retired) model id.
      const response = await fetch(`${this.baseUrl}/v1/models?limit=1`, {
        method: 'GET',
        headers: this.getHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildRequestBody(request: NormalizedRequest): Record<string, unknown> {
    const messages = this.convertMessages(request.messages);

    // Strip provider prefix if present (e.g., "anthropic/claude-3-5-sonnet" -> "claude-3-5-sonnet")
    const model = request.model.startsWith('anthropic/')
      ? request.model.slice(10)
      : request.model;

    const body: Record<string, unknown> = {
      model,
      messages,
      // Use ?? so an explicit 0 isn't silently replaced (though 0 is invalid).
      max_tokens: request.maxTokens ?? 4096,
    };

    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.stopSequences?.length) {
      body.stop_sequences = request.stopSequences;
    }

    if (request.tools?.length) {
      body.tools = request.tools.map(t => this.convertTool(t));
    }

    return body;
  }

  private convertMessages(messages: Message[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        result.push({
          role: 'user',
          content: this.convertContent(msg.content),
        });
      } else if (msg.role === 'assistant') {
        const content: AnthropicContentBlock[] = [];

        // Add text content
        if (typeof msg.content === 'string' && msg.content) {
          content.push({ type: 'text', text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              content.push({ type: 'text', text: part.text });
            }
          }
        }

        // Add tool calls
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }

        if (content.length > 0) {
          result.push({ role: 'assistant', content });
        }
      } else if (msg.role === 'tool') {
        // Tool results need to be in a user message
        const toolResult: AnthropicContentBlock = {
          type: 'tool_result',
          tool_use_id: msg.toolCallId || '',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        };

        // Check if last message is a user message we can append to
        const lastMsg = result[result.length - 1];
        if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
          (lastMsg.content as AnthropicContentBlock[]).push(toolResult);
        } else {
          result.push({ role: 'user', content: [toolResult] });
        }
      }
    }

    return result;
  }

  private convertContent(content: string | ContentPart[]): string | AnthropicContentBlock[] {
    if (typeof content === 'string') return content;

    return content.map(part => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: part.text };
      } else if (part.type === 'image') {
        // ImageContent.data may be a remote URL or base64. Anthropic accepts a
        // url source directly; don't wrap a URL as base64.
        if (/^https?:\/\//i.test(part.data)) {
          return { type: 'image' as const, source: { type: 'url' as const, url: part.data } };
        }
        const mediaType = part.mimeType || 'image/png';
        const data = part.data.startsWith('data:')
          ? part.data.split(',')[1] || part.data
          : part.data;
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mediaType,
            data,
          },
        };
      }
      throw new Error(`Unsupported content type: ${(part as ContentPart).type}`);
    });
  }

  private convertTool(tool: ToolDefinition): AnthropicTool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    };
  }

  private parseResponse(data: AnthropicResponse): NormalizedResponse {
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    const finishReason = this.mapStopReason(data.stop_reason);

    return {
      message: {
        role: 'assistant',
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      finishReason,
    };
  }

  private mapStopReason(reason: string): NormalizedResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
      case 'pause_turn':
        return 'complete';
      case 'max_tokens':
      case 'model_context_window_exceeded':
        return 'length';
      case 'tool_use':
        return 'tool_use';
      case 'refusal':
        return 'content_filter';
      default:
        return 'complete';
    }
  }
}

/**
 * Create an Anthropic adapter
 */
export function createAnthropicAdapter(config: AnthropicConfig): AnthropicAdapter {
  return new AnthropicAdapter(config);
}
