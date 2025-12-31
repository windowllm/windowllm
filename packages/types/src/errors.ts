/**
 * Error Types
 *
 * Standardized error handling for the WindowLLM API
 */

/**
 * Error codes for LLM operations
 */
export type LLMErrorCode =
  | 'PERMISSION_DENIED'       // User denied permission
  | 'NOT_CONFIGURED'          // No provider configured
  | 'CAPABILITY_UNAVAILABLE'  // Requested capability not supported
  | 'MODEL_NOT_FOUND'         // Specified model doesn't exist
  | 'RATE_LIMITED'            // Provider rate limit hit
  | 'QUOTA_EXCEEDED'          // User/provider quota exceeded
  | 'CONTEXT_TOO_LONG'        // Input exceeds context window
  | 'CONTENT_FILTERED'        // Content policy violation
  | 'PROVIDER_ERROR'          // Upstream provider error
  | 'NETWORK_ERROR'           // Network connectivity issue
  | 'TIMEOUT'                 // Request timed out
  | 'CANCELLED'               // Request was cancelled
  | 'SESSION_EXPIRED'         // Session is no longer valid
  | 'SESSION_DESTROYED'       // Session was destroyed
  | 'INVALID_INPUT'           // Malformed input
  | 'TOOL_ERROR'              // Tool execution failed
  | 'STORAGE_ACCESS_DENIED'   // Browser storage access denied
  | 'EXTENSION_REQUIRED'      // Operation requires extension
  | 'UNKNOWN';                // Unclassified error

/**
 * Retryable error codes
 */
export const RETRYABLE_ERROR_CODES: LLMErrorCode[] = [
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'NETWORK_ERROR',
  'TIMEOUT',
];

/**
 * Check if an error code is retryable
 */
export function isRetryableError(code: LLMErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.includes(code);
}

/**
 * Custom error class for LLM API errors
 */
export class LLMError extends Error {
  readonly name = 'LLMError';

  constructor(
    message: string,
    public readonly code: LLMErrorCode,
    public readonly details?: Record<string, unknown>,
    public readonly cause?: Error
  ) {
    super(message);

    // Maintains proper stack trace in V8 environments
    if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, LLMError);
    }
  }

  /** Whether this error is retryable */
  get retryable(): boolean {
    return isRetryableError(this.code);
  }

  /** Suggested retry delay in ms (for rate limits) */
  get retryAfter(): number | undefined {
    return this.details?.retryAfter as number | undefined;
  }

  /** Convert to plain object for serialization */
  toJSON(): LLMErrorJSON {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
    };
  }

  /** Create from plain object */
  static fromJSON(json: LLMErrorJSON): LLMError {
    return new LLMError(json.message, json.code, json.details);
  }
}

/**
 * Serialized error format
 */
export interface LLMErrorJSON {
  name: string;
  message: string;
  code: LLMErrorCode;
  details?: Record<string, unknown>;
  retryable: boolean;
  retryAfter?: number;
}

/**
 * Create a permission denied error
 */
export function permissionDeniedError(capability?: string): LLMError {
  const message = capability
    ? `Permission denied for capability: ${capability}`
    : 'Permission denied';
  return new LLMError(message, 'PERMISSION_DENIED', { capability });
}

/**
 * Create a not configured error
 */
export function notConfiguredError(): LLMError {
  return new LLMError(
    'No LLM provider configured. Please visit windowllm.org to set up your configuration.',
    'NOT_CONFIGURED'
  );
}

/**
 * Create a rate limited error
 */
export function rateLimitedError(retryAfter?: number): LLMError {
  return new LLMError(
    'Rate limit exceeded. Please try again later.',
    'RATE_LIMITED',
    { retryAfter }
  );
}

/**
 * Create a model not found error
 */
export function modelNotFoundError(modelId: string): LLMError {
  return new LLMError(
    `Model not found: ${modelId}`,
    'MODEL_NOT_FOUND',
    { modelId }
  );
}

/**
 * Create a capability unavailable error
 */
export function capabilityUnavailableError(capability: string): LLMError {
  return new LLMError(
    `Capability not available: ${capability}`,
    'CAPABILITY_UNAVAILABLE',
    { capability }
  );
}

/**
 * Create a context too long error
 */
export function contextTooLongError(
  tokenCount: number,
  maxTokens: number
): LLMError {
  return new LLMError(
    `Input exceeds context window: ${tokenCount} tokens (max: ${maxTokens})`,
    'CONTEXT_TOO_LONG',
    { tokenCount, maxTokens }
  );
}

/**
 * Create a cancelled error
 */
export function cancelledError(): LLMError {
  return new LLMError('Request was cancelled', 'CANCELLED');
}

/**
 * Create a session destroyed error
 */
export function sessionDestroyedError(): LLMError {
  return new LLMError(
    'Session has been destroyed and cannot be used',
    'SESSION_DESTROYED'
  );
}
