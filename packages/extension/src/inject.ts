/**
 * WindowLLM Extension - Inject Script
 *
 * This script runs in the MAIN world (page context) and provides window.llm.
 * It communicates with the content script via CustomEvents.
 *
 * This approach works across Chrome, Firefox, and Safari.
 */

// Message ID counter for request/response correlation
let messageId = 0;

// Pending requests waiting for responses
const pendingRequests = new Map<number, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}>();

// Pending consent request
let pendingConsentResolve: ((granted: boolean) => void) | null = null;

/**
 * Show consent overlay and trigger native extension popup
 */
async function requestConsent(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendingConsentResolve = resolve;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'windowllm-consent-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 2147483646;
      display: flex; align-items: center; justify-content: center;
    `;
    overlay.innerHTML = `
      <div style="background: white; padding: 24px; border-radius: 12px; max-width: 400px; text-align: center; font-family: system-ui, sans-serif;">
        <h2 style="margin: 0 0 8px 0; font-size: 18px; color: #111;">WindowLLM Permission</h2>
        <p id="windowllm-consent-msg" style="margin: 0; font-size: 14px; color: #666;">
          Please approve or deny the permission request in the extension popup.
        </p>
      </div>
    `;
    document.body.appendChild(overlay);

    // Request popup open via background script
    sendToContentScriptRaw('open_popup', { mode: 'consent', origin }).then((result: unknown) => {
      const res = result as { success?: boolean; popupOpened?: boolean };
      if (res?.success && !res?.popupOpened) {
        // Popup didn't open automatically - update message
        const msg = document.getElementById('windowllm-consent-msg');
        if (msg) {
          msg.textContent = 'Click the WindowLLM extension icon in the toolbar to approve or deny.';
        }
      }
    });
  });
}

/**
 * Handle consent response from popup
 */
function handleConsentResponse(granted: boolean) {
  // Remove overlay
  document.getElementById('windowllm-consent-overlay')?.remove();

  // Resolve pending promise
  if (pendingConsentResolve) {
    pendingConsentResolve(granted);
    pendingConsentResolve = null;
  }
}

// Pending vault unlock request
let pendingUnlockResolve: ((unlocked: boolean) => void) | null = null;

/**
 * Show vault unlock overlay and trigger native extension popup
 */
async function requestVaultUnlock(): Promise<boolean> {
  return new Promise((resolve) => {
    pendingUnlockResolve = resolve;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'windowllm-unlock-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 2147483646;
      display: flex; align-items: center; justify-content: center;
    `;
    overlay.innerHTML = `
      <div style="background: white; padding: 24px; border-radius: 12px; max-width: 400px; text-align: center; font-family: system-ui, sans-serif;">
        <h2 style="margin: 0 0 8px 0; font-size: 18px; color: #111;">WindowLLM Vault Locked</h2>
        <p id="windowllm-unlock-msg" style="margin: 0; font-size: 14px; color: #666;">
          Please enter your passphrase in the extension popup to unlock the vault.
        </p>
      </div>
    `;
    document.body.appendChild(overlay);

    // Request popup open via background script
    sendToContentScriptRaw('open_popup', { mode: 'unlock' }).then((result: unknown) => {
      const res = result as { success?: boolean; popupOpened?: boolean };
      if (res?.success && !res?.popupOpened) {
        // Popup didn't open automatically - update message
        const msg = document.getElementById('windowllm-unlock-msg');
        if (msg) {
          msg.textContent = 'Click the WindowLLM extension icon in the toolbar to unlock.';
        }
      }
    });
  });
}

/**
 * Handle vault unlock response from popup
 */
function handleUnlockResponse(unlocked: boolean) {
  // Remove overlay
  document.getElementById('windowllm-unlock-overlay')?.remove();

  // Resolve pending promise
  if (pendingUnlockResolve) {
    pendingUnlockResolve(unlocked);
    pendingUnlockResolve = null;
  }
}

// Listen for popup results from content script (forwarded from background)
window.addEventListener('windowllm:popup_result', ((event: CustomEvent) => {
  const { mode, result } = JSON.parse(event.detail as string) as { mode: string; result: boolean };
  if (mode === 'consent') {
    handleConsentResponse(result === true);
  } else if (mode === 'unlock') {
    handleUnlockResponse(result === true);
  }
}) as EventListener);

/**
 * Send a message to the content script and wait for response
 * Handles vault unlock and consent flows if required
 */
async function sendToContentScript(type: string, payload: unknown): Promise<unknown> {
  const result = await sendToContentScriptRaw(type, payload);

  // Check if vault is locked
  if (result && typeof result === 'object' && 'vaultLocked' in result) {
    const unlocked = await requestVaultUnlock();

    if (!unlocked) {
      throw new Error('Vault is locked. Please unlock it to continue.');
    }

    // Retry the request after vault unlocked
    return sendToContentScriptRaw(type, payload);
  }

  // Check if consent is required
  if (result && typeof result === 'object' && 'requiresConsent' in result) {
    const { origin } = result as { requiresConsent: boolean; origin: string };
    const granted = await requestConsent(origin);

    if (!granted) {
      throw new Error('Permission denied by user');
    }

    // Retry the request after consent granted
    return sendToContentScriptRaw(type, payload);
  }

  return result;
}

/**
 * Raw send without consent handling
 */
function sendToContentScriptRaw(type: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pendingRequests.set(id, { resolve, reject });

    window.dispatchEvent(new CustomEvent('windowllm:request', {
      detail: JSON.stringify({ id, type, payload })
    }));

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 30000);
  });
}

// Listen for responses from content script
window.addEventListener('windowllm:response', ((event: CustomEvent) => {
  const { id, success, data, error } = JSON.parse(event.detail as string) as {
    id: number;
    success: boolean;
    data?: unknown;
    error?: string;
  };
  const pending = pendingRequests.get(id);
  if (pending) {
    pendingRequests.delete(id);
    if (success) {
      pending.resolve(data);
    } else {
      pending.reject(new Error(error || 'Unknown error'));
    }
  }
}) as EventListener);

/**
 * LLM Session implementation
 */
class ExtensionSession {
  readonly id: string;
  private _messages: Array<{ role: string; content: string }> = [];
  private options: unknown;
  private _model: unknown = null;

  constructor(options?: unknown) {
    this.id = crypto.randomUUID();
    this.options = options;
  }

  async initialize(): Promise<void> {
    const result = await sendToContentScript('session_init', {
      sessionId: this.id,
      options: this.options,
    }) as { model?: unknown; error?: string };

    if (result.error) {
      throw new Error(result.error);
    }
    this._model = result.model;
  }

  get model() {
    return this._model || {
      id: 'unknown',
      name: 'Unknown Model',
      provider: 'extension',
      capabilities: {
        chat: true,
        streaming: true,
        vision: false,
        tools: false,
        embeddings: false,
        jsonMode: false,
        systemPrompt: true,
      },
      limits: {
        contextWindow: 4096,
        maxOutputTokens: 4096,
      },
    };
  }

  get messages() {
    return this._messages;
  }

  get tools() {
    return [];
  }

  get capabilities() {
    return (this.model as { capabilities: unknown }).capabilities;
  }

  async complete(input: string | object | object[]): Promise<unknown> {
    const messages = this.buildMessages(input);
    const result = await sendToContentScript('completion', {
      sessionId: this.id,
      messages,
      stream: false,
      options: this.options,
    }) as { message?: { role: string; content: string }; error?: string };

    if (result.error) {
      throw new Error(result.error);
    }

    // Add to history
    if (typeof input === 'string') {
      this._messages.push({ role: 'user', content: input });
    }
    if (result.message) {
      this._messages.push(result.message);
    }

    return result;
  }

  async *stream(input: string | object | object[]): AsyncIterable<unknown> {
    const messages = this.buildMessages(input);

    // Set up streaming listener
    const chunks: unknown[] = [];
    let resolveNext: (() => void) | null = null;

    const streamHandler = ((event: CustomEvent) => {
      const detail = JSON.parse(event.detail as string) as { sessionId: string; chunk: { type: string } };
      if (detail.sessionId === this.id) {
        chunks.push(detail.chunk);
        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      }
    }) as EventListener;

    window.addEventListener('windowllm:stream', streamHandler);

    try {
      // Start the stream
      sendToContentScript('completion', {
        sessionId: this.id,
        messages,
        stream: true,
        options: this.options,
      });

      // Yield chunks as they arrive
      let accumulated = '';
      while (true) {
        if (chunks.length > 0) {
          const chunk = chunks.shift() as { type: string; text?: string; accumulated?: string; result?: unknown };
          if (chunk.type === 'text') {
            accumulated = chunk.accumulated || (accumulated + (chunk.text || ''));
            yield { type: 'text', text: chunk.text, accumulated };
          } else if (chunk.type === 'done') {
            yield { type: 'done', result: chunk.result };
            break;
          }
        } else {
          await new Promise<void>(resolve => { resolveNext = resolve; });
        }
      }

      // Add to history
      if (typeof input === 'string') {
        this._messages.push({ role: 'user', content: input });
      }
      this._messages.push({ role: 'assistant', content: accumulated });
    } finally {
      window.removeEventListener('windowllm:stream', streamHandler);
    }
  }

  async clone(): Promise<ExtensionSession> {
    const cloned = new ExtensionSession(this.options);
    cloned._messages = [...this._messages];
    cloned._model = this._model;
    return cloned;
  }

  reset(): void {
    this._messages = [];
  }

  destroy(): void {
    sendToContentScript('session_destroy', { sessionId: this.id });
  }

  private buildMessages(input: string | object | object[]) {
    const messages = [...this._messages];
    if (typeof input === 'string') {
      messages.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
      messages.push(...input as Array<{ role: string; content: string }>);
    } else {
      messages.push(input as { role: string; content: string });
    }
    return messages;
  }
}

/**
 * Embedding Session implementation
 */
class ExtensionEmbeddingSession {
  readonly id: string;
  readonly dimensions: number;

  constructor(options?: { dimensions?: number }) {
    this.id = crypto.randomUUID();
    this.dimensions = options?.dimensions || 1536;
  }

  async embed(text: string): Promise<unknown> {
    return sendToContentScript('embedding', {
      sessionId: this.id,
      texts: [text],
    }).then((result: unknown) => ((result as { embeddings: unknown[] }).embeddings[0]));
  }

  async embedBatch(texts: string[]): Promise<unknown[]> {
    return sendToContentScript('embedding', {
      sessionId: this.id,
      texts,
    }).then((result: unknown) => (result as { embeddings: unknown[] }).embeddings);
  }

  destroy(): void {
    // No-op for now
  }
}

type ExtensionPermissionState = 'granted' | 'prompt';

class ExtensionPermissionStatus extends EventTarget {
  readonly state: ExtensionPermissionState;
  onchange: ((this: ExtensionPermissionStatus, event: Event) => void) | null = null;

  constructor(state: ExtensionPermissionState) {
    super();
    this.state = state;
  }
}

/**
 * WindowLLM API implementation
 */
const windowLLM = {
  version: '0.1.0',
  available: true,
  provider: 'extension' as const,

  permissions: {
    async query(descriptor: { name: string }) {
      const granted = await sendToContentScript('permission_query', descriptor);
      return new ExtensionPermissionStatus(granted === true ? 'granted' : 'prompt');
    },
    async request(descriptor: { name: string }) {
      const result = await sendToContentScript('permission_request', descriptor) as {
        granted?: boolean;
        error?: string;
      };
      if (result.error) throw new Error(result.error);
      return new ExtensionPermissionStatus(result.granted ? 'granted' : 'prompt');
    },
    async revoke(descriptor: { name: string }) {
      const result = await sendToContentScript('permission_revoke', descriptor) as {
        error?: string;
      };
      if (result.error) throw new Error(result.error);
      return new ExtensionPermissionStatus('prompt');
    },
  },

  /**
   * Wait for the extension to be ready with configured providers
   */
  async waitForReady(): Promise<void> {
    // Check if we have any models available (which means providers are configured)
    const models = await this.models.list();
    if (!models || models.length === 0) {
      throw new Error('No models available. Please configure a provider in the WindowLLM extension.');
    }
  },

  capabilities: {
    has(name: string) {
      return ['chat', 'streaming', 'tools', 'vision', 'embeddings', 'jsonMode', 'systemPrompt', 'multiTurn'].includes(name);
    },
    chat: true,
    streaming: true,
    vision: true,
    tools: true,
    embeddings: true,
    jsonMode: true,
    systemPrompt: true,
  },

  models: {
    async list() {
      const result = await sendToContentScript('models_list', {}) as { models?: unknown[]; error?: string };
      if (result.error) {
        console.error('WindowLLM: Failed to list models:', result.error);
        return [];
      }
      return result.models || [];
    },
    async get(id: string) {
      const result = await sendToContentScript('models_get', { id }) as { model?: unknown; error?: string };
      if (result.error) {
        console.error('WindowLLM: Failed to get model:', result.error);
        return null;
      }
      return result.model;
    },
    async match(requirements: unknown) {
      const result = await sendToContentScript('models_match', { requirements }) as { models?: unknown[]; error?: string };
      if (result.error) {
        console.error('WindowLLM: Failed to match models:', result.error);
        return [];
      }
      return result.models || [];
    },
  },

  async requestSession(options?: unknown) {
    const session = new ExtensionSession(options);
    await session.initialize();
    return session;
  },

  async requestEmbedding(options?: { dimensions?: number }) {
    return new ExtensionEmbeddingSession(options);
  },
};

// Install on window
Object.defineProperty(window, 'llm', {
  value: windowLLM,
  writable: false,
  enumerable: true,
  configurable: false,
});

console.log('WindowLLM: Extension loaded (inject script)');
