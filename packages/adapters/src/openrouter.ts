/**
 * OpenRouter Adapter
 *
 * Adapter for OpenRouter API which provides access to multiple LLM providers
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
 * OpenRouter-specific configuration
 */
export interface OpenRouterConfig extends ProviderConfig {
  /** Site URL for OpenRouter rankings */
  siteUrl?: string;
  /** Site name for OpenRouter rankings */
  siteName?: string;
}

/**
 * OpenRouter model info from /models endpoint
 */
interface OpenRouterModelInfo {
  id: string;
  name: string;
  description?: string;
  created: number;
  context_length: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  top_provider?: {
    max_completion_tokens?: number;
    context_length?: number;
  };
  pricing?: {
    prompt: string;
    completion: string;
  };
}

/**
 * OpenAI-compatible message format (used for requests)
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

/**
 * OpenRouter provider adapter
 */
export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';
  private config: OpenRouterConfig;
  private baseUrl: string;

  constructor(config: OpenRouterConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    if (this.config.siteUrl) {
      headers['HTTP-Referer'] = this.config.siteUrl;
    }

    if (this.config.siteName) {
      headers['X-Title'] = this.config.siteName;
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

      const data = await response.json() as { data: OpenRouterModelInfo[] };
      const models: LLMModel[] = [];

      for (const model of data.data) {
        models.push({
          id: `openrouter/${model.id}`,
          name: model.name || this.formatModelName(model.id),
          provider: this.id,
          capabilities: this.detectCapabilities(model),
          limits: this.detectLimits(model),
        });
      }

      return models;
    } catch (error) {
      console.warn('OpenRouter: Failed to list models', error);
      return [];
    }
  }

  async getModel(id: string): Promise<LLMModel | null> {
    const models = await this.listModels();
    const modelId = id.startsWith('openrouter/') ? id : `openrouter/${id}`;
    return models.find(m => m.id === modelId) || null;
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

            // Usage arrives on a final chunk with empty `choices`; handle it
            // before the empty-choices guard or token accounting is lost.
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

            if (choice.delta.content) {
              yield { type: 'text', content: choice.delta.content };
            }

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
    const embeddingModel = model || 'openai/text-embedding-3-small';

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

    // Strip provider prefix if present
    const model = request.model.startsWith('openrouter/')
      ? request.model.slice(11)
      : request.model;

    const body: Record<string, unknown> = {
      model,
      messages,
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }

    if (request.stopSequences?.length) {
      body.stop = request.stopSequences;
    }

    if (request.tools?.length) {
      body.tools = request.tools.map(t => this.convertTool(t));
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
        const openaiMsg: OpenAIMessage = { role: msg.role, content };

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
      throw new Error('No choice returned from API');
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
      message: { role: 'assistant', content, toolCalls },
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

  private detectCapabilities(model: OpenRouterModelInfo): ModelCapabilities {
    const id = model.id.toLowerCase();
    const modality = model.architecture?.modality || '';
    const inputModalities = model.architecture?.input_modalities || [];

    const hasVision = modality.includes('image') ||
      inputModalities.includes('image') ||
      id.includes('vision') ||
      id.includes('4o') ||
      id.includes('claude-3') ||
      id.includes('gemini');

    const hasTools = id.includes('gpt-') ||
      id.includes('claude') ||
      id.includes('gemini') ||
      id.includes('mistral') ||
      id.includes('command');

    const isEmbedding = id.includes('embedding');

    return {
      chat: !isEmbedding,
      streaming: !isEmbedding,
      vision: hasVision,
      tools: hasTools && !isEmbedding,
      embeddings: isEmbedding,
      jsonMode: !isEmbedding,
      systemPrompt: !isEmbedding,
      multiTurn: !isEmbedding,
      audioInput: inputModalities.includes('audio'),
      audioOutput: (model.architecture?.output_modalities || []).includes('audio'),
    };
  }

  private detectLimits(model: OpenRouterModelInfo): ModelLimits {
    return {
      contextWindow: model.context_length || model.top_provider?.context_length || 8192,
      maxOutputTokens: model.top_provider?.max_completion_tokens || 4096,
    };
  }

  private formatModelName(id: string): string {
    // OpenRouter IDs are like "anthropic/claude-3-opus" - use as-is or format nicely
    const parts = id.split('/');
    const modelPart = parts[parts.length - 1] || id;
    return modelPart
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}

/**
 * Create an OpenRouter adapter
 */
export function createOpenRouterAdapter(config: OpenRouterConfig): OpenRouterAdapter {
  return new OpenRouterAdapter(config);
}
