/**
 * @windowllm/adapters
 *
 * LLM provider adapters for WindowLLM
 */

import type {
  Message,
  TokenUsage,
  ToolDefinition,
  ModelCapabilities,
  ModelLimits,
  LLMModel,
} from '@windowllm/types';

/**
 * Normalized request format for all providers
 */
export interface NormalizedRequest {
  model: string;
  messages: Message[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  stream?: boolean;
}

/**
 * Normalized response format from all providers
 */
export interface NormalizedResponse {
  message: Message;
  usage: TokenUsage;
  finishReason: 'complete' | 'length' | 'tool_use' | 'content_filter';
}

/**
 * Normalized streaming chunk
 */
export interface NormalizedChunk {
  type: 'text' | 'tool_call' | 'usage' | 'done';
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
    complete: boolean;
  };
  usage?: Partial<TokenUsage>;
  finishReason?: string;
}

/**
 * Provider adapter interface
 */
export interface ProviderAdapter {
  /** Provider identifier */
  readonly id: string;

  /** Provider display name */
  readonly name: string;

  /** List available models */
  listModels(): Promise<LLMModel[]>;

  /** Get a specific model */
  getModel(id: string): Promise<LLMModel | null>;

  /** Complete a request */
  complete(request: NormalizedRequest): Promise<NormalizedResponse>;

  /** Stream a request */
  stream(request: NormalizedRequest): AsyncIterable<NormalizedChunk>;

  /** Generate embeddings */
  embed(texts: string[], model?: string): Promise<Float32Array[]>;

  /** Test connection */
  testConnection(): Promise<boolean>;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** API key or token */
  apiKey?: string;

  /** Base URL (for custom endpoints) */
  baseUrl?: string;

  /** Default model */
  defaultModel?: string;

  /** Custom headers */
  headers?: Record<string, string>;
}

/**
 * Provider registry
 */
export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  async listAllModels(): Promise<LLMModel[]> {
    const models: LLMModel[] = [];
    for (const adapter of this.adapters.values()) {
      try {
        const adapterModels = await adapter.listModels();
        models.push(...adapterModels);
      } catch (error) {
        console.warn(`Failed to list models for ${adapter.id}:`, error);
      }
    }
    return models;
  }
}

// Singleton registry
export const providerRegistry = new ProviderRegistry();

// Re-export types
export type { LLMModel, ModelCapabilities, ModelLimits };

// Export adapters
export { OpenAIAdapter, createOpenAIAdapter } from './openai.js';
export type { OpenAIConfig } from './openai.js';

export { AnthropicAdapter, createAnthropicAdapter } from './anthropic.js';
export type { AnthropicConfig } from './anthropic.js';

export { OllamaAdapter, createOllamaAdapter } from './ollama.js';
export type { OllamaConfig } from './ollama.js';

export { OpenRouterAdapter, createOpenRouterAdapter } from './openrouter.js';
export type { OpenRouterConfig } from './openrouter.js';

export { MockAdapter, createMockAdapter } from './mock.js';
export type { MockAdapterConfig, MockResponse } from './mock.js';
