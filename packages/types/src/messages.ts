/**
 * Message and Content Types
 *
 * Unified message format abstracting provider differences
 */

/**
 * Message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A message in a conversation
 */
export interface Message {
  role: MessageRole;
  content: MessageContent;

  /** For assistant messages with tool calls */
  toolCalls?: ToolCall[];

  /** For tool role messages, the ID of the tool call being responded to */
  toolCallId?: string;

  /** For user messages with tool results */
  toolResults?: ToolResult[];
}

/**
 * Message content - either simple string or multimodal parts
 */
export type MessageContent = string | ContentPart[];

/**
 * A part of multimodal content
 */
export type ContentPart = TextContent | ImageContent | AudioContent;

/**
 * Text content part
 */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * Image content part
 */
export interface ImageContent {
  type: 'image';
  /** Base64 data or URL */
  data: string;
  /** MIME type hint */
  mimeType?: string;
  /** Optional alt text */
  alt?: string;
}

/**
 * Audio content part
 */
export interface AudioContent {
  type: 'audio';
  source: string | Blob;
  /** MIME type hint */
  mimeType?: string;
}

/**
 * Tool definition using JSON Schema
 */
export interface ToolDefinition {
  /** Unique tool name (alphanumeric + underscore) */
  name: string;

  /** Human-readable description for the model */
  description: string;

  /** JSON Schema for tool parameters */
  parameters: ToolParameters;

  /** Strict schema validation */
  strict?: boolean;
}

/**
 * Tool parameters schema
 */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number | boolean | null)[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  default?: unknown;
}

/**
 * A tool call from the model
 */
export interface ToolCall {
  /** Unique ID for matching with results */
  id: string;

  /** Tool name being called */
  name: string;

  /** Parsed arguments */
  arguments: Record<string, unknown>;
}

/**
 * Result of a tool call
 */
export interface ToolResult {
  /** ID of the tool call this responds to */
  toolCallId: string;

  /** Result content */
  content: string | object;

  /** Whether the tool execution succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Result of a completion
 */
export interface CompletionResult {
  /** The assistant's response */
  message: Message;

  /** Usage statistics */
  usage: TokenUsage;

  /** Why the response ended */
  finishReason: FinishReason;

  /** Tool calls to process (if any) */
  toolCalls?: ToolCall[];
}

/**
 * Why a completion ended
 */
export type FinishReason =
  | 'complete'        // Natural completion
  | 'length'          // Hit token limit
  | 'tool_use'        // Awaiting tool results
  | 'content_filter'  // Filtered by provider
  | 'cancelled';      // User/site cancelled

/**
 * Token usage statistics
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  /** Cost estimate if available */
  estimatedCost?: {
    amount: number;
    currency: string;
  };
}

/**
 * A chunk in a streaming response
 */
export type StreamChunk =
  | TextStreamChunk
  | ToolCallStreamChunk
  | UsageStreamChunk
  | ErrorStreamChunk
  | DoneStreamChunk;

/**
 * Text content chunk
 */
export interface TextStreamChunk {
  type: 'text';
  /** Incremental text content */
  text: string;
  /** Accumulated text so far */
  accumulated: string;
}

/**
 * Tool call chunk (streaming)
 */
export interface ToolCallStreamChunk {
  type: 'tool_call';
  /** Tool call being built */
  toolCall: Partial<ToolCall>;
  /** Index in the tool calls array */
  index: number;
  /** Whether this tool call is complete */
  complete: boolean;
}

/**
 * Usage statistics chunk
 */
export interface UsageStreamChunk {
  type: 'usage';
  usage: Partial<TokenUsage>;
}

/**
 * Error chunk
 */
export interface ErrorStreamChunk {
  type: 'error';
  error: {
    code: string;
    message: string;
  };
}

/**
 * Final chunk indicating completion
 */
export interface DoneStreamChunk {
  type: 'done';
  finishReason: FinishReason;
  /** Final complete result */
  result: CompletionResult;
}
