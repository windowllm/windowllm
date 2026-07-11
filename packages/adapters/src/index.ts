/**
 * @windowllm/adapters
 *
 * LLM provider adapters for WindowLLM
 */

import {
  LLMError,
  type Message,
  type TokenUsage,
  type ToolDefinition,
  type ModelCapabilities,
  type ModelLimits,
  type LLMModel,
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
  /** Abort signal to cancel the in-flight request. */
  signal?: AbortSignal;
}

/**
 * Map a non-OK HTTP response to a typed LLMError so callers can distinguish
 * auth failures, rate limits, and retryable provider errors, and honor
 * Retry-After. `message` is a best-effort human string from the provider body.
 */
export function mapHttpError(status: number, message: string, headers?: Headers): LLMError {
  const retryAfterHeader = headers?.get('retry-after');
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;

  switch (status) {
    case 400:
      return new LLMError(message || 'Invalid request', 'INVALID_INPUT');
    case 401:
    case 403:
      return new LLMError(message || 'Authentication failed', 'PROVIDER_ERROR');
    case 404:
      return new LLMError(message || 'Not found', 'MODEL_NOT_FOUND');
    case 413:
      return new LLMError(message || 'Request too large', 'CONTEXT_TOO_LONG');
    case 429:
      return new LLMError(message || 'Rate limit exceeded', 'RATE_LIMITED', { retryAfter });
    default:
      if (status >= 500) {
        // 500/502/503/529 — transient upstream failures, retryable.
        return new LLMError(message || 'Provider error', 'PROVIDER_ERROR', { retryAfter });
      }
      return new LLMError(message || `HTTP ${status}`, 'UNKNOWN');
  }
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

  /**
   * Whether this provider can be called directly from a browser page (the vault
   * iframe), i.e. it sends CORS headers for cross-origin requests. When false,
   * the provider is only reachable from the extension's background context (or a
   * proxy) — the vault should not offer it in iframe-only mode.
   */
  readonly browserDirect: boolean;

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
