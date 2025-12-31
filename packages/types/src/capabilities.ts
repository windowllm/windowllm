/**
 * Capability Types
 *
 * Model and session capability detection
 */

/**
 * Standardized capability names
 */
export type CapabilityName =
  | 'chat'           // Basic chat completion
  | 'streaming'      // Streaming responses
  | 'tools'          // Tool/function calling
  | 'vision'         // Image input understanding
  | 'embeddings'     // Vector embeddings
  | 'jsonMode'       // Structured JSON output
  | 'systemPrompt'   // Custom system prompts
  | 'multiTurn'      // Conversation context
  | 'audioInput'     // Audio/speech input
  | 'audioOutput';   // Audio/speech output

/**
 * Model capabilities
 */
export interface ModelCapabilities {
  readonly chat: boolean;
  readonly streaming: boolean;
  readonly vision: boolean;
  readonly tools: boolean;
  readonly embeddings: boolean;
  readonly jsonMode: boolean;
  readonly systemPrompt: boolean;
  readonly multiTurn: boolean;
  readonly audioInput: boolean;
  readonly audioOutput: boolean;
}

/**
 * Model limits
 */
export interface ModelLimits {
  /** Maximum tokens in context window */
  readonly contextWindow: number;

  /** Maximum tokens in response */
  readonly maxOutputTokens: number;

  /** Maximum images per request (for vision models) */
  readonly maxImageCount?: number;

  /** Maximum image size in bytes */
  readonly maxImageSize?: number;

  /** Supported image formats */
  readonly supportedImageFormats?: string[];

  /** Embedding dimensions (for embedding models) */
  readonly embeddingDimensions?: number;

  /** Maximum tools per request */
  readonly maxToolCount?: number;
}

/**
 * Detailed capability info
 */
export interface CapabilityInfo {
  /** Whether this capability is available */
  available: boolean;

  /** Provider-specific limits */
  limits?: Partial<ModelLimits>;
}

/**
 * Global capability detection interface
 */
export interface LLMCapabilities {
  /**
   * Check if a specific capability is supported by any configured model
   */
  has(name: CapabilityName): boolean;

  /**
   * Get detailed info about a capability
   */
  get(name: CapabilityName): CapabilityInfo | undefined;

  /**
   * List all available capabilities
   */
  list(): CapabilityName[];

  /**
   * Check if all specified capabilities are supported
   */
  supports(names: CapabilityName[]): boolean;
}

/**
 * Create a ModelCapabilities object with all false defaults
 */
export function createDefaultCapabilities(): ModelCapabilities {
  return {
    chat: false,
    streaming: false,
    vision: false,
    tools: false,
    embeddings: false,
    jsonMode: false,
    systemPrompt: false,
    multiTurn: false,
    audioInput: false,
    audioOutput: false,
  };
}

/**
 * Create a ModelLimits object with sensible defaults
 */
export function createDefaultLimits(): ModelLimits {
  return {
    contextWindow: 4096,
    maxOutputTokens: 4096,
  };
}
