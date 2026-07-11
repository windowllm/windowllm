/**
 * Mock Provider Adapter
 *
 * A configurable mock adapter for testing WindowLLM functionality.
 * Supports configurable responses, streaming simulation, request recording,
 * and error injection.
 */

import type {
  Message,
  ToolCall,
  LLMModel,
  ModelCapabilities,
  ModelLimits,
} from '@windowllm/types';

import type {
  ProviderAdapter,
  NormalizedRequest,
  NormalizedResponse,
  NormalizedChunk,
} from './index.js';

/**
 * Mock response configuration
 */
export interface MockResponse {
  /** Text content of the response */
  content: string;
  /** Tool calls to include in the response */
  toolCalls?: ToolCall[];
  /** Reason for stopping */
  finishReason?: 'complete' | 'length' | 'tool_use' | 'content_filter';
  /** Number of input tokens to report */
  inputTokens?: number;
  /** Number of output tokens to report */
  outputTokens?: number;
  /** Delay in milliseconds before responding */
  delay?: number;
  /** For streaming: characters per chunk */
  chunkSize?: number;
  /** For streaming: delay between chunks in milliseconds */
  chunkDelay?: number;
  /** Error to throw instead of responding */
  error?: Error;
}

/**
 * Response matcher for pattern-based responses
 */
interface ResponseMatcher {
  pattern: string | RegExp;
  response: MockResponse;
}

/**
 * Mock adapter configuration
 */
export interface MockAdapterConfig {
  /** Model ID for this adapter (default: 'mock-model') */
  modelId?: string;
  /** Model name for display (default: 'Mock Model') */
  modelName?: string;
  /** Default response when no pattern matches */
  defaultResponse?: MockResponse;
  /** Response map: input content -> response */
  responses?: Map<string, MockResponse> | Record<string, MockResponse>;
  /** Callback for dynamic responses */
  onRequest?: (request: NormalizedRequest) => MockResponse | Promise<MockResponse>;
  /** Record all requests for assertions (default: true) */
  recordRequests?: boolean;
  /** Embedding dimensions (default: 1536) */
  embeddingDimensions?: number;
}

/**
 * Default capabilities for mock model
 */
const DEFAULT_CAPABILITIES: ModelCapabilities = {
  chat: true,
  streaming: true,
  vision: true,
  tools: true,
  embeddings: true,
  jsonMode: true,
  systemPrompt: true,
  multiTurn: true,
  audioInput: false,
  audioOutput: false,
};

/**
 * Default limits for mock model
 */
const DEFAULT_LIMITS: ModelLimits = {
  contextWindow: 128000,
  maxOutputTokens: 4096,
  maxImageCount: 10,
  maxImageSize: 20 * 1024 * 1024,
  supportedImageFormats: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  embeddingDimensions: 1536,
  maxToolCount: 128,
};

/**
 * Default mock response
 */
const DEFAULT_RESPONSE: MockResponse = {
  content: 'This is a mock response from the MockAdapter.',
  finishReason: 'complete',
  inputTokens: 10,
  outputTokens: 15,
};

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Mock Provider Adapter for testing
 */
export class MockAdapter implements ProviderAdapter {
  readonly id = 'mock';
  readonly browserDirect = true;
  readonly name: string;

  /** Recorded requests (when recordRequests is enabled) */
  readonly requests: NormalizedRequest[] = [];

  private modelId: string;
  private defaultResponse: MockResponse;
  private matchers: ResponseMatcher[] = [];
  private onRequestHandler?: (request: NormalizedRequest) => MockResponse | Promise<MockResponse>;
  private recordRequestsEnabled: boolean;
  private embeddingDimensions: number;

  constructor(config?: MockAdapterConfig) {
    this.modelId = config?.modelId ?? 'mock-model';
    this.name = config?.modelName ?? 'Mock Model';
    this.defaultResponse = config?.defaultResponse ?? { ...DEFAULT_RESPONSE };
    this.onRequestHandler = config?.onRequest;
    this.recordRequestsEnabled = config?.recordRequests ?? true;
    this.embeddingDimensions = config?.embeddingDimensions ?? 1536;

    // Initialize responses from config
    if (config?.responses) {
      if (config.responses instanceof Map) {
        for (const [pattern, response] of config.responses) {
          this.matchers.push({ pattern, response });
        }
      } else {
        for (const [pattern, response] of Object.entries(config.responses)) {
          this.matchers.push({ pattern, response });
        }
      }
    }
  }

  /**
   * Set a response for a specific input pattern
   */
  setResponse(pattern: string | RegExp, response: MockResponse): void {
    // Remove existing matcher for this pattern
    this.matchers = this.matchers.filter(m => {
      if (typeof m.pattern === 'string' && typeof pattern === 'string') {
        return m.pattern !== pattern;
      }
      if (m.pattern instanceof RegExp && pattern instanceof RegExp) {
        return m.pattern.source !== pattern.source;
      }
      return true;
    });
    this.matchers.push({ pattern, response });
  }

  /**
   * Set the default response when no pattern matches
   */
  setDefaultResponse(response: MockResponse): void {
    this.defaultResponse = response;
  }

  /**
   * Set a dynamic response handler
   */
  setOnRequest(handler: (request: NormalizedRequest) => MockResponse | Promise<MockResponse>): void {
    this.onRequestHandler = handler;
  }

  /**
   * Reset all matchers and recorded requests
   */
  reset(): void {
    this.matchers = [];
    this.requests.length = 0;
    this.onRequestHandler = undefined;
    this.defaultResponse = { ...DEFAULT_RESPONSE };
  }

  /**
   * Clear recorded requests
   */
  clearRequests(): void {
    this.requests.length = 0;
  }

  /**
   * Find matching response for a request
   */
  private findResponse(request: NormalizedRequest): MockResponse {
    // Extract text content from the last message
    const lastMessage = request.messages[request.messages.length - 1];
    let content = '';
    if (lastMessage) {
      if (typeof lastMessage.content === 'string') {
        content = lastMessage.content;
      } else if (Array.isArray(lastMessage.content)) {
        content = lastMessage.content
          .filter(p => p.type === 'text')
          .map(p => (p as { type: 'text'; text: string }).text)
          .join('');
      }
    }

    // Try to match against patterns
    for (const matcher of this.matchers) {
      if (typeof matcher.pattern === 'string') {
        if (content.includes(matcher.pattern)) {
          return matcher.response;
        }
      } else if (matcher.pattern instanceof RegExp) {
        if (matcher.pattern.test(content)) {
          return matcher.response;
        }
      }
    }

    return this.defaultResponse;
  }

  async listModels(): Promise<LLMModel[]> {
    return [
      {
        id: `mock/${this.modelId}`,
        name: this.name,
        provider: 'mock',
        capabilities: { ...DEFAULT_CAPABILITIES },
        limits: { ...DEFAULT_LIMITS, embeddingDimensions: this.embeddingDimensions },
      },
    ];
  }

  async getModel(id: string): Promise<LLMModel | null> {
    const models = await this.listModels();
    return models.find(m => m.id === id || m.id === `mock/${id}`) ?? null;
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    // Record request
    if (this.recordRequestsEnabled) {
      this.requests.push({ ...request });
    }

    // Get response (from handler or matcher)
    let response: MockResponse;
    if (this.onRequestHandler) {
      response = await this.onRequestHandler(request);
    } else {
      response = this.findResponse(request);
    }

    // Apply delay
    if (response.delay) {
      await sleep(response.delay);
    }

    // Throw error if configured
    if (response.error) {
      throw response.error;
    }

    // Build response message
    const message: Message = {
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    };

    return {
      message,
      usage: {
        inputTokens: response.inputTokens ?? 10,
        outputTokens: response.outputTokens ?? response.content.length / 4,
        totalTokens: (response.inputTokens ?? 10) + (response.outputTokens ?? response.content.length / 4),
      },
      finishReason: response.toolCalls?.length ? 'tool_use' : (response.finishReason ?? 'complete'),
    };
  }

  async *stream(request: NormalizedRequest): AsyncIterable<NormalizedChunk> {
    // Record request
    if (this.recordRequestsEnabled) {
      this.requests.push({ ...request });
    }

    // Get response (from handler or matcher)
    let response: MockResponse;
    if (this.onRequestHandler) {
      response = await this.onRequestHandler(request);
    } else {
      response = this.findResponse(request);
    }

    // Apply initial delay
    if (response.delay) {
      await sleep(response.delay);
    }

    // Throw error if configured
    if (response.error) {
      throw response.error;
    }

    const chunkSize = response.chunkSize ?? 10;
    const chunkDelay = response.chunkDelay ?? 20;

    // Stream text content
    const content = response.content;
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize);
      yield { type: 'text', content: chunk };

      if (chunkDelay > 0 && i + chunkSize < content.length) {
        await sleep(chunkDelay);
      }
    }

    // Stream tool calls
    if (response.toolCalls?.length) {
      for (const toolCall of response.toolCalls) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: toolCall.id,
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
            complete: true,
          },
        };
      }
    }

    // Send usage
    yield {
      type: 'usage',
      usage: {
        inputTokens: response.inputTokens ?? 10,
        outputTokens: response.outputTokens ?? content.length / 4,
        totalTokens: (response.inputTokens ?? 10) + (response.outputTokens ?? content.length / 4),
      },
    };

    // Send done
    yield {
      type: 'done',
      finishReason: response.toolCalls?.length ? 'tool_use' : (response.finishReason ?? 'complete'),
    };
  }

  async embed(texts: string[], _model?: string): Promise<Float32Array[]> {
    // Generate deterministic embeddings based on text content
    return texts.map(text => {
      const embedding = new Float32Array(this.embeddingDimensions);
      // Generate pseudo-random but deterministic values based on text
      for (let i = 0; i < this.embeddingDimensions; i++) {
        const charCode = text.charCodeAt(i % text.length) || 0;
        embedding[i] = (Math.sin(charCode * (i + 1)) + 1) / 2;
      }
      // Normalize the vector
      let norm = 0;
      for (let i = 0; i < embedding.length; i++) {
        norm += embedding[i]! * embedding[i]!;
      }
      norm = Math.sqrt(norm);
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] = embedding[i]! / norm;
      }
      return embedding;
    });
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}

/**
 * Factory function to create a MockAdapter
 */
export function createMockAdapter(config?: MockAdapterConfig): MockAdapter {
  return new MockAdapter(config);
}
