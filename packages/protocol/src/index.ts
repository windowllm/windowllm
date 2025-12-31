/**
 * @windowllm/protocol
 *
 * postMessage protocol for client-vault communication
 */

import type {
  Message,
  ToolDefinition,
  CompletionResult,
  TokenUsage,
  LLMModel,
  ModelCapabilities,
} from '@windowllm/types';

// Protocol version
export const PROTOCOL_VERSION = '1.0.0';
export const PROTOCOL_IDENTIFIER = 'windowllm';

/**
 * Message ID type (UUID)
 */
export type MessageId = string;

/**
 * Generate a unique message ID
 */
export function generateMessageId(): MessageId {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Base message structure
 */
export interface BaseMessage {
  /** Protocol identifier */
  protocol: typeof PROTOCOL_IDENTIFIER;
  /** Protocol version */
  version: string;
  /** Unique message ID */
  id: MessageId;
  /** Timestamp in milliseconds */
  timestamp: number;
}

// =============================================================================
// Client → Vault Messages
// =============================================================================

export interface ClientMessage extends BaseMessage {
  direction: 'request';
}

export interface HandshakeRequest extends ClientMessage {
  type: 'handshake';
  payload: {
    clientVersion: string;
    requestedCapabilities: (keyof ModelCapabilities)[];
    nonce: string;
  };
}

export interface CompletionRequest extends ClientMessage {
  type: 'completion';
  payload: {
    sessionId: string;
    messages: Message[];
    tools?: ToolDefinition[];
    stream: boolean;
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      stopSequences?: string[];
    };
  };
}

export interface CancelRequest extends ClientMessage {
  type: 'cancel';
  payload: {
    targetMessageId: MessageId;
  };
}

export interface PermissionQueryRequest extends ClientMessage {
  type: 'permission_query';
  payload: {
    capabilities: (keyof ModelCapabilities)[];
  };
}

export interface ModelsListRequest extends ClientMessage {
  type: 'models_list';
  payload: Record<string, never>;
}

export interface EmbeddingRequest extends ClientMessage {
  type: 'embedding';
  payload: {
    sessionId: string;
    texts: string[];
    model?: string;
  };
}

export interface PingRequest extends ClientMessage {
  type: 'ping';
  payload: Record<string, never>;
}

export type VaultRequest =
  | HandshakeRequest
  | CompletionRequest
  | CancelRequest
  | PermissionQueryRequest
  | ModelsListRequest
  | EmbeddingRequest
  | PingRequest;

// =============================================================================
// Vault → Client Messages
// =============================================================================

export interface VaultMessage extends BaseMessage {
  direction: 'response';
  requestId: MessageId;
}

export interface HandshakeResponse extends VaultMessage {
  type: 'handshake';
  payload: {
    success: boolean;
    sessionToken?: string;
    grantedCapabilities?: (keyof ModelCapabilities)[];
    requiresConsent?: boolean;
    error?: ErrorPayload;
  };
}

export interface CompletionResponse extends VaultMessage {
  type: 'completion';
  payload: {
    success: boolean;
    result?: CompletionResult;
    error?: ErrorPayload;
  };
}

export interface StreamChunkResponse extends VaultMessage {
  type: 'stream_chunk';
  payload: {
    sequence: number;
    content: string;
    done: boolean;
    cumulativeLength: number;
    usage?: TokenUsage;
    finishReason?: string;
  };
}

export interface StreamErrorResponse extends VaultMessage {
  type: 'stream_error';
  payload: {
    atSequence: number;
    error: ErrorPayload;
  };
}

export interface PermissionQueryResponse extends VaultMessage {
  type: 'permission_query';
  payload: {
    permissions: Record<string, PermissionState>;
  };
}

export interface ModelsListResponse extends VaultMessage {
  type: 'models_list';
  payload: {
    models: LLMModel[];
  };
}

export interface EmbeddingResponse extends VaultMessage {
  type: 'embedding';
  payload: {
    success: boolean;
    embeddings?: Array<{
      vector: number[];
      inputTokens: number;
    }>;
    error?: ErrorPayload;
  };
}

export interface RateLimitResponse extends VaultMessage {
  type: 'rate_limit';
  payload: {
    retryAfter: number;
    limitType: 'per_minute' | 'per_hour' | 'per_day' | 'tokens' | 'concurrent';
    current: number;
    limit: number;
  };
}

export interface ConsentRequiredResponse extends VaultMessage {
  type: 'consent_required';
  payload: {
    consentFlowId: string;
    requestedCapabilities: (keyof ModelCapabilities)[];
  };
}

export interface ConsentResultResponse extends VaultMessage {
  type: 'consent_result';
  payload: {
    granted: boolean;
    grantedCapabilities?: (keyof ModelCapabilities)[];
    denied?: boolean;
    dismissed?: boolean;
  };
}

export interface PongResponse extends VaultMessage {
  type: 'pong';
  payload: {
    serverTimestamp: number;
  };
}

export interface ErrorResponse extends VaultMessage {
  type: 'error';
  payload: ErrorPayload;
}

export type VaultResponse =
  | HandshakeResponse
  | CompletionResponse
  | StreamChunkResponse
  | StreamErrorResponse
  | PermissionQueryResponse
  | ModelsListResponse
  | EmbeddingResponse
  | RateLimitResponse
  | ConsentRequiredResponse
  | ConsentResultResponse
  | PongResponse
  | ErrorResponse;

// =============================================================================
// Supporting Types
// =============================================================================

export interface ErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface PermissionState {
  granted: boolean;
  grantedAt?: number;
  expiresAt?: number;
}

/**
 * Check if a message is a valid WindowLLM protocol message
 */
export function isProtocolMessage(data: unknown): data is BaseMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as BaseMessage).protocol === PROTOCOL_IDENTIFIER &&
    typeof (data as BaseMessage).id === 'string' &&
    typeof (data as BaseMessage).version === 'string'
  );
}

/**
 * Check if a message is a client request
 */
export function isClientMessage(data: unknown): data is VaultRequest {
  return isProtocolMessage(data) && (data as ClientMessage).direction === 'request';
}

/**
 * Check if a message is a vault response
 */
export function isVaultMessage(data: unknown): data is VaultResponse {
  return isProtocolMessage(data) && (data as VaultMessage).direction === 'response';
}

/**
 * Create a client message
 */
export function createClientMessage<T extends VaultRequest['type']>(
  type: T,
  payload: Extract<VaultRequest, { type: T }>['payload']
): Extract<VaultRequest, { type: T }> {
  return {
    protocol: PROTOCOL_IDENTIFIER,
    version: PROTOCOL_VERSION,
    id: generateMessageId(),
    timestamp: Date.now(),
    direction: 'request',
    type,
    payload,
  } as Extract<VaultRequest, { type: T }>;
}

/**
 * Create a vault response
 */
export function createVaultResponse<T extends VaultResponse['type']>(
  type: T,
  requestId: MessageId,
  payload: Extract<VaultResponse, { type: T }>['payload']
): Extract<VaultResponse, { type: T }> {
  return {
    protocol: PROTOCOL_IDENTIFIER,
    version: PROTOCOL_VERSION,
    id: generateMessageId(),
    timestamp: Date.now(),
    direction: 'response',
    requestId,
    type,
    payload,
  } as Extract<VaultResponse, { type: T }>;
}
