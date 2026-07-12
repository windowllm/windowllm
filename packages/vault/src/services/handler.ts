/**
 * Vault Message Handler
 *
 * Handles postMessage communication from client sites
 */

import {
  isClientMessage,
  createVaultResponse,
  type VaultRequest,
  type HandshakeRequest,
  type CompletionRequest,
  type ModelsListRequest,
  type PermissionQueryRequest,
  type EmbeddingRequest,
  type PingRequest,
  type CancelRequest,
} from '@windowllm/protocol';

import type {
  CompletionResult,
  FinishReason,
  ModelCapabilities,
  TokenUsage,
  ToolCall,
} from '@windowllm/types';

import {
  type ProviderAdapter,
  type NormalizedRequest,
  createOpenAIAdapter,
  createAnthropicAdapter,
  createOllamaAdapter,
  createOpenRouterAdapter,
  createGeminiAdapter,
  createMockAdapter,
} from '@windowllm/adapters';

import { getVaultStorage, type StoredProviderConfig, getVaultEncryption } from './storage.js';

/**
 * Capability names that can be granted
 */
type CapabilityName = 'chat' | 'streaming' | 'vision' | 'tools' | 'embeddings' | 'jsonMode' | 'systemPrompt' | 'multiTurn' | 'audioInput' | 'audioOutput';

/**
 * Active session tracking with bound permissions
 */
interface ActiveSession {
  id: string;
  origin: string;
  createdAt: number;
  lastActivity: number;
  /** Capabilities granted at session creation (snapshot) */
  grantedCapabilities: Set<CapabilityName>;
  /** Allowed models (undefined = all allowed) */
  allowedModels?: string[];
  /** Token usage in this session */
  tokenUsage: number;
}

/**
 * Rate limit tracking
 */
interface RateLimitState {
  /** Request timestamps in the current minute window */
  requests: number[];
  /** Tokens used today */
  tokensToday: number;
  /** Start of the current day (midnight timestamp) */
  dayStart: number;
}

/**
 * Vault message handler
 */
export class VaultHandler {
  private adapters = new Map<string, ProviderAdapter>();
  private sessions = new Map<string, ActiveSession>();
  private rateLimits = new Map<string, RateLimitState>();
  private pendingRequests = new Map<string, AbortController>();
  private static readonly MODELS_CACHE_KEY = 'windowllm:models_cache';
  private static readonly MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  // API keys can only be decrypted once the vault is unlocked (the master key is
  // restored from IndexedDB asynchronously). Adapters are therefore built lazily
  // via ensureAdapters() rather than eagerly, so they never cache undefined keys.
  private adaptersUnlocked = false;
  private adapterBuild: Promise<void> | null = null;

  constructor() {
    window.addEventListener('message', this.handleMessage.bind(this));
  }

  /**
   * Check if we're running in an iframe
   */
  private isInIframe(): boolean {
    try {
      return window.self !== window.top;
    } catch {
      // Cross-origin restriction - we're definitely in an iframe
      return true;
    }
  }

  /**
   * Check if we have storage access (Safari ITP uses partitioned storage)
   *
   * Safari's Storage Access API only grants cookie access, not localStorage/IndexedDB.
   * See: https://webkit.org/blog/8124/introducing-storage-access-api/
   * "WebKit's implementation of the API only covers cookies"
   */
  private async hasStorageAccess(): Promise<boolean> {
    // Safari may give iframe partitioned (empty) storage instead of blocking
    // Check if we can see the actual vault data
    //
    // Note: We can't check hasLegacyKey because SimpleObfuscation auto-creates
    // a key when it doesn't find one, so partitioned storage would have its own key.
    // We must check for data that only the main vault creates.

    const hasCryptoSalt = localStorage.getItem('windowllm:crypto_salt') !== null;
    const hasProviders = localStorage.getItem('windowllm:providers') !== null;
    const hasPermissions = localStorage.getItem('windowllm:permissions') !== null;
    const hasSettings = localStorage.getItem('windowllm:settings') !== null;
    const isIframe = this.isInIframe();

    // If we can see any vault data that only the main vault creates, we have real access
    if (hasCryptoSalt || hasProviders || hasPermissions || hasSettings) {
      return true;
    }

    // No vault data visible - could be unconfigured vault OR Safari partitioned storage
    // To distinguish, try a write/read test with a unique key
    if (isIframe) {
      try {
        const testKey = 'windowllm:storage_test';
        const testValue = crypto.randomUUID();
        localStorage.setItem(testKey, testValue);
        const readBack = localStorage.getItem(testKey);
        localStorage.removeItem(testKey);

        // If we can write and read back the same value, localStorage is functional
        // This is an unconfigured vault, not Safari partitioned storage
        if (readBack === testValue) {
          return true;
        }
      } catch {
        // Storage access blocked entirely - this is Safari ITP
        return false;
      }
      // Write/read mismatch - Safari partitioned storage
      return false;
    }

    // Not in iframe, no vault data - first-time user
    return true;
  }

  /**
   * Check if vault uses secure encryption and is currently locked
   * Returns true if secure encryption is set up but vault is locked
   */
  private async isVaultLocked(): Promise<boolean> {
    const encryption = getVaultEncryption();
    // Only check lock status if secure encryption is set up
    // If still using legacy encryption, vault is always "unlocked"
    if (!(await encryption.isSetUp())) {
      return false;
    }
    return encryption.locked;
  }

  /**
   * Send vault locked response with unlock URL
   */
  private sendVaultLocked(requestId: string, origin: string, source: Window): void {
    const unlockUrl = `${window.location.origin}/unlock?returnTo=${encodeURIComponent(origin)}`;
    // Response format compatible with protocol validation (requires id and timestamp)
    const response = {
      protocol: 'windowllm',
      version: '1.0',
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      direction: 'response' as const,
      type: 'vault_locked',
      requestId,
      payload: {
        success: false,
        unlockUrl,
        error: {
          code: 'VAULT_LOCKED',
          message: 'Vault is locked. User must enter passphrase.',
          retryable: true,
        },
      },
    };
    source.postMessage(response, origin);
  }

  /**
   * Send storage access required response (Safari ITP)
   *
   * Safari partitions localStorage for third-party iframes and its Storage Access API
   * only grants cookie access, not localStorage. The browser extension is required.
   */
  private sendStorageAccessRequired(requestId: string, origin: string, source: Window): void {
    const response = {
      protocol: 'windowllm',
      version: '1.0',
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      direction: 'response' as const,
      type: 'storage_access_required',
      requestId,
      payload: {
        success: false,
        error: {
          code: 'SAFARI_EXTENSION_REQUIRED',
          message: 'Safari requires the WindowLLM browser extension. Safari partitions storage for iframes and its Storage Access API only grants cookie access, not localStorage.',
          retryable: false,
        },
      },
    };
    source.postMessage(response, origin);
  }


  private async initializeAdapters(): Promise<void> {
    const storage = getVaultStorage();
    const providers = await storage.getEnabledProviders();

    for (const provider of providers) {
      try {
        const adapter = this.createAdapter(provider);
        if (adapter) {
          // Register by type (e.g., "anthropic", "openrouter") to match model ID prefixes
          // Model IDs are formatted as "provider/model-name" (e.g., "anthropic/claude-3")
          this.adapters.set(provider.type, adapter);
        }
      } catch (error) {
        console.warn(`Failed to initialize adapter for ${provider.id}:`, error);
      }
    }
    // Record whether keys were decryptable when we built these adapters.
    this.adaptersUnlocked = !getVaultEncryption().locked;
  }

  /**
   * Ensure adapters are built with the currently-decryptable keys. They are not
   * built while the vault is locked (keys can't be decrypted), so we (re)build
   * once the vault is unlocked. Serialized so concurrent requests build once.
   */
  private async ensureAdapters(): Promise<void> {
    const stale = this.adapters.size === 0 || (!this.adaptersUnlocked && !getVaultEncryption().locked);
    if (!stale) return;
    if (!this.adapterBuild) {
      this.adapterBuild = (async () => {
        this.adapters.clear();
        await this.initializeAdapters();
      })().finally(() => { this.adapterBuild = null; });
    }
    await this.adapterBuild;
  }

  private createAdapter(config: StoredProviderConfig): ProviderAdapter | null {
    switch (config.type) {
      case 'openai':
        return createOpenAIAdapter({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel,
        });

      case 'anthropic':
        return createAnthropicAdapter({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel,
        });

      case 'ollama':
        return createOllamaAdapter({
          baseUrl: config.baseUrl || 'http://localhost:11434',
        });

      case 'openrouter':
        return createOpenRouterAdapter({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel,
        });

      case 'gemini':
        return createGeminiAdapter({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel,
        });

      case 'custom':
        // Custom uses OpenAI-compatible API
        return createOpenAIAdapter({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel,
        });

      case 'mock':
        // Mock provider for testing
        return createMockAdapter({
          modelId: config.defaultModel || 'mock/test-model',
          modelName: config.name || 'Mock Test Model',
          defaultResponse: {
            content: 'This is a mock response for testing.',
          },
        });

      default:
        return null;
    }
  }

  /**
   * Refresh adapters when configuration changes
   */
  refreshAdapters(): void {
    this.adapters.clear();
    try {
      localStorage.removeItem(VaultHandler.MODELS_CACHE_KEY);
    } catch {
      // Ignore storage errors
    }
    this.initializeAdapters();
  }

  /**
   * Get a session by token, validating origin match
   * Returns null if session not found or origin doesn't match
   */
  private getSession(sessionToken: string, origin: string): ActiveSession | null {
    // Look the session up by its token, then verify the request origin matches
    // the origin that created it. Using `||` here (as this once did) made the
    // token inert — any live session for the origin would be returned.
    const session = this.sessions.get(sessionToken);
    if (!session) return null;
    if (session.origin !== origin) {
      // Origin mismatch — potential session hijacking attempt.
      return null;
    }
    session.lastActivity = Date.now();
    return session;
  }

  /**
   * Invalidate all sessions for a given origin (called when permissions are revoked)
   */
  invalidateSessionsForOrigin(origin: string): void {
    for (const [id, session] of this.sessions) {
      if (session.origin === origin) {
        this.sessions.delete(id);
      }
    }
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const data = event.data;
    if (!isClientMessage(data)) return;

    const origin = event.origin;
    const source = event.source as Window;

    const request = data as VaultRequest;
    const requestId = request.id; // Extract before switch for use in default/catch

    // Check if vault is locked (only applies to operations that need API keys)
    const requiresUnlock = ['handshake', 'completion', 'models_list', 'embedding'].includes(request.type);
    if (requiresUnlock) {
      // Check for storage access first (Safari ITP blocks third-party storage)
      const hasStorage = await this.hasStorageAccess();
      if (!hasStorage) {
        this.sendStorageAccessRequired(requestId, origin, source);
        return;
      }

      // Try to restore session from IndexedDB (in case it was unlocked in another window/popup)
      const encryption = getVaultEncryption();
      await encryption.checkAndRestoreSession();

      if (await this.isVaultLocked()) {
        this.sendVaultLocked(requestId, origin, source);
        return;
      }

      // Touch activity to reset auto-lock timer
      encryption.touchActivity();

      // Build adapters now that the vault is unlocked, so their keys are set.
      await this.ensureAdapters();
    }

    try {
      switch (request.type) {
        case 'handshake':
          await this.handleHandshake(request as HandshakeRequest, origin, source);
          break;

        case 'completion':
          await this.handleCompletion(request as CompletionRequest, origin, source);
          break;

        case 'models_list':
          await this.handleModelsList(request as ModelsListRequest, origin, source);
          break;

        case 'permission_query':
          await this.handlePermissionQuery(request as PermissionQueryRequest, origin, source);
          break;

        case 'embedding':
          await this.handleEmbedding(request as EmbeddingRequest, origin, source);
          break;

        case 'ping':
          await this.handlePing(request as PingRequest, origin, source);
          break;

        case 'cancel':
          this.handleCancel(request as CancelRequest);
          break;

        default:
          this.sendError(requestId, 'INVALID_REQUEST', 'Unknown request type', source, origin);
      }
    } catch (error) {
      console.error('Handler error:', error);
      this.sendError(
        requestId,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Internal error',
        source,
        origin
      );
    }
  }

  private async handleHandshake(
    request: HandshakeRequest,
    origin: string,
    source: Window
  ): Promise<void> {
    const storage = getVaultStorage();
    const settings = await storage.getSettings();
    const isConfigured = await storage.isConfigured();

    if (!isConfigured) {
      const response = createVaultResponse('handshake', request.id, {
        success: false,
        error: {
          code: 'NOT_CONFIGURED',
          message: 'No providers configured. Please visit windowllm.org to set up.',
          retryable: false,
        },
      });
      source.postMessage(response, origin);
      return;
    }

    // Check existing permission
    const permission = await storage.getPermission(origin);
    const grantedCapabilities = permission?.capabilities || [];

    // Auto-approve if origin is in the list
    const autoApprove = settings.autoApproveOrigins.includes(origin);

    if (!permission && !autoApprove && settings.requireApproval) {
      // Need user consent
      const response = createVaultResponse('handshake', request.id, {
        success: true,
        requiresConsent: true,
        grantedCapabilities: [],
      });
      source.postMessage(response, origin);
      return;
    }

    // Create session with bound permissions (snapshot at creation time)
    // Use the same ID for both session storage and client token
    const sessionId = crypto.randomUUID();

    // Determine effective capabilities: use stored permission or defaults
    const effectiveCapabilities = grantedCapabilities.length > 0
      ? grantedCapabilities
      : ['chat', 'streaming'];

    this.sessions.set(sessionId, {
      id: sessionId,
      origin,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      grantedCapabilities: new Set(effectiveCapabilities as CapabilityName[]),
      allowedModels: permission?.allowedModels,
      tokenUsage: 0,
    });

    const response = createVaultResponse('handshake', request.id, {
      success: true,
      sessionToken: sessionId,
      grantedCapabilities: grantedCapabilities.length > 0
        ? grantedCapabilities
        : ['chat', 'streaming'] as (keyof ModelCapabilities)[],
    });
    source.postMessage(response, origin);
  }

  private async handleCompletion(
    request: CompletionRequest,
    origin: string,
    source: Window
  ): Promise<void> {
    // Validate session and check permissions
    const session = this.getSession(request.payload.sessionId, origin);
    if (!session) {
      this.sendError(request.id, 'INVALID_SESSION', 'Session not found or expired', source, origin);
      return;
    }

    // Determine required capability based on request type
    const requiredCapability: CapabilityName = request.payload.stream ? 'streaming' : 'chat';
    if (!session.grantedCapabilities.has(requiredCapability)) {
      this.sendError(
        request.id,
        'PERMISSION_DENIED',
        `Capability '${requiredCapability}' not granted for this session`,
        source,
        origin
      );
      return;
    }

    // Check for tools capability if tools are requested
    if (request.payload.tools && request.payload.tools.length > 0) {
      if (!session.grantedCapabilities.has('tools')) {
        this.sendError(
          request.id,
          'PERMISSION_DENIED',
          "Capability 'tools' not granted for this session",
          source,
          origin
        );
        return;
      }
    }

    // Check rate limit
    const rateCheck = await this.checkRateLimit(origin);
    if (!rateCheck.allowed) {
      const response = createVaultResponse('rate_limit', request.id, {
        retryAfter: rateCheck.retryAfter || 60000,
        limitType: rateCheck.limitType || 'per_minute',
        current: 0,
        limit: 0,
      });
      source.postMessage(response, origin);
      return;
    }

    // Record at admission (before awaiting the provider), so a burst of
    // concurrent requests can't all pass the check before any is counted.
    this.recordRequest(origin);

    // Get model first to determine which adapter to use
    let model = request.payload.options?.model;

    // Get default model if not specified
    if (!model) {
      const storage = getVaultStorage();
      const providers = await storage.getEnabledProviders();
      const provider = providers[0];
      model = provider?.defaultModel;

      if (!model) {
        // Get first model from default adapter's model list
        const defaultAdapter = await this.getDefaultAdapter();
        if (defaultAdapter) {
          try {
            const models = await defaultAdapter.listModels();
            const firstModel = models[0];
            if (firstModel) {
              model = firstModel.id;
            }
          } catch {
            // Fallback if listModels fails
          }
        }
      }
    }

    if (!model) {
      this.sendError(request.id, 'NO_MODEL', 'No model specified and no default available', source, origin);
      return;
    }

    // Check model restrictions
    if (session.allowedModels && !session.allowedModels.includes(model)) {
      this.sendError(
        request.id,
        'MODEL_NOT_ALLOWED',
        `Model '${model}' not in allowed list for this session`,
        source,
        origin
      );
      return;
    }

    // Select adapter based on model's provider prefix
    const adapter = await this.getAdapterForModel(model);
    if (!adapter) {
      this.sendError(request.id, 'NOT_CONFIGURED', 'No provider available for model: ' + model, source, origin);
      return;
    }

    const normalizedRequest: NormalizedRequest = {
      model,
      messages: request.payload.messages,
      tools: request.payload.tools,
      temperature: request.payload.options?.temperature,
      maxTokens: request.payload.options?.maxTokens,
      stopSequences: request.payload.options?.stopSequences,
      stream: request.payload.stream,
    };

    if (request.payload.stream) {
      // Streaming response
      const abortController = new AbortController();
      this.pendingRequests.set(request.id, abortController);

      try {
        let sequence = 0;
        let accumulated = '';
        let finalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        let finishReason: FinishReason = 'complete';
        const toolCalls: ToolCall[] = [];

        let chunksSinceYield = 0;
        for await (const chunk of adapter.stream(normalizedRequest)) {
          if (abortController.signal.aborted) break;

          if (chunk.type === 'text' && chunk.content) {
            accumulated += chunk.content;
            const chunkResponse = createVaultResponse('stream_chunk', request.id, {
              sequence: sequence++,
              content: chunk.content,
              done: false,
              cumulativeLength: accumulated.length,
            });
            source.postMessage(chunkResponse, origin);

            // Yield periodically to allow message events to be processed
            chunksSinceYield++;
            if (chunksSinceYield >= 5) {
              chunksSinceYield = 0;
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }

          if (chunk.type === 'tool_call' && chunk.toolCall?.complete) {
            // Accumulate completed tool calls
            toolCalls.push({
              id: chunk.toolCall.id,
              name: chunk.toolCall.name,
              arguments: JSON.parse(chunk.toolCall.arguments || '{}'),
            });
            finishReason = 'tool_use';
          }

          if (chunk.type === 'usage' && chunk.usage) {
            finalUsage = {
              inputTokens: chunk.usage.inputTokens ?? 0,
              outputTokens: chunk.usage.outputTokens ?? 0,
              totalTokens: chunk.usage.totalTokens ?? 0,
            };
          }

          if (chunk.type === 'done') {
            const doneResponse = createVaultResponse('stream_chunk', request.id, {
              sequence: sequence++,
              content: '',
              done: true,
              cumulativeLength: accumulated.length,
              usage: finalUsage,
              finishReason,
            });
            source.postMessage(doneResponse, origin);
          }
        }

        // Record token usage for rate limiting
        this.recordTokenUsage(origin, finalUsage.totalTokens, session);

        // Send final completion response
        const completionResponse = createVaultResponse('completion', request.id, {
          success: true,
          result: {
            message: {
              role: 'assistant',
              content: accumulated,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            },
            usage: finalUsage,
            finishReason,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          },
        });
        source.postMessage(completionResponse, origin);
      } catch (error) {
        if (!abortController.signal.aborted) {
          this.sendError(
            request.id,
            'PROVIDER_ERROR',
            error instanceof Error ? error.message : 'Stream failed',
            source,
            origin
          );
        }
      } finally {
        this.pendingRequests.delete(request.id);
      }
    } else {
      // Non-streaming response
      try {
        const result = await adapter.complete(normalizedRequest);

        // Record token usage for rate limiting
        this.recordTokenUsage(origin, result.usage.totalTokens, session);

        const response = createVaultResponse('completion', request.id, {
          success: true,
          result: {
            message: result.message,
            usage: result.usage,
            finishReason: result.finishReason,
            toolCalls: result.message.toolCalls,
          } as CompletionResult,
        });
        source.postMessage(response, origin);
      } catch (error) {
        this.sendError(
          request.id,
          'PROVIDER_ERROR',
          error instanceof Error ? error.message : 'Completion failed',
          source,
          origin
        );
      }
    }
    // Note: the request was already counted at admission (see handleCompletion).
  }

  private async handleModelsList(
    request: ModelsListRequest,
    origin: string,
    source: Window
  ): Promise<void> {
    // Don't reveal which providers/models are configured to origins that
    // haven't been granted access — that's a fingerprinting/info-disclosure
    // vector. A site must have a live session or a stored permission first.
    const hasSession = Array.from(this.sessions.values()).some(s => s.origin === origin);
    if (!hasSession) {
      const permission = await getVaultStorage().getPermission(origin);
      if (!permission) {
        const response = createVaultResponse('models_list', request.id, { models: [] });
        source.postMessage(response, origin);
        return;
      }
    }

    // Check localStorage cache first
    const now = Date.now();
    try {
      const cached = localStorage.getItem(VaultHandler.MODELS_CACHE_KEY);
      if (cached) {
        const { models, timestamp } = JSON.parse(cached);
        if ((now - timestamp) < VaultHandler.MODELS_CACHE_TTL) {
          const response = createVaultResponse('models_list', request.id, { models });
          source.postMessage(response, origin);
          return;
        }
      }
    } catch {
      // Ignore cache errors
    }

    // Fetch from all adapters in parallel
    const modelPromises = Array.from(this.adapters.values()).map(async (adapter) => {
      try {
        return await adapter.listModels();
      } catch (error) {
        console.warn(`Failed to list models from adapter:`, error);
        return [];
      }
    });

    const results = await Promise.all(modelPromises);
    const allModels = results.flat();

    // Update localStorage cache
    try {
      localStorage.setItem(VaultHandler.MODELS_CACHE_KEY, JSON.stringify({
        models: allModels,
        timestamp: now,
      }));
    } catch {
      // Ignore storage errors (quota, etc)
    }

    const response = createVaultResponse('models_list', request.id, {
      models: allModels,
    });
    source.postMessage(response, origin);
  }

  private async handlePermissionQuery(
    request: PermissionQueryRequest,
    origin: string,
    source: Window
  ): Promise<void> {
    const storage = getVaultStorage();
    const permission = await storage.getPermission(origin);
    const permissions: Record<string, { granted: boolean; grantedAt?: number; expiresAt?: number }> = {};

    for (const cap of request.payload.capabilities) {
      permissions[cap] = {
        granted: permission?.capabilities.includes(cap) || false,
        grantedAt: permission?.grantedAt,
        expiresAt: permission?.expiresAt,
      };
    }

    const response = createVaultResponse('permission_query', request.id, { permissions });
    source.postMessage(response, origin);
  }

  private async handleEmbedding(
    request: EmbeddingRequest,
    origin: string,
    source: Window
  ): Promise<void> {
    // Validate session and check permissions
    const session = this.getSession(request.payload.sessionId, origin);
    if (!session) {
      this.sendError(request.id, 'INVALID_SESSION', 'Session not found or expired', source, origin);
      return;
    }

    // Check embeddings capability
    if (!session.grantedCapabilities.has('embeddings')) {
      this.sendError(
        request.id,
        'PERMISSION_DENIED',
        "Capability 'embeddings' not granted for this session",
        source,
        origin
      );
      return;
    }

    const model = request.payload.model;
    const adapter = model ? await this.getAdapterForModel(model) : await this.getDefaultAdapter();
    if (!adapter) {
      this.sendError(request.id, 'NOT_CONFIGURED', 'No provider available', source, origin);
      return;
    }

    try {
      const vectors = await adapter.embed(request.payload.texts, model);

      const response = createVaultResponse('embedding', request.id, {
        success: true,
        embeddings: vectors.map((v) => ({
          vector: Array.from(v),
          inputTokens: 0, // Token count not always available
        })),
      });
      source.postMessage(response, origin);
    } catch (error) {
      this.sendError(
        request.id,
        'PROVIDER_ERROR',
        error instanceof Error ? error.message : 'Embedding failed',
        source,
        origin
      );
    }
  }

  private async handlePing(request: PingRequest, origin: string, source: Window): Promise<void> {
    const response = createVaultResponse('pong', request.id, {
      serverTimestamp: Date.now(),
    });
    source.postMessage(response, origin);
  }

  private handleCancel(request: CancelRequest): void {
    const controller = this.pendingRequests.get(request.payload.targetMessageId);
    if (controller) {
      controller.abort();
      this.pendingRequests.delete(request.payload.targetMessageId);
    }
  }

  private sendError(requestId: string, code: string, message: string, source: Window, origin: string): void {
    const response = createVaultResponse('error', requestId, {
      code,
      message,
      retryable: ['RATE_LIMITED', 'PROVIDER_ERROR', 'NETWORK_ERROR'].includes(code),
    });
    source.postMessage(response, origin);
  }

  private async getDefaultAdapter(): Promise<ProviderAdapter | null> {
    const storage = getVaultStorage();
    const settings = await storage.getSettings();

    // Check if a default provider type is configured
    if (settings.defaultProvider) {
      // Try by type first (preferred), then by ID for backwards compatibility
      const adapter = this.adapters.get(settings.defaultProvider);
      if (adapter) return adapter;
    }

    // Return first available adapter (ordered by enabled providers)
    const providers = await storage.getEnabledProviders();
    if (providers.length > 0) {
      const firstProvider = providers[0]!;
      const adapter = this.adapters.get(firstProvider.type);
      if (adapter) return adapter;
    }

    // Fallback: return any available adapter
    const first = this.adapters.values().next();
    return first.done ? null : first.value;
  }

  /**
   * Get adapter for a specific model based on its provider prefix
   * Model IDs can be: "openrouter/anthropic/claude-3", "anthropic/claude-3", "gpt-4", etc.
   */
  private async getAdapterForModel(modelId: string): Promise<ProviderAdapter | null> {
    // Check for provider prefix (e.g., "openrouter/...", "anthropic/...", "ollama/...")
    const firstSlash = modelId.indexOf('/');
    if (firstSlash > 0) {
      const prefix = modelId.substring(0, firstSlash);
      const adapter = this.adapters.get(prefix);
      if (adapter) {
        return adapter;
      }
    }

    // No prefix or unknown prefix - try to infer from model name patterns
    const lowerModel = modelId.toLowerCase();

    if (lowerModel.startsWith('gpt-') || lowerModel.startsWith('o1') || lowerModel.includes('dall-e')) {
      const adapter = this.adapters.get('openai');
      if (adapter) return adapter;
    }

    if (lowerModel.startsWith('claude-')) {
      const adapter = this.adapters.get('anthropic');
      if (adapter) return adapter;
    }

    if (lowerModel.includes('llama') || lowerModel.includes('mistral') || lowerModel.includes('codellama')) {
      const adapter = this.adapters.get('ollama');
      if (adapter) return adapter;
    }

    // Fall back to default adapter
    return this.getDefaultAdapter();
  }

  /**
   * Check if origin is within rate limits
   * Returns { allowed, limitType, retryAfter } for detailed error responses
   */
  private async checkRateLimit(origin: string): Promise<{ allowed: boolean; limitType?: 'per_minute' | 'tokens'; retryAfter?: number }> {
    const storage = getVaultStorage();
    const settings = await storage.getSettings();
    const limit = settings.globalRateLimit;
    const now = Date.now();
    const minuteAgo = now - 60000;
    const todayStart = new Date().setHours(0, 0, 0, 0);

    let state = this.rateLimits.get(origin);

    // Reset daily counters if new day
    if (!state || state.dayStart < todayStart) {
      state = { requests: [], tokensToday: 0, dayStart: todayStart };
      this.rateLimits.set(origin, state);
    }

    // Clean old requests (older than 1 minute)
    state.requests = state.requests.filter(t => t > minuteAgo);

    // Check per-minute request limit
    if (state.requests.length >= limit.requestsPerMinute) {
      const oldestRequest = state.requests[0] || now;
      const retryAfter = 60000 - (now - oldestRequest);
      return { allowed: false, limitType: 'per_minute', retryAfter: Math.max(retryAfter, 1000) };
    }

    // Check daily token limit
    if (state.tokensToday >= limit.tokensPerDay) {
      const msUntilMidnight = new Date().setHours(24, 0, 0, 0) - now;
      return { allowed: false, limitType: 'tokens', retryAfter: msUntilMidnight };
    }

    return { allowed: true };
  }

  /**
   * Record a request (call before processing)
   */
  private recordRequest(origin: string): void {
    const state = this.rateLimits.get(origin);
    if (state) {
      state.requests.push(Date.now());
    }
  }

  /**
   * Record token usage (call after completion with token count)
   */
  private recordTokenUsage(origin: string, tokens: number, session?: ActiveSession): void {
    const state = this.rateLimits.get(origin);
    if (state) {
      state.tokensToday += tokens;
    }
    if (session) {
      session.tokenUsage += tokens;
    }
  }
}

// Singleton handler (initialized when iframe loads)
let handler: VaultHandler | null = null;

export function initializeHandler(): VaultHandler {
  if (!handler) {
    handler = new VaultHandler();
  }
  return handler;
}

export function getHandler(): VaultHandler | null {
  return handler;
}
