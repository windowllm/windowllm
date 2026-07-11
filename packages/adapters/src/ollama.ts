/**
 * Ollama Adapter
 *
 * Adapter for local Ollama models
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
 * Ollama-specific configuration
 */
export interface OllamaConfig extends ProviderConfig {
  /** Base URL for Ollama API (default: http://localhost:11434) */
  baseUrl?: string;
}

/**
 * Ollama API message format (OpenAI-compatible)
 */
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

/**
 * Ollama tool call. Note the wire format differs from OpenAI's: there is no
 * `id` or `type`, and `arguments` is a JSON object, not a stringified JSON.
 */
interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

interface OllamaModelInfo {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaModelDetails {
  license: string;
  modelfile: string;
  parameters: string;
  template: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
  model_info: Record<string, unknown>;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
  done_reason?: 'stop' | 'length' | 'tool_calls';
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * Known model families and their capabilities
 */
const MODEL_FAMILIES: Record<string, Partial<ModelCapabilities>> = {
  llama: { chat: true, streaming: true, systemPrompt: true },
  mistral: { chat: true, streaming: true, systemPrompt: true, tools: true },
  mixtral: { chat: true, streaming: true, systemPrompt: true, tools: true },
  codellama: { chat: true, streaming: true, systemPrompt: true },
  llava: { chat: true, streaming: true, vision: true, systemPrompt: true },
  bakllava: { chat: true, streaming: true, vision: true, systemPrompt: true },
  phi: { chat: true, streaming: true, systemPrompt: true },
  qwen: { chat: true, streaming: true, systemPrompt: true, tools: true },
  gemma: { chat: true, streaming: true, systemPrompt: true },
  deepseek: { chat: true, streaming: true, systemPrompt: true, tools: true },
  nomic: { embeddings: true },
  mxbai: { embeddings: true },
  'all-minilm': { embeddings: true },
};

/**
 * Ollama provider adapter
 */
export class OllamaAdapter implements ProviderAdapter {
  readonly id = 'ollama';
  readonly name = 'Ollama (Local)';
  private baseUrl: string;

  constructor(config: OllamaConfig = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async listModels(): Promise<LLMModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.statusText}`);
      }

      const data = await response.json() as { models: OllamaModelInfo[] };
      return data.models.map(model => this.convertModelInfo(model));
    } catch (error) {
      console.warn('Failed to list Ollama models:', error);
      return [];
    }
  }

  async getModel(id: string): Promise<LLMModel | null> {
    const modelId = id.startsWith('ollama/') ? id.slice(7) : id;

    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId }),
      });

      if (!response.ok) return null;

      const data = await response.json() as OllamaModelDetails;
      return {
        id: `ollama/${modelId}`,
        name: this.formatModelName(modelId),
        provider: this.id,
        capabilities: this.inferCapabilities(modelId, data),
        limits: this.inferLimits(data),
      };
    } catch {
      return null;
    }
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const body = this.buildRequestBody(request);
    body.stream = false;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw mapHttpError(response.status, error.error || response.statusText, response.headers);
    }

    const data = await response.json() as OllamaChatResponse;
    return this.parseResponse(data);
  }

  async *stream(request: NormalizedRequest): AsyncIterable<NormalizedChunk> {
    const body = this.buildRequestBody(request);
    body.stream = true;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw mapHttpError(response.status, error.error || response.statusText, response.headers);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
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
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line) as OllamaChatResponse;

            if (chunk.message?.content) {
              yield { type: 'text', content: chunk.message.content };
            }

            if (chunk.message?.tool_calls) {
              let idx = 0;
              for (const tc of chunk.message.tool_calls) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    // Ollama tool calls have no id; synthesize a stable one.
                    id: `call_${idx++}_${tc.function.name}`,
                    name: tc.function.name,
                    // NormalizedChunk carries arguments as a JSON string.
                    arguments: JSON.stringify(tc.function.arguments ?? {}),
                    complete: true,
                  },
                };
              }
            }

            if (chunk.done) {
              inputTokens = chunk.prompt_eval_count || 0;
              outputTokens = chunk.eval_count || 0;
              yield {
                type: 'usage',
                usage: {
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
              };
              yield { type: 'done' };
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      // cancel() aborts the underlying HTTP stream so the model stops
      // generating when the consumer stops early.
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async embed(texts: string[], model?: string): Promise<Float32Array[]> {
    const embeddingModel = model || 'nomic-embed-text';
    const results: Float32Array[] = [];

    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: embeddingModel,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embedding error: ${response.statusText}`);
      }

      const data = await response.json() as OllamaEmbeddingResponse;
      results.push(new Float32Array(data.embedding));
    }

    return results;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Pull a model from Ollama registry
   */
  async pullModel(name: string, onProgress?: (status: string, percent?: number) => void): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (onProgress) {
              const percent = data.total ? Math.round((data.completed / data.total) * 100) : undefined;
              onProgress(data.status, percent);
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

  private buildRequestBody(request: NormalizedRequest): Record<string, unknown> {
    const messages = this.convertMessages(request.messages, request.systemPrompt);

    // Strip the registry prefix (e.g. "ollama/llama3.1:8b" -> "llama3.1:8b");
    // listModels() namespaces ids, but the wire API expects the bare name.
    const model = request.model.startsWith('ollama/')
      ? request.model.slice(7)
      : request.model;

    const body: Record<string, unknown> = {
      model,
      messages,
    };

    const options: Record<string, unknown> = {};

    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      options.num_predict = request.maxTokens;
    }

    if (request.stopSequences?.length) {
      options.stop = request.stopSequences;
    }

    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    if (request.tools?.length) {
      body.tools = request.tools.map(t => this.convertTool(t));
    }

    return body;
  }

  private convertMessages(messages: Message[], systemPrompt?: string): OllamaMessage[] {
    const result: OllamaMessage[] = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        const ollamaMsg: OllamaMessage = {
          role: 'user',
          content: this.extractTextContent(msg.content),
        };

        // Handle images
        const images = this.extractImages(msg.content);
        if (images.length > 0) {
          ollamaMsg.images = images;
        }

        result.push(ollamaMsg);
      } else if (msg.role === 'assistant') {
        const ollamaMsg: OllamaMessage = {
          role: 'assistant',
          content: this.extractTextContent(msg.content),
        };

        if (msg.toolCalls?.length) {
          ollamaMsg.tool_calls = msg.toolCalls.map(tc => ({
            function: {
              name: tc.name,
              // Ollama expects arguments as an object, not a JSON string.
              arguments: tc.arguments,
            },
          }));
        }

        result.push(ollamaMsg);
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

  private extractTextContent(content: string | ContentPart[]): string {
    if (typeof content === 'string') return content;
    return content
      .filter(p => p.type === 'text')
      .map(p => (p as { type: 'text'; text: string }).text)
      .join('');
  }

  private extractImages(content: string | ContentPart[]): string[] {
    if (typeof content === 'string') return [];
    const images: string[] = [];
    for (const part of content) {
      if (part.type === 'image') {
        const data = part.data;
        // Ollama expects base64 without data URL prefix
        if (data.startsWith('data:')) {
          const parts = data.split(',');
          images.push(parts[1] ?? parts[0] ?? data);
        } else {
          images.push(data);
        }
      }
    }
    return images;
  }

  private convertTool(tool: ToolDefinition): OllamaTool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  private parseResponse(data: OllamaChatResponse): NormalizedResponse {
    const toolCalls: ToolCall[] = [];

    if (data.message.tool_calls) {
      data.message.tool_calls.forEach((tc, i) => {
        toolCalls.push({
          // Ollama tool calls have no id; synthesize a stable one for correlation.
          id: `call_${i}_${tc.function.name}`,
          name: tc.function.name,
          // arguments is already a JSON object on the wire — no parse needed.
          arguments: tc.function.arguments,
        });
      });
    }

    const inputTokens = data.prompt_eval_count || 0;
    const outputTokens = data.eval_count || 0;

    return {
      message: {
        role: 'assistant',
        content: data.message.content || '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: this.mapDoneReason(data.done_reason),
    };
  }

  private mapDoneReason(reason?: string): NormalizedResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'complete';
      case 'length': return 'length';
      case 'tool_calls': return 'tool_use';
      default: return 'complete';
    }
  }

  private convertModelInfo(model: OllamaModelInfo): LLMModel {
    const family = model.details?.family?.toLowerCase() || '';
    const capabilities = this.inferCapabilitiesFromFamily(family, model.name);

    return {
      id: `ollama/${model.name}`,
      name: this.formatModelName(model.name),
      provider: this.id,
      capabilities,
      limits: {
        contextWindow: this.estimateContextWindow(model.details?.parameter_size),
        maxOutputTokens: 4096,
      },
    };
  }

  private inferCapabilities(modelId: string, _details: OllamaModelDetails): ModelCapabilities {
    const family = _details.details?.family?.toLowerCase() || '';
    return this.inferCapabilitiesFromFamily(family, modelId);
  }

  private inferCapabilitiesFromFamily(family: string, modelName: string): ModelCapabilities {
    const defaults: ModelCapabilities = {
      chat: true,
      streaming: true,
      vision: false,
      tools: false,
      embeddings: false,
      jsonMode: false,
      systemPrompt: true,
      multiTurn: true,
      audioInput: false,
      audioOutput: false,
    };

    // Check known families
    for (const [key, caps] of Object.entries(MODEL_FAMILIES)) {
      if (family.includes(key) || modelName.toLowerCase().includes(key)) {
        return { ...defaults, ...caps };
      }
    }

    // Vision model detection
    if (modelName.toLowerCase().includes('vision') || modelName.toLowerCase().includes('llava')) {
      return { ...defaults, vision: true };
    }

    return defaults;
  }

  private inferLimits(_details: OllamaModelDetails): ModelLimits {
    const paramSize = _details.details?.parameter_size || '';
    return {
      contextWindow: this.estimateContextWindow(paramSize),
      maxOutputTokens: 4096,
    };
  }

  private estimateContextWindow(paramSize?: string): number {
    if (!paramSize) return 4096;

    // Parse parameter size like "7B", "13B", "70B"
    const match = paramSize.match(/(\d+)/);
    if (!match) return 4096;

    const size = parseInt(match[1] || '0', 10);

    // Rough estimates based on model size
    if (size >= 70) return 8192;
    if (size >= 30) return 8192;
    if (size >= 7) return 4096;
    return 2048;
  }

  private formatModelName(name: string): string {
    return name
      .replace(/:latest$/, '')
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

/**
 * Create an Ollama adapter
 */
export function createOllamaAdapter(config: OllamaConfig = {}): OllamaAdapter {
  return new OllamaAdapter(config);
}
