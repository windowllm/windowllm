/**
 * @windowllm/client
 *
 * The WindowLLM client library (llm.js)
 *
 * This script exposes `window.llm` for websites to access LLM capabilities.
 * It communicates with the vault via postMessage for iframe-based implementation,
 * or defers to an existing extension-provided implementation.
 */

import type {
  WindowLLM,
  LLMSession,
  LLMModel,
  LLMModelRegistry,
  LLMPermissions,
  LLMPermissionStatus,
  LLMPermissionDescriptor,
  LLMPermissionState,
  LLMCapabilities,
  SessionOptions,
  SessionInput,
  EmbeddingOptions,
  EmbeddingSession,
  EmbeddingResult,
  Message,
  CompletionResult,
  StreamChunk,
  ToolDefinition,
  ModelCapabilities,
  ModelRequirements,
  CapabilityName,
  CapabilityInfo,
} from '@windowllm/types';

import {
  createClientMessage,
  isVaultMessage,
  type MessageId,
  type VaultResponse,
  type HandshakeResponse,
  type CompletionResponse,
  type StreamChunkResponse,
  type ModelsListResponse,
  type PermissionQueryResponse,
  type EmbeddingResponse,
} from '@windowllm/protocol';

// Vault URL - configurable for development
const VAULT_URL = (globalThis as { WINDOWLLM_VAULT_URL?: string }).WINDOWLLM_VAULT_URL
  || 'https://windowllm.org/vault/frame';

// Base vault URL (for popups that need full UI)
const VAULT_BASE_URL = VAULT_URL.replace(/\/frame(\.html)?$/, '');

// Version of this client
const CLIENT_VERSION = '1.0.0';

/**
 * Pending request tracking
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onChunk?: (chunk: StreamChunkResponse['payload']) => void;
}

/**
 * WindowLLM Client Implementation
 */
class WindowLLMClient implements WindowLLM {
  readonly version = CLIENT_VERSION;
  readonly provider: 'extension' | 'iframe' | 'native' = 'iframe';

  private iframe: HTMLIFrameElement | null = null;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private pendingRequests = new Map<MessageId, PendingRequest>();
  private sessionToken: string | null = null;
  private grantedCapabilities: (keyof ModelCapabilities)[] = [];
  private _available = false;
  private unlockPopup: Window | null = null;
  private unlockPromise: Promise<boolean> | null = null;
  private unlockResolve: ((unlocked: boolean) => void) | null = null;

  // Sub-interfaces
  readonly permissions: LLMPermissions;
  readonly capabilities: LLMCapabilities;
  readonly models: LLMModelRegistry;

  constructor() {
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.permissions = new ClientPermissions(this);
    this.capabilities = new ClientCapabilities(this);
    this.models = new ClientModelRegistry(this);

    // Start initialization
    this.init();
  }

  get available(): boolean {
    return this._available;
  }

  /**
   * Get the session token from the vault handshake
   */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  /**
   * Perform handshake with consent flow if needed
   */
  private async performHandshake(): Promise<HandshakeResponse> {
    const handshake = await this.sendRequest<HandshakeResponse>('handshake', {
      clientVersion: CLIENT_VERSION,
      requestedCapabilities: ['chat', 'streaming'],
      nonce: crypto.randomUUID(),
    });

    // Check if consent is required
    const payload = handshake.payload as { requiresConsent?: boolean; success?: boolean };
    if (payload.requiresConsent) {
      console.log('WindowLLM: Consent required, opening permission dialog');

      // Open consent popup (use base URL, not frame URL)
      const consentUrl = `${VAULT_BASE_URL}?consent=true&origin=${encodeURIComponent(window.location.origin)}`;
      const granted = await this.openConsentPopup(consentUrl);

      if (granted) {
        // Retry handshake after consent
        return this.sendRequest<HandshakeResponse>('handshake', {
          clientVersion: CLIENT_VERSION,
          requestedCapabilities: ['chat', 'streaming'],
          nonce: crypto.randomUUID(),
        });
      } else {
        throw new Error('Permission denied by user');
      }
    }

    return handshake;
  }

  /**
   * Open consent popup and wait for result
   */
  private openConsentPopup(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const features = this.getPopupFeatures(500, 600);
      const popup = window.open(url, 'windowllm-consent', features);

      if (!popup) {
        // Popup blocked - show overlay instead
        this.showConsentOverlay(url, resolve);
        return;
      }

      // Listen for consent result
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== new URL(VAULT_BASE_URL).origin) return;
        if (event.data?.type === 'consent_result') {
          window.removeEventListener('message', handleMessage);
          popup.close();
          resolve(event.data.granted === true);
        }
      };

      window.addEventListener('message', handleMessage);

      // Check if popup was closed without granting
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          resolve(false);
        }
      }, 500);
    });
  }

  /**
   * Show consent overlay when popup is blocked
   */
  private showConsentOverlay(url: string, resolve: (granted: boolean) => void): void {
    const overlay = document.createElement('div');
    overlay.id = 'windowllm-consent-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      padding: 24px;
      border-radius: 12px;
      text-align: center;
      max-width: 400px;
      font-family: system-ui, sans-serif;
    `;

    dialog.innerHTML = `
      <h2 style="margin: 0 0 12px 0; font-size: 18px;">Permission Required</h2>
      <p style="margin: 0 0 20px 0; color: #666;">
        This site wants to use WindowLLM to access AI models.
        Click below to grant permission.
      </p>
      <button id="windowllm-consent-btn" style="
        background: #3b82f6;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
      ">Grant Permission</button>
      <button id="windowllm-consent-cancel" style="
        background: transparent;
        color: #666;
        border: 1px solid #ccc;
        padding: 12px 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
        margin-left: 8px;
      ">Cancel</button>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = () => {
      overlay.remove();
    };

    document.getElementById('windowllm-consent-btn')?.addEventListener('click', () => {
      cleanup();
      const popup = window.open(url, 'windowllm-consent', this.getPopupFeatures(500, 600));

      if (popup) {
        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== new URL(VAULT_BASE_URL).origin) return;
          if (event.data?.type === 'consent_result') {
            window.removeEventListener('message', handleMessage);
            popup.close();
            resolve(event.data.granted === true);
          }
        };

        window.addEventListener('message', handleMessage);

        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', handleMessage);
            resolve(false);
          }
        }, 500);
      } else {
        resolve(false);
      }
    });

    document.getElementById('windowllm-consent-cancel')?.addEventListener('click', () => {
      cleanup();
      resolve(false);
    });
  }

  /**
   * Calculate centered popup position
   */
  private getPopupFeatures(width: number, height: number): string {
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    return [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
    ].join(',');
  }

  /**
   * Detect Safari browser
   */
  private isSafari(): boolean {
    const ua = navigator.userAgent;
    return ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Chromium');
  }

  /**
   * Open a popup window (Safari-compatible)
   */
  private openPopupWindow(url: string): Window | null {
    // Use centered popup for all browsers
    // Safari requires user gesture (button click) which we have from overlay
    const features = this.getPopupFeatures(400, 500);
    return window.open(url, '_blank', features);
  }

  /**
   * Show unlock overlay with button (for when popup is blocked or cancelled)
   */
  private showUnlockOverlay(unlockUrl: string, cancelled = false): void {
    // Remove existing overlay if any
    this.removeUnlockOverlay();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'windowllm-unlock-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 24px 32px;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    `;

    const title = cancelled ? 'Unlock Cancelled' : 'Vault Locked';
    const message = cancelled
      ? 'You closed the unlock window. Click below to try again.'
      : 'WindowLLM vault is locked. Click below to unlock it.';

    dialog.innerHTML = `
      <h2 style="margin: 0 0 12px; font-size: 18px; color: #1a1a1a;">${title}</h2>
      <p style="margin: 0 0 20px; color: #666; font-size: 14px; line-height: 1.5;">
        ${message}
      </p>
    `;

    const button = document.createElement('button');
    button.textContent = cancelled ? 'Try Again' : 'Unlock Vault';
    button.style.cssText = `
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    `;
    button.onmouseover = () => button.style.background = '#1d4ed8';
    button.onmouseout = () => button.style.background = '#2563eb';
    button.onclick = () => {
      this.unlockPopup = this.openPopupWindow(unlockUrl);
      if (this.unlockPopup && !this.unlockPopup.closed) {
        overlay.remove();
        this.startPopupCloseWatcher(unlockUrl);
      }
    };

    dialog.appendChild(button);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  /**
   * Remove unlock overlay if present
   */
  private removeUnlockOverlay(): void {
    document.getElementById('windowllm-unlock-overlay')?.remove();
  }

  /**
   * Watch for popup close and handle cleanup
   */
  private startPopupCloseWatcher(unlockUrl: string): void {
    const checkClosed = setInterval(() => {
      if (this.unlockPopup?.closed) {
        clearInterval(checkClosed);
        // Give a small grace period for the vault_unlocked message
        setTimeout(() => {
          if (this.unlockResolve) {
            // Still not resolved - user closed without unlocking
            // Show the cancelled overlay with retry option
            this.showUnlockOverlay(unlockUrl, true);
            this.unlockPopup = null;
            // Don't resolve yet - wait for user to click retry or navigate away
          }
        }, 500);
      }
    }, 500);
  }

  /**
   * Open unlock popup and wait for vault to be unlocked
   * Returns true if unlocked, false if cancelled
   */
  private async openUnlockPopup(unlockUrl: string): Promise<boolean> {
    // If already unlocking, wait for that to complete
    if (this.unlockPromise) {
      return this.unlockPromise;
    }

    this.unlockPromise = new Promise<boolean>((resolve) => {
      this.unlockResolve = resolve;
    });

    // Safari blocks programmatic popups - always show overlay for user gesture
    if (this.isSafari()) {
      this.showUnlockOverlay(unlockUrl);
    } else {
      // Try to open popup (may be blocked without user gesture)
      this.unlockPopup = this.openPopupWindow(unlockUrl);

      if (!this.unlockPopup || this.unlockPopup.closed) {
        // Popup was blocked - show overlay with button
        this.showUnlockOverlay(unlockUrl);
      } else {
        // Popup opened successfully
        this.startPopupCloseWatcher(unlockUrl);
      }
    }

    const unlocked = await this.unlockPromise;
    this.unlockPromise = null;
    this.removeUnlockOverlay();
    return unlocked;
  }

  /**
   * Handle vault unlocked notification from popup
   */
  private handleVaultUnlocked(): void {
    if (this.unlockResolve) {
      this.unlockResolve(true);
      this.unlockResolve = null;
    }
    if (this.unlockPopup && !this.unlockPopup.closed) {
      this.unlockPopup.close();
    }
    this.unlockPopup = null;
    this.removeUnlockOverlay();
  }


  /**
   * Show Safari extension required message
   * Safari's Storage Access API only grants cookie access, not localStorage
   */
  private showSafariExtensionRequired(): void {
    this.removeUnlockOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'windowllm-unlock-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 24px 32px;
      max-width: 450px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    `;

    dialog.innerHTML = `
      <h2 style="margin: 0 0 12px; font-size: 18px; color: #1a1a1a;">Safari Extension Required</h2>
      <p style="margin: 0 0 16px; color: #666; font-size: 14px; line-height: 1.5;">
        Safari's privacy protections prevent WindowLLM from accessing your vault in iframe mode.
      </p>
      <p style="margin: 0 0 20px; color: #888; font-size: 13px; line-height: 1.5;">
        Please install the WindowLLM browser extension for Safari, or use Chrome/Firefox for iframe mode.
      </p>
    `;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 12px; justify-content: center;';

    const extensionButton = document.createElement('a');
    extensionButton.href = 'https://windowllm.org/extension';
    extensionButton.target = '_blank';
    extensionButton.textContent = 'Get Extension';
    extensionButton.style.cssText = `
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    `;

    const dismissButton = document.createElement('button');
    dismissButton.textContent = 'Dismiss';
    dismissButton.style.cssText = `
      background: #e5e7eb;
      color: #374151;
      border: none;
      border-radius: 8px;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    `;
    dismissButton.onclick = () => overlay.remove();

    buttonContainer.appendChild(extensionButton);
    buttonContainer.appendChild(dismissButton);
    dialog.appendChild(buttonContainer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }


  private async init() {
    try {
      // Create hidden iframe
      this.iframe = document.createElement('iframe');
      this.iframe.style.display = 'none';
      this.iframe.src = VAULT_URL;
      this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      this.iframe.setAttribute('allow', 'storage-access');

      // Listen for messages
      window.addEventListener('message', this.handleMessage.bind(this));

      // Wait for iframe to load
      await new Promise<void>((resolve, reject) => {
        if (!this.iframe) return reject(new Error('Iframe not created'));

        this.iframe.onload = () => resolve();
        this.iframe.onerror = () => reject(new Error('Failed to load vault iframe'));

        document.body.appendChild(this.iframe);

        // Timeout after 10 seconds
        setTimeout(() => reject(new Error('Vault connection timeout')), 10000);
      });

      // Perform handshake
      const handshake = await this.performHandshake();

      if (handshake.payload.success && handshake.payload.sessionToken) {
        this.sessionToken = handshake.payload.sessionToken;
        this.grantedCapabilities = handshake.payload.grantedCapabilities || [];
        this._available = true;
        this.readyResolve();
      } else {
        throw new Error(handshake.payload.error?.message || 'Handshake failed');
      }
    } catch (error) {
      console.warn('WindowLLM: Failed to connect to vault', error);
      this._available = false;
      this.readyReject(error as Error);
    }
  }

  private handleMessage(event: MessageEvent) {
    // Only accept messages from vault origin (exact match)
    const vaultOrigin = new URL(VAULT_URL).origin;
    if (event.origin !== vaultOrigin) return;

    const data = event.data;

    // Handle vault_unlocked notification from popup
    if (data?.type === 'vault_unlocked') {
      this.handleVaultUnlocked();
      return;
    }

    if (!isVaultMessage(data)) return;

    const response = data as VaultResponse;
    const pending = this.pendingRequests.get(response.requestId);

    if (!pending) return;

    // Handle streaming chunks
    if (response.type === 'stream_chunk' && pending.onChunk) {
      pending.onChunk((response as StreamChunkResponse).payload);
      if (!(response as StreamChunkResponse).payload.done) {
        return; // Don't resolve yet, more chunks coming
      }
    }

    // Handle errors
    if (response.type === 'error') {
      pending.reject(new Error((response as { payload: { message: string } }).payload.message));
    } else {
      pending.resolve(response);
    }

    this.pendingRequests.delete(response.requestId);
  }

  async sendRequest<T extends VaultResponse>(
    type: string,
    payload: Record<string, unknown>,
    onChunk?: (chunk: StreamChunkResponse['payload']) => void
  ): Promise<T> {
    if (!this.iframe?.contentWindow) {
      throw new Error('Vault not connected');
    }

    const message = createClientMessage(type as 'handshake', payload as never);

    const response = await new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout>;

      const resetTimeout = () => {
        clearTimeout(timeoutId);
        // 30 second timeout, reset on each chunk for streaming
        timeoutId = setTimeout(() => {
          if (this.pendingRequests.has(message.id)) {
            this.pendingRequests.delete(message.id);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      };

      // Wrap onChunk to reset timeout on each chunk
      const wrappedOnChunk = onChunk ? (chunk: StreamChunkResponse['payload']) => {
        resetTimeout();
        onChunk(chunk);
      } : undefined;

      this.pendingRequests.set(message.id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onChunk: wrappedOnChunk,
      });

      this.iframe!.contentWindow!.postMessage(message, VAULT_URL);
      resetTimeout();
    });

    // Check if Safari extension is required
    const responsePayload = response.payload as {
      unlockUrl?: string;
      error?: { code?: string; message?: string }
    };

    if (responsePayload.error?.code === 'SAFARI_EXTENSION_REQUIRED') {
      // Safari's Storage Access API doesn't grant localStorage access
      // Show a helpful message and fail gracefully
      this.showSafariExtensionRequired();
      throw new Error(responsePayload.error.message || 'Safari requires the WindowLLM browser extension');
    }

    // Check if vault is locked and needs unlocking
    if (responsePayload.unlockUrl && responsePayload.error?.code === 'VAULT_LOCKED') {
      // Open unlock popup and wait
      const unlocked = await this.openUnlockPopup(responsePayload.unlockUrl);

      if (unlocked) {
        // Retry the request after unlocking
        return this.sendRequest<T>(type, payload, onChunk);
      } else {
        // User cancelled unlock
        throw new Error('Vault unlock cancelled');
      }
    }

    return response;
  }

  async waitForReady(): Promise<void> {
    return this.readyPromise;
  }

  async requestSession(options?: SessionOptions): Promise<LLMSession> {
    await this.waitForReady();
    const session = new ClientSession(this, options);
    await session.initialize();
    return session;
  }

  async requestEmbedding(options?: EmbeddingOptions): Promise<EmbeddingSession> {
    await this.waitForReady();
    return new ClientEmbeddingSession(this, options);
  }

  getGrantedCapabilities(): (keyof ModelCapabilities)[] {
    return this.grantedCapabilities;
  }
}

/**
 * Client-side session implementation
 */
class ClientSession implements LLMSession {
  readonly id: string;
  private client: WindowLLMClient;
  private _messages: Message[] = [];
  private _tools: ToolDefinition[] = [];
  private _model: LLMModel | null = null;
  private requestedModel?: string;
  private systemPrompt?: string;
  private settings: SessionOptions['settings'];
  private destroyed = false;

  constructor(client: WindowLLMClient, options?: SessionOptions) {
    // Use the session token from vault handshake, or generate a fallback
    this.id = client.getSessionToken() || crypto.randomUUID();
    this.client = client;
    this.systemPrompt = options?.systemPrompt;
    this._tools = options?.tools || [];
    this.settings = options?.settings;
    this.requestedModel = options?.model;

    if (options?.initialMessages) {
      this._messages = [...options.initialMessages];
    }
  }

  async initialize(): Promise<void> {
    // Fetch model info from vault
    try {
      const models = await this.client.models.list();
      if (this.requestedModel) {
        // Find the specific requested model
        this._model = models.find(m => m.id === this.requestedModel) || null;
      }
      if (!this._model && models.length > 0) {
        // Use the first available model as default
        this._model = models[0] ?? null;
      }
    } catch (error) {
      console.warn('WindowLLM: Failed to fetch model info', error);
    }
  }

  get model(): LLMModel {
    if (!this._model) {
      // Return a placeholder until we get the actual model
      return {
        id: 'unknown',
        name: 'Unknown Model',
        provider: 'unknown',
        capabilities: {
          chat: true,
          streaming: true,
          vision: false,
          tools: false,
          embeddings: false,
          jsonMode: false,
          systemPrompt: true,
          multiTurn: true,
          audioInput: false,
          audioOutput: false,
        },
        limits: {
          contextWindow: 4096,
          maxOutputTokens: 4096,
        },
      };
    }
    return this._model;
  }

  get messages(): readonly Message[] {
    return this._messages;
  }

  get tools(): readonly ToolDefinition[] {
    return this._tools;
  }

  get capabilities(): ModelCapabilities {
    return this.model.capabilities;
  }

  async complete(input: SessionInput): Promise<CompletionResult> {
    this.checkDestroyed();

    const messages = this.buildMessages(input);

    const response = await this.client.sendRequest<CompletionResponse>('completion', {
      sessionId: this.id,
      messages,
      tools: this._tools.length > 0 ? this._tools : undefined,
      stream: false,
      options: {
        model: this.model.id,
        temperature: this.settings?.temperature,
        maxTokens: this.settings?.maxTokens,
        stopSequences: this.settings?.stopSequences,
      },
    });

    if (!response.payload.success || !response.payload.result) {
      throw new Error(response.payload.error?.message || 'Completion failed');
    }

    const result = response.payload.result;

    // Add messages to history
    if (typeof input === 'string') {
      this._messages.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
      this._messages.push(...input);
    } else {
      this._messages.push(input);
    }
    this._messages.push(result.message);

    return result;
  }

  async *stream(input: SessionInput): AsyncIterable<StreamChunk> {
    this.checkDestroyed();

    const messages = this.buildMessages(input);
    let accumulated = '';
    let finalResult: CompletionResult | null = null;

    const chunks: StreamChunkResponse['payload'][] = [];
    let resolveNext: ((done: boolean) => void) | null = null;

    // Send request with chunk handler
    const responsePromise = this.client.sendRequest<CompletionResponse>(
      'completion',
      {
        sessionId: this.id,
        messages,
        tools: this._tools.length > 0 ? this._tools : undefined,
        stream: true,
        options: {
          model: this.model.id,
          temperature: this.settings?.temperature,
          maxTokens: this.settings?.maxTokens,
          stopSequences: this.settings?.stopSequences,
        },
      },
      (chunk) => {
        chunks.push(chunk);
        if (resolveNext) {
          resolveNext(chunk.done);
          resolveNext = null;
        }
      }
    );

    // Yield chunks as they arrive
    let chunkIndex = 0;
    while (true) {
      if (chunkIndex < chunks.length) {
        const chunk = chunks[chunkIndex++];
        if (!chunk) continue;
        accumulated += chunk.content;

        if (chunk.done) {
          // Get final result
          try {
            const response = await responsePromise;
            if (response.payload.success && response.payload.result) {
              finalResult = response.payload.result;
            }
          } catch {
            // Ignore errors on final response
          }

          const result: CompletionResult = finalResult || {
            message: { role: 'assistant', content: accumulated },
            usage: chunk.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            finishReason: (chunk.finishReason as CompletionResult['finishReason']) || 'complete',
          };

          yield {
            type: 'done',
            result,
            finishReason: result.finishReason,
          };
          break;
        }

        yield {
          type: 'text',
          text: chunk.content,
          accumulated,
        };

        // Give browser a chance to repaint between chunks
        await new Promise((resolve) => setTimeout(resolve, 0));
      } else {
        // Wait for next chunk
        await new Promise<boolean>((resolve) => {
          resolveNext = resolve;
        });
      }
    }

    // Update message history
    if (typeof input === 'string') {
      this._messages.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
      this._messages.push(...input);
    } else {
      this._messages.push(input);
    }
    this._messages.push({ role: 'assistant', content: accumulated });
  }

  async clone(): Promise<LLMSession> {
    this.checkDestroyed();
    const cloned = new ClientSession(this.client, {
      systemPrompt: this.systemPrompt,
      tools: [...this._tools],
      settings: this.settings,
      initialMessages: [...this._messages],
    });
    cloned._model = this._model;
    return cloned;
  }

  reset(): void {
    this.checkDestroyed();
    this._messages = [];
  }

  destroy(): void {
    this.destroyed = true;
  }

  private checkDestroyed(): void {
    if (this.destroyed) {
      throw new Error('Session has been destroyed');
    }
  }

  private buildMessages(input: SessionInput): Message[] {
    const messages = [...this._messages];

    if (this.systemPrompt && messages.length === 0) {
      // System prompt is handled separately in the protocol
    }

    if (typeof input === 'string') {
      messages.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
      messages.push(...input);
    } else {
      messages.push(input);
    }

    return messages;
  }
}

/**
 * Client-side embedding session
 */
class ClientEmbeddingSession implements EmbeddingSession {
  readonly id: string;
  readonly dimensions: number;
  private client: WindowLLMClient;
  private modelId?: string;
  private destroyed = false;

  constructor(client: WindowLLMClient, options?: EmbeddingOptions) {
    // Use the session token from vault handshake, or generate a fallback
    this.id = client.getSessionToken() || crypto.randomUUID();
    this.client = client;
    this.dimensions = options?.dimensions || 1536;
    this.modelId = options?.model;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    if (!results[0]) throw new Error('Embedding returned no result');
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    this.checkDestroyed();

    const response = await this.client.sendRequest<EmbeddingResponse>('embedding', {
      sessionId: this.id,
      texts,
      model: this.modelId,
    });

    if (!response.payload.success || !response.payload.embeddings) {
      throw new Error(response.payload.error?.message || 'Embedding failed');
    }

    return response.payload.embeddings.map((e, i) => ({
      vector: new Float32Array(e.vector),
      inputTokens: e.inputTokens,
      text: texts[i] ?? '',
    }));
  }

  destroy(): void {
    this.destroyed = true;
  }

  private checkDestroyed(): void {
    if (this.destroyed) {
      throw new Error('Embedding session has been destroyed');
    }
  }
}

/**
 * Client-side permissions implementation
 */
class ClientPermissions implements LLMPermissions {
  private client: WindowLLMClient;

  constructor(client: WindowLLMClient) {
    this.client = client;
  }

  async query(descriptor: LLMPermissionDescriptor): Promise<LLMPermissionStatus> {
    const response = await this.client.sendRequest<PermissionQueryResponse>('permission_query', {
      capabilities: [descriptor.name],
    });

    const state = response.payload.permissions[descriptor.name]?.granted ? 'granted' : 'prompt';
    return new ClientPermissionStatus(state);
  }

  async request(descriptor: LLMPermissionDescriptor): Promise<LLMPermissionStatus> {
    // For now, just query - actual permission request flow would open vault UI
    return this.query(descriptor);
  }

  async revoke(_descriptor: LLMPermissionDescriptor): Promise<LLMPermissionStatus> {
    // TODO: Implement revocation
    return new ClientPermissionStatus('prompt');
  }
}

/**
 * Client-side permission status
 */
class ClientPermissionStatus extends EventTarget implements LLMPermissionStatus {
  readonly state: LLMPermissionState;
  onchange: ((this: LLMPermissionStatus, ev: Event) => void) | null = null;

  constructor(state: LLMPermissionState) {
    super();
    this.state = state;
  }
}

/**
 * Client-side capabilities
 */
class ClientCapabilities implements LLMCapabilities {
  private client: WindowLLMClient;

  constructor(client: WindowLLMClient) {
    this.client = client;
  }

  has(capability: CapabilityName): boolean {
    return this.client.getGrantedCapabilities().includes(capability);
  }

  get(name: CapabilityName): CapabilityInfo | undefined {
    return this.has(name) ? { available: true } : undefined;
  }

  list(): CapabilityName[] {
    return this.client.getGrantedCapabilities() as CapabilityName[];
  }

  supports(names: CapabilityName[]): boolean {
    return names.every(n => this.has(n));
  }

  get chat(): boolean { return this.has('chat'); }
  get streaming(): boolean { return this.has('streaming'); }
  get vision(): boolean { return this.has('vision'); }
  get tools(): boolean { return this.has('tools'); }
  get embeddings(): boolean { return this.has('embeddings'); }
  get jsonMode(): boolean { return this.has('jsonMode'); }
  get systemPrompt(): boolean { return this.has('systemPrompt'); }
}

/**
 * Client-side model registry
 */
class ClientModelRegistry implements LLMModelRegistry {
  private client: WindowLLMClient;
  private cache: LLMModel[] | null = null;

  constructor(client: WindowLLMClient) {
    this.client = client;
  }

  async list(): Promise<LLMModel[]> {
    if (this.cache) return this.cache;

    const response = await this.client.sendRequest<ModelsListResponse>('models_list', {});
    this.cache = response.payload.models;
    return this.cache;
  }

  async get(id: string): Promise<LLMModel | null> {
    const models = await this.list();
    return models.find(m => m.id === id) || null;
  }

  async match(requirements: ModelRequirements): Promise<LLMModel[]> {
    const models = await this.list();

    return models.filter(model => {
      // Check required capabilities
      if (requirements.capabilities?.required) {
        for (const cap of requirements.capabilities.required) {
          if (!model.capabilities[cap]) return false;
        }
      }

      // Check limit requirements
      if (requirements.limits?.minContextWindow) {
        if (model.limits.contextWindow < requirements.limits.minContextWindow) return false;
      }
      if (requirements.limits?.minOutputTokens) {
        if (model.limits.maxOutputTokens < requirements.limits.minOutputTokens) return false;
      }

      return true;
    }).sort((a, b) => {
      // Sort by preference
      if (requirements.preference === 'quality') {
        return b.limits.contextWindow - a.limits.contextWindow;
      }
      if (requirements.preference === 'speed') {
        return a.limits.contextWindow - b.limits.contextWindow;
      }
      return 0;
    });
  }
}

// =============================================================================
// Initialization
// =============================================================================

// Check if window.llm already exists (extension may have provided it)
if (typeof window !== 'undefined') {
  if (window.llm) {
    console.log(`WindowLLM: Using existing implementation v${window.llm.version} (${window.llm.provider})`);
  } else {
    // Initialize the client
    console.log('WindowLLM: Initializing iframe-based client...');
    const client = new WindowLLMClient();

    // Expose on window
    Object.defineProperty(window, 'llm', {
      value: client,
      writable: false,
      configurable: false,
    });
  }
}

export type { WindowLLM };
