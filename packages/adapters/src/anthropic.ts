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

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
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
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
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
}

/**
 * Known Anthropic models with capabilities
 */
const KNOWN_MODELS: Record<string, { name: string; capabilities: ModelCapabilities; limits: ModelLimits }> = {
  'claude-opus-4-20250514': {
    name: 'Claude Opus 4',
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: false,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 32000,
      maxImageCount: 20,
    },
  },
  'claude-sonnet-4-20250514': {
    name: 'Claude Sonnet 4',
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: false,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 64000,
      maxImageCount: 20,
    },
  },
  'claude-3-5-sonnet-20241022': {
    name: 'Claude 3.5 Sonnet',
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: false,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      maxImageCount: 20,
    },
  },
  'claude-3-5-haiku-20241022': {
    name: 'Claude 3.5 Haiku',
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: false,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      maxImageCount: 20,
    },
  },
  'claude-3-opus-20240229': {
    name: 'Claude 3 Opus',
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: false,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 4096,
      maxImageCount: 20,
    },
  },
  'claude-3-sonnet-20240229': {
    name: 'Claude 3 Sonnet',
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: false,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 4096,
      maxImageCount: 20,
    },
  },
  'claude-3-haiku-20240307': {
    name: 'Claude 3 Haiku',
    capabilities: {
      chat: true,
      streaming: true,
      vision: true,
      tools: true,
      embeddings: false,
      jsonMode: false,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    },
    limits: {
      contextWindow: 200000,
      maxOutputTokens: 4096,
      maxImageCount: 20,
    },
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
    // Anthropic doesn't have a models list endpoint, return known models
    return Object.entries(KNOWN_MODELS).map(([id, info]) => ({
      id: `anthropic/${id}`,
      name: info.name,
      provider: this.id,
      capabilities: info.capabilities,
      limits: info.limits,
    }));
  }

  async getModel(id: string): Promise<LLMModel | null> {
    const modelId = id.startsWith('anthropic/') ? id.slice(10) : id;
    const known = KNOWN_MODELS[modelId];

    if (known) {
      return {
        id: `anthropic/${modelId}`,
        name: known.name,
        provider: this.id,
        capabilities: known.capabilities,
        limits: known.limits,
      };
    }

    return null;
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const body = this.buildRequestBody(request);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Anthropic API error: ${response.statusText}`);
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
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Anthropic API error: ${response.statusText}`);
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
                      arguments: currentToolCall.arguments,
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
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async embed(_texts: string[], _model?: string): Promise<Float32Array[]> {
    throw new Error('Anthropic does not support embeddings. Use OpenAI or another provider.');
  }

  async testConnection(): Promise<boolean> {
    try {
      // Send a minimal request to test the connection
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      return response.ok || response.status === 400; // 400 means auth worked but request was bad
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
      max_tokens: request.maxTokens || 4096,
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
        return 'complete';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_use';
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
