/**
 * WindowLLM API Types
 *
 * The main API surface exposed on `window.llm`
 */

import type { Message, CompletionResult, StreamChunk, ToolDefinition } from './messages.js';
import type { ModelCapabilities, ModelLimits, LLMCapabilities } from './capabilities.js';

/**
 * The main entry point exposed on the window object
 */
export interface WindowLLM {
  /** API version string (semver) */
  readonly version: string;

  /** Is LLM access available and configured? */
  readonly available: boolean;

  /** How is this API provided? */
  readonly provider: 'extension' | 'iframe' | 'native';

  /** Permission management */
  readonly permissions: LLMPermissions;

  /** Global capability detection */
  readonly capabilities: LLMCapabilities;

  /** Model discovery and listing */
  readonly models: LLMModelRegistry;

  /** Request a chat session */
  requestSession(options?: SessionOptions): Promise<LLMSession>;

  /** Request an embedding session */
  requestEmbedding(options?: EmbeddingOptions): Promise<EmbeddingSession>;
}

/**
 * Model registry for discovering available models
 */
export interface LLMModelRegistry {
  /** List all available models */
  list(): Promise<LLMModel[]>;

  /** Get a specific model by ID */
  get(id: string): Promise<LLMModel | null>;

  /** Find models matching requirements */
  match(requirements: ModelRequirements): Promise<LLMModel[]>;
}

/**
 * Information about a specific model
 */
export interface LLMModel {
  /** Unique model identifier (e.g., "anthropic/claude-3-opus") */
  readonly id: string;

  /** Human-readable name (e.g., "Claude 3 Opus") */
  readonly name: string;

  /** Provider identifier (e.g., "anthropic") */
  readonly provider: string;

  /** Model capabilities */
  readonly capabilities: ModelCapabilities;

  /** Model limits */
  readonly limits: ModelLimits;

  /**
   * True when this entry comes from the adapter's built-in fallback list
   * (the provider's models endpoint was unreachable), not the live API.
   */
  readonly fallback?: boolean;
}

/**
 * Requirements for matching models
 */
export interface ModelRequirements {
  /** Capability requirements */
  capabilities?: {
    /** Required capabilities (must have all) */
    required?: (keyof ModelCapabilities)[];
    /** Preferred capabilities (nice to have) */
    preferred?: (keyof ModelCapabilities)[];
  };

  /** Limit requirements */
  limits?: {
    /** Minimum context window size */
    minContextWindow?: number;
    /** Minimum output tokens */
    minOutputTokens?: number;
  };

  /** Preference for ranking matched models */
  preference?: 'quality' | 'speed' | 'cost';
}

/**
 * Options for creating a chat session
 */
export interface SessionOptions {
  /** Specific model ID to use */
  model?: string;

  /** Or match by capability requirements */
  capabilities?: ModelRequirements;

  /** System prompt for the session */
  systemPrompt?: string;

  /** Initial conversation messages */
  initialMessages?: Message[];

  /** Tools available in this session */
  tools?: ToolDefinition[];

  /** Response format constraints */
  responseFormat?: ResponseFormat;

  /** Session settings */
  settings?: SessionSettings;

  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Session settings
 */
export interface SessionSettings {
  /** Temperature (0-2, normalized across providers) */
  temperature?: number;

  /** Maximum tokens in response */
  maxTokens?: number;

  /** Stop sequences */
  stopSequences?: string[];
}

/**
 * Response format constraints
 */
export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json'; schema?: JsonSchema }
  | { type: 'json_object' };

/**
 * JSON Schema for structured output
 */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number | boolean | null)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * A chat session
 */
export interface LLMSession {
  /** Unique session identifier */
  readonly id: string;

  /** The model being used */
  readonly model: LLMModel;

  /** Current conversation history */
  readonly messages: readonly Message[];

  /** Tools registered for this session */
  readonly tools: readonly ToolDefinition[];

  /** Session capabilities */
  readonly capabilities: ModelCapabilities;

  /**
   * Send a message and get a complete response
   */
  complete(input: SessionInput): Promise<CompletionResult>;

  /**
   * Send a message and stream the response
   */
  stream(input: SessionInput): AsyncIterable<StreamChunk>;

  /**
   * Clone session with current state (for branching conversations)
   */
  clone(): Promise<LLMSession>;

  /**
   * Clear conversation history (keep system prompt)
   */
  reset(): void;

  /**
   * End the session and release resources
   */
  destroy(): void;
}

/**
 * Input to a session completion
 */
export type SessionInput = string | Message | Message[];

/**
 * Options for creating an embedding session
 */
export interface EmbeddingOptions {
  /** Preferred embedding dimensions */
  dimensions?: number;

  /** Model to use */
  model?: string;

  /** Abort signal */
  signal?: AbortSignal;
}

/**
 * An embedding session
 */
export interface EmbeddingSession {
  /** Session identifier */
  readonly id: string;

  /** Actual dimensions of embeddings */
  readonly dimensions: number;

  /**
   * Generate embedding for a single text
   */
  embed(text: string): Promise<EmbeddingResult>;

  /**
   * Generate embeddings for multiple texts (batched)
   */
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;

  /**
   * End the session
   */
  destroy(): void;
}

/**
 * Result of an embedding operation
 */
export interface EmbeddingResult {
  /** The embedding vector */
  vector: Float32Array;

  /** Input token count */
  inputTokens: number;

  /** Original text (for batch correlation) */
  text: string;
}

/**
 * Permission states following Web Permissions API pattern
 */
export type LLMPermissionState = 'granted' | 'denied' | 'prompt';

/**
 * Permission status object
 */
export interface LLMPermissionStatus extends EventTarget {
  readonly state: LLMPermissionState;
  onchange: ((this: LLMPermissionStatus, ev: Event) => void) | null;
}

/**
 * Permission descriptor
 */
export interface LLMPermissionDescriptor {
  /** The capability being requested */
  name: keyof ModelCapabilities | 'chat' | 'embeddings';

  /** Optional specific requirements */
  requirements?: ModelRequirements;
}

/**
 * Permission management interface
 */
export interface LLMPermissions {
  /**
   * Query current permission state (does NOT trigger prompt)
   */
  query(descriptor: LLMPermissionDescriptor): Promise<LLMPermissionStatus>;

  /**
   * Request permission (MAY trigger prompt)
   */
  request(descriptor: LLMPermissionDescriptor): Promise<LLMPermissionStatus>;

  /**
   * Revoke previously granted permission
   */
  revoke(descriptor: LLMPermissionDescriptor): Promise<LLMPermissionStatus>;
}

// Augment global Window interface
declare global {
  interface Window {
    readonly llm?: WindowLLM;
  }
}
