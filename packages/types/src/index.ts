/**
 * @windowllm/types
 *
 * TypeScript types for the WindowLLM API
 */

// API types
export type {
  WindowLLM,
  LLMModelRegistry,
  LLMModel,
  ModelRequirements,
  SessionOptions,
  SessionSettings,
  ResponseFormat,
  JsonSchema,
  JsonSchemaProperty,
  LLMSession,
  SessionInput,
  EmbeddingOptions,
  EmbeddingSession,
  EmbeddingResult,
  LLMPermissionState,
  LLMPermissionStatus,
  LLMPermissionDescriptor,
  LLMPermissions,
} from './api.js';

// Message types
export type {
  MessageRole,
  Message,
  MessageContent,
  ContentPart,
  TextContent,
  ImageContent,
  AudioContent,
  ToolDefinition,
  ToolParameters,
  ToolParameterProperty,
  ToolCall,
  ToolResult,
  CompletionResult,
  FinishReason,
  TokenUsage,
  StreamChunk,
  TextStreamChunk,
  ToolCallStreamChunk,
  UsageStreamChunk,
  ErrorStreamChunk,
  DoneStreamChunk,
} from './messages.js';

// Capability types
export type {
  CapabilityName,
  ModelCapabilities,
  ModelLimits,
  CapabilityInfo,
  LLMCapabilities,
} from './capabilities.js';

export {
  createDefaultCapabilities,
  createDefaultLimits,
} from './capabilities.js';

// Error types
export type {
  LLMErrorCode,
  LLMErrorJSON,
} from './errors.js';

export {
  LLMError,
  RETRYABLE_ERROR_CODES,
  isRetryableError,
  permissionDeniedError,
  notConfiguredError,
  rateLimitedError,
  modelNotFoundError,
  capabilityUnavailableError,
  contextTooLongError,
  cancelledError,
  sessionDestroyedError,
} from './errors.js';
