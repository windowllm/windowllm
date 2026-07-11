/**
 * WindowLLM Extension - Background Service Worker
 *
 * Handles:
 * - Provider configuration storage
 * - API key management
 * - Communication with content scripts
 * - Making LLM API calls
 * - Vault lock/unlock status
 */

import { createAnthropicAdapter, createOpenAIAdapter, createOpenRouterAdapter, createOllamaAdapter, createGeminiAdapter } from '@windowllm/adapters';
import type { ProviderAdapter, NormalizedRequest } from '@windowllm/adapters';
import type { LLMModel, Message } from '@windowllm/types';

const STORAGE_PREFIX = 'windowllm:';
const PROVIDERS_KEY = `${STORAGE_PREFIX}providers`;
const ENCRYPTION_KEY_KEY = `${STORAGE_PREFIX}key`;
const PERMISSIONS_KEY = `${STORAGE_PREFIX}permissions`;
const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;
const CRYPTO_SALT_KEY = `${STORAGE_PREFIX}crypto_salt`;
const CRYPTO_CHECK_KEY = `${STORAGE_PREFIX}crypto_check`;
const PENDING_POPUP_KEY = `${STORAGE_PREFIX}pending_popup`;

// Auto-lock timeout (30 minutes in milliseconds)
const AUTO_LOCK_TIMEOUT_MS = 30 * 60 * 1000;
let lastActivityTime = Date.now();

/**
 * Pending popup request stored in chrome.storage.local
 */
interface PendingPopupRequest {
  type: 'consent' | 'unlock';
  origin?: string;        // For consent requests
  tabId: number;          // Tab to send response back to
  timestamp: number;      // For timeout/cleanup
}

// IndexedDB constants for secure encryption
const DB_NAME = 'windowllm-vault';
const DB_VERSION = 1;
const KEY_STORE = 'keys';

/**
 * Site permission record
 */
interface SitePermission {
  origin: string;
  capabilities: string[];
  grantedAt: number;
}

/**
 * Get all stored permissions
 */
async function getPermissions(): Promise<SitePermission[]> {
  const result = await chrome.storage.local.get(PERMISSIONS_KEY) as Record<string, string | undefined>;
  const data = result[PERMISSIONS_KEY];
  if (!data) return [];
  try {
    return JSON.parse(data) as SitePermission[];
  } catch {
    return [];
  }
}

/**
 * Get permission for a specific origin
 */
async function getPermission(origin: string): Promise<SitePermission | null> {
  const permissions = await getPermissions();
  return permissions.find(p => p.origin === origin) || null;
}

/**
 * Check if an origin has permission
 */
async function hasPermission(origin: string): Promise<boolean> {
  const permission = await getPermission(origin);
  return permission !== null;
}

/**
 * Grant permission to an origin
 */
async function grantPermission(origin: string): Promise<void> {
  const permissions = await getPermissions();
  const existing = permissions.findIndex(p => p.origin === origin);

  const newPermission: SitePermission = {
    origin,
    capabilities: ['chat', 'streaming'],
    grantedAt: Date.now(),
  };

  if (existing >= 0) {
    permissions[existing] = newPermission;
  } else {
    permissions.push(newPermission);
  }

  await chrome.storage.local.set({ [PERMISSIONS_KEY]: JSON.stringify(permissions) });
}

/**
 * Revoke permission from an origin
 */
async function revokePermission(origin: string): Promise<void> {
  const permissions = await getPermissions();
  const filtered = permissions.filter(p => p.origin !== origin);
  await chrome.storage.local.set({ [PERMISSIONS_KEY]: JSON.stringify(filtered) });
}

/**
 * Check if require approval is enabled (default: true)
 */
async function getRequireApproval(): Promise<boolean> {
  const result = await chrome.storage.local.get(SETTINGS_KEY) as Record<string, string | undefined>;
  const data = result[SETTINGS_KEY];
  if (!data) return true;
  try {
    const settings = JSON.parse(data);
    return settings.requireApproval !== false;
  } catch {
    return true;
  }
}

/**
 * Check if secure encryption is set up (passphrase was created)
 */
async function isSecureEncryptionSetUp(): Promise<boolean> {
  const result = await chrome.storage.local.get([CRYPTO_SALT_KEY, CRYPTO_CHECK_KEY]);
  return result[CRYPTO_SALT_KEY] != null && result[CRYPTO_CHECK_KEY] != null;
}

/**
 * Open IndexedDB connection
 */
function openVaultDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
    };
  });
}

/**
 * Check if there's an unlocked master key in IndexedDB
 */
async function hasMasterKey(): Promise<boolean> {
  try {
    const db = await openVaultDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const store = tx.objectStore(KEY_STORE);
      const request = store.get('masterKey');

      request.onerror = () => resolve(false);
      request.onsuccess = () => resolve(request.result != null);

      tx.oncomplete = () => db.close();
    });
  } catch {
    return false;
  }
}

/**
 * Check if vault is locked
 * Returns true if secure encryption is set up but no master key is available
 */
async function isVaultLocked(): Promise<boolean> {
  const isSetUp = await isSecureEncryptionSetUp();
  if (!isSetUp) {
    // Legacy mode (simple obfuscation) - always "unlocked"
    return false;
  }

  // Secure encryption is set up - check for master key
  const hasKey = await hasMasterKey();
  return !hasKey;
}

/**
 * Lock the vault by clearing the master key from IndexedDB
 */
async function lockVault(): Promise<void> {
  try {
    const db = await openVaultDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      const store = tx.objectStore(KEY_STORE);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();

      tx.oncomplete = () => db.close();
    });
    // Clear cached adapters
    adapters.clear();
    cachedModels = null;
    console.log('[WindowLLM] Vault locked');
  } catch (error) {
    console.error('[WindowLLM] Failed to lock vault:', error);
  }
}

/**
 * Update last activity time (called on protected operations)
 */
function updateActivity(): void {
  lastActivityTime = Date.now();
}

/**
 * Check if auto-lock should trigger and lock if needed
 */
async function checkAutoLock(): Promise<void> {
  const isSetUp = await isSecureEncryptionSetUp();
  if (!isSetUp) return; // No auto-lock for legacy mode

  const hasKey = await hasMasterKey();
  if (!hasKey) return; // Already locked

  const elapsed = Date.now() - lastActivityTime;
  if (elapsed >= AUTO_LOCK_TIMEOUT_MS) {
    console.log('[WindowLLM] Auto-locking vault after inactivity');
    await lockVault();
  }
}

// Check for auto-lock every minute
setInterval(checkAutoLock, 60 * 1000);

/**
 * Get the obfuscation key for legacy mode
 *
 * This matches the SimpleObfuscation class in vault's storage.ts.
 * Used when secure passphrase-based encryption isn't set up.
 */
async function getEncryptionKey(): Promise<string | null> {
  const result = await chrome.storage.local.get(ENCRYPTION_KEY_KEY) as Record<string, string | undefined>;
  return result[ENCRYPTION_KEY_KEY] || null;
}

function decryptApiKey(encrypted: string, key: string): string {
  try {
    // Decode from base64
    const encryptedBytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const keyBytes = new TextEncoder().encode(key);
    const decrypted = new Uint8Array(encryptedBytes.length);

    for (let i = 0; i < encryptedBytes.length; i++) {
      decrypted[i] = encryptedBytes[i]! ^ keyBytes[i % keyBytes.length]!;
    }

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('[WindowLLM] Decryption failed:', error);
    return '';
  }
}

/** True if the stored value is AES-GCM ciphertext (vs legacy XOR base64). */
function isEncryptedFormat(data: string): boolean {
  try {
    const parsed = JSON.parse(data);
    return parsed.version === 1 && !!parsed.iv && !!parsed.ciphertext;
  } catch {
    return false;
  }
}

/** Retrieve the passphrase-derived master CryptoKey persisted by the vault UI. */
async function getMasterKey(): Promise<CryptoKey | null> {
  try {
    const db = await openVaultDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const request = tx.objectStore(KEY_STORE).get('masterKey');
      request.onerror = () => resolve(null);
      request.onsuccess = () => resolve((request.result as CryptoKey) || null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/** Decrypt an AES-256-GCM key blob produced by VaultEncryption in crypto.ts. */
async function decryptApiKeyAES(encryptedJson: string, key: CryptoKey): Promise<string | null> {
  try {
    const data = JSON.parse(encryptedJson) as { iv: string; ciphertext: string };
    const iv = Uint8Array.from(atob(data.iv), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(data.ciphertext), c => c.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

interface StoredProviderConfig {
  id: string;
  type: 'openai' | 'anthropic' | 'ollama' | 'openrouter' | 'gemini' | 'custom';
  name: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface Session {
  id: string;
  origin: string;
  model: LLMModel;
  adapter: ProviderAdapter;
  messages: Array<{ role: string; content: string }>;
  systemPrompt?: string;
}

// Active sessions
const sessions = new Map<string, Session>();

// Cached adapters
let adapters: Map<string, ProviderAdapter> = new Map();
let cachedModels: LLMModel[] | null = null;

const SESSION_STORE_PREFIX = 'session:';

/** Serializable session metadata; the adapter is rebuilt from modelId on restore. */
interface StoredSession {
  id: string;
  origin: string;
  modelId: string;
  systemPrompt?: string;
}

/**
 * Persist session metadata to chrome.storage.session so an MV3 service worker
 * that suspends between requests can rebuild the session instead of failing
 * with "Session not found". (chrome.storage.session is MV3-only; guard it.)
 */
async function persistSession(session: Session): Promise<void> {
  if (!chrome.storage.session) return;
  const stored: StoredSession = {
    id: session.id,
    origin: session.origin,
    modelId: session.model.id,
    systemPrompt: session.systemPrompt,
  };
  await chrome.storage.session.set({ [SESSION_STORE_PREFIX + session.id]: stored });
}

/** Rebuild an in-memory session (with a live adapter) from persisted metadata. */
async function restoreSession(sessionId: string, origin: string): Promise<Session | null> {
  if (!chrome.storage.session) return null;
  const key = SESSION_STORE_PREFIX + sessionId;
  const stored = (await chrome.storage.session.get(key))[key] as StoredSession | undefined;
  if (!stored || stored.origin !== origin) return null;

  const models = await getModels(); // ensures adapters are initialized
  const model = models.find(m => m.id === stored.modelId) || models[0];
  if (!model) return null;
  const adapter = getAdapterForModel(model.id);
  if (!adapter) return null;

  const session: Session = {
    id: stored.id,
    origin: stored.origin,
    model,
    adapter,
    messages: [],
    systemPrompt: stored.systemPrompt,
  };
  sessions.set(sessionId, session);
  return session;
}

/**
 * Load providers from storage and decrypt API keys
 */
async function loadProviders(): Promise<StoredProviderConfig[]> {
  const result = await chrome.storage.local.get(PROVIDERS_KEY) as Record<string, string | undefined>;
  const providersJson = result[PROVIDERS_KEY];
  if (!providersJson) {
    return [];
  }

  try {
    const providers = JSON.parse(providersJson) as StoredProviderConfig[];
    const encryptionKey = await getEncryptionKey();
    // Only fetched if we actually encounter an AES-encrypted key.
    let masterKey: CryptoKey | null | undefined;

    return await Promise.all(providers.map(async p => {
      if (!p.apiKey) return { ...p, apiKey: undefined };

      // AES-256-GCM keys (passphrase mode) require the unlocked master key.
      if (isEncryptedFormat(p.apiKey)) {
        if (masterKey === undefined) masterKey = await getMasterKey();
        const decrypted = masterKey ? await decryptApiKeyAES(p.apiKey, masterKey) : null;
        return { ...p, apiKey: decrypted ?? undefined };
      }

      // Legacy XOR obfuscation.
      return { ...p, apiKey: encryptionKey ? decryptApiKey(p.apiKey, encryptionKey) : p.apiKey };
    }));
  } catch (error) {
    console.error('[WindowLLM] Failed to parse providers:', error);
    return [];
  }
}

/**
 * Initialize adapters from stored providers
 */
async function initializeAdapters(): Promise<void> {
  adapters.clear();
  cachedModels = null;

  const providers = await loadProviders();
  const enabledProviders = providers.filter(p => p.enabled);

  for (const provider of enabledProviders) {
    try {
      let adapter: ProviderAdapter | null = null;

      switch (provider.type) {
        case 'anthropic':
          if (provider.apiKey) {
            adapter = createAnthropicAdapter({ apiKey: provider.apiKey, baseUrl: provider.baseUrl });
          }
          break;
        case 'openai':
          if (provider.apiKey) {
            adapter = createOpenAIAdapter({ apiKey: provider.apiKey, baseUrl: provider.baseUrl });
          }
          break;
        case 'openrouter':
          if (provider.apiKey) {
            adapter = createOpenRouterAdapter({ apiKey: provider.apiKey });
          }
          break;
        case 'gemini':
          if (provider.apiKey) {
            adapter = createGeminiAdapter({ apiKey: provider.apiKey, baseUrl: provider.baseUrl });
          }
          break;
        case 'ollama':
          adapter = createOllamaAdapter({ baseUrl: provider.baseUrl || 'http://localhost:11434' });
          break;
      }

      if (adapter) {
        adapters.set(provider.type, adapter);
      }
    } catch (error) {
      console.warn(`[WindowLLM] Failed to initialize ${provider.type}:`, error);
    }
  }
}

/**
 * Get all available models from all adapters
 */
async function getModels(): Promise<LLMModel[]> {
  if (cachedModels) return cachedModels;

  await initializeAdapters();

  const allModels: LLMModel[] = [];

  for (const [type, adapter] of adapters) {
    try {
      const models = await adapter.listModels();
      // Prefix model IDs with provider type for routing
      const prefixedModels = models.map(m => ({
        ...m,
        id: m.id.startsWith(`${type}/`) ? m.id : `${type}/${m.id}`,
      }));
      allModels.push(...prefixedModels);
    } catch (error) {
      console.warn(`[WindowLLM] Failed to list models for ${type}:`, error);
    }
  }

  cachedModels = allModels;
  return allModels;
}

/**
 * Get adapter for a model ID
 */
function getAdapterForModel(modelId: string): ProviderAdapter | null {
  const firstSlash = modelId.indexOf('/');
  if (firstSlash > 0) {
    const prefix = modelId.substring(0, firstSlash);
    const adapter = adapters.get(prefix);
    if (adapter) return adapter;
  }

  // Fallback to first adapter
  const firstAdapter = adapters.values().next().value;
  return firstAdapter || null;
}

/**
 * Handle session initialization
 */
async function handleSessionInit(
  payload: { sessionId: string; options?: { model?: string; systemPrompt?: string } },
  origin: string
): Promise<{ model: LLMModel }> {
  const models = await getModels();

  if (models.length === 0) {
    throw new Error('No models available. Please configure a provider in the extension settings.');
  }

  // models is non-empty here (guarded above), so models[0] is defined.
  let model: LLMModel = models[0]!;

  if (payload.options?.model) {
    const found = models.find(m => m.id === payload.options!.model);
    if (found) {
      model = found;
    }
  }

  const adapter = getAdapterForModel(model.id);
  if (!adapter) {
    throw new Error(`No adapter available for model ${model.id}`);
  }

  const session: Session = {
    id: payload.sessionId,
    origin,
    model,
    adapter,
    messages: [],
    systemPrompt: payload.options?.systemPrompt,
  };

  sessions.set(payload.sessionId, session);
  await persistSession(session);

  return { model };
}

/**
 * Handle completion request
 */
async function handleCompletion(
  payload: { sessionId: string; messages: Array<{ role: string; content: string }>; stream?: boolean; options?: { model?: string } },
  sender: chrome.runtime.MessageSender,
  origin: string
): Promise<unknown> {
  // Fall back to persisted metadata if the service worker was suspended and
  // dropped the in-memory session (restoreSession also verifies the origin).
  const session = sessions.get(payload.sessionId) ?? await restoreSession(payload.sessionId, origin);
  if (!session) {
    throw new Error('Session not found. Please initialize a session first.');
  }

  // A session is bound to the origin that created it. Reject cross-origin reuse
  // of a session id (which is otherwise guessable only by the owning page).
  if (session.origin !== origin) {
    throw new Error('Session does not belong to this origin.');
  }

  // Get the model ID from options or use session model
  const modelId = payload.options?.model || session.model.id;

  // Extract the actual model ID (remove provider prefix)
  const firstSlash = modelId.indexOf('/');
  const actualModelId = firstSlash > 0 ? modelId.substring(firstSlash + 1) : modelId;

  const request: NormalizedRequest = {
    model: actualModelId,
    messages: payload.messages as Message[],
    systemPrompt: session.systemPrompt,
    stream: payload.stream,
  };

  if (payload.stream) {
    // Handle streaming
    let accumulated = '';
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;
    const tabId = sender.tab?.id;
    // Route chunks back to the exact frame that made the request, so a sibling
    // (e.g. a cross-origin ad iframe) in the same tab cannot observe them.
    const sendOptions = sender.frameId != null ? { frameId: sender.frameId } : undefined;

    for await (const chunk of session.adapter.stream(request)) {
      if (chunk.type === 'text' && chunk.content) {
        accumulated += chunk.content;

        if (tabId != null) {
          chrome.tabs.sendMessage(tabId, {
            type: 'stream_chunk',
            sessionId: payload.sessionId,
            chunk: {
              type: 'text',
              text: chunk.content,
              accumulated,
            },
          }, sendOptions);
        }
      } else if (chunk.type === 'usage' && chunk.usage) {
        usage = {
          inputTokens: chunk.usage.inputTokens ?? 0,
          outputTokens: chunk.usage.outputTokens ?? 0,
          totalTokens: chunk.usage.totalTokens ?? 0,
        };
      }
      // 'done' chunk from adapter is ignored - we send our own below
    }

    // Send done with usage
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, {
        type: 'stream_chunk',
        sessionId: payload.sessionId,
        chunk: {
          type: 'done',
          result: { message: { role: 'assistant', content: accumulated }, usage },
        },
      }, sendOptions);
    }

    return { streaming: true };
  } else {
    // Non-streaming
    const result = await session.adapter.complete(request);
    return {
      message: result.message,
      usage: result.usage,
      finishReason: result.finishReason,
    };
  }
}

/**
 * Handle models list request
 */
async function handleModelsList(): Promise<{ models: LLMModel[] }> {
  const models = await getModels();
  return { models };
}

/**
 * Message types that expose privileged vault operations. These must ONLY be
 * accepted from the extension's own pages (popup / options) — never from a
 * content script running in a web page, which forwards page-supplied messages
 * verbatim. Without this gate any page could grant itself permission, read the
 * provider config, or lock the vault.
 */
const EXTENSION_ONLY_MESSAGES = new Set([
  'get_config',
  'grant_permission',
  'revoke_permission',
  'get_permissions',
  'lock_vault',
  'popup_result',
  'get_pending_popup',
]);

/** Messages that require an unlocked vault and per-origin consent. */
const PROTECTED_MESSAGES = new Set(['session_init', 'completion', 'models_list']);

/**
 * True when a message originates from one of the extension's own pages (popup,
 * options) rather than a content script injected into a web page. The
 * extension pages load from `chrome-extension://<our-id>/...`, which no web
 * page can spoof — the URL is set by the browser, not the message payload.
 */
function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  const extensionBase = chrome.runtime.getURL('');
  return typeof sender.url === 'string' && sender.url.startsWith(extensionBase);
}

/** Read the current pending popup request, if any. */
async function readPendingPopup(): Promise<PendingPopupRequest | null> {
  const json = (await chrome.storage.local.get(PENDING_POPUP_KEY) as Record<string, string | undefined>)[PENDING_POPUP_KEY];
  if (!json) return null;
  try {
    return JSON.parse(json) as PendingPopupRequest;
  } catch {
    return null;
  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  const handleAsync = async () => {
    try {
      const fromExtensionPage = isExtensionPageSender(sender);

      // Reject privileged operations that do not come from our own UI pages.
      if (EXTENSION_ONLY_MESSAGES.has(message.type) && !fromExtensionPage) {
        console.warn('[WindowLLM] Rejected privileged message from untrusted sender:', message.type, sender.url);
        return { error: 'Unauthorized' };
      }

      // Origin is ALWAYS the browser-verified sender origin, never a value
      // taken from the message payload (which a page fully controls).
      const origin = sender.url ? new URL(sender.url).origin : null;

      if (PROTECTED_MESSAGES.has(message.type)) {
        // Fail closed: a protected operation from a web page must carry a
        // resolvable origin to gate consent against.
        if (!origin) {
          return { error: 'Unable to determine request origin' };
        }

        // Check if vault is locked
        const locked = await isVaultLocked();
        if (locked) {
          return { vaultLocked: true };
        }

        // Check site permissions
        const requireApproval = await getRequireApproval();
        if (requireApproval) {
          const permitted = await hasPermission(origin);
          if (!permitted) {
            return { requiresConsent: true, origin };
          }
        }

        // Update activity time for auto-lock
        updateActivity();
      }

      switch (message.type) {
        case 'ping':
          return { type: 'pong', timestamp: Date.now() };

        case 'get_config': {
          const result = await chrome.storage.local.get([PROVIDERS_KEY]);
          return { type: 'config', data: result };
        }

        case 'session_init':
          return await handleSessionInit(message.payload, origin!);

        case 'models_list':
          return await handleModelsList();

        case 'completion':
          return await handleCompletion(message.payload, sender, origin!);

        case 'session_destroy': {
          // Only allow destroying a session owned by the requesting origin.
          const sessionId = message.payload?.sessionId;
          if (sessionId && origin) {
            const session = sessions.get(sessionId) ?? await restoreSession(sessionId, origin);
            if (session && session.origin === origin) {
              sessions.delete(sessionId);
              if (chrome.storage.session) {
                await chrome.storage.session.remove(SESSION_STORE_PREFIX + sessionId);
              }
            }
          }
          return { success: true };
        }

        case 'grant_permission': {
          // Bind the grant to the origin the user actually saw in the pending
          // consent prompt. Fall back to an explicit payload origin only for
          // our own UI (e.g. the legacy URL-based consent page).
          const pending = await readPendingPopup();
          const grantOrigin = pending?.type === 'consent' && pending.origin
            ? pending.origin
            : message.payload?.origin;
          if (grantOrigin) {
            await grantPermission(grantOrigin);
            return { success: true };
          }
          return { error: 'No origin provided' };
        }

        case 'revoke_permission':
          if (message.payload?.origin) {
            await revokePermission(message.payload.origin);
            return { success: true };
          }
          return { error: 'No origin provided' };

        case 'get_permissions': {
          const permissions = await getPermissions();
          return { permissions };
        }

        case 'check_permission': {
          // A page may only ask about its OWN origin, never probe others.
          if (origin) {
            const hasPerm = await hasPermission(origin);
            return { hasPermission: hasPerm };
          }
          return { error: 'Unable to determine request origin' };
        }

        case 'vault_status': {
          const isSetUp = await isSecureEncryptionSetUp();
          const isLocked = await isVaultLocked();
          return { isSetUp, isLocked };
        }

        case 'lock_vault':
          // Clear the master key from IndexedDB
          try {
            await lockVault();
            return { success: true };
          } catch (error) {
            return { error: error instanceof Error ? error.message : 'Failed to lock vault' };
          }

        case 'open_popup':
          // Store pending request and open the extension popup
          try {
            const tabId = sender.tab?.id;
            if (!tabId) {
              return { error: 'No tab ID available' };
            }

            // The consent request is bound to the browser-verified sender
            // origin, not a value the page put in the payload.
            const pendingRequest: PendingPopupRequest = {
              type: message.payload?.mode === 'unlock' ? 'unlock' : 'consent',
              origin: origin ?? undefined,
              tabId,
              timestamp: Date.now(),
            };

            await chrome.storage.local.set({ [PENDING_POPUP_KEY]: JSON.stringify(pendingRequest) });

            // Try to open the extension popup
            let popupOpened = false;
            if (typeof chrome.action?.openPopup === 'function') {
              try {
                await chrome.action.openPopup();
                popupOpened = true;
              } catch (popupError) {
                console.warn('[WindowLLM] action.openPopup() failed:', popupError);
                // Popup failed to open - user will need to click the extension icon
              }
            }

            return { success: true, popupOpened };
          } catch (error) {
            console.error('[WindowLLM] Failed to open popup:', error);
            return { error: error instanceof Error ? error.message : 'Failed to open popup' };
          }

        case 'popup_result':
          // Handle result from popup and notify the originating tab
          try {
            const pendingJson = (await chrome.storage.local.get(PENDING_POPUP_KEY) as Record<string, string | undefined>)[PENDING_POPUP_KEY];
            if (!pendingJson) {
              return { error: 'No pending popup request' };
            }

            const pending = JSON.parse(pendingJson) as PendingPopupRequest;

            // Clear the pending request
            await chrome.storage.local.remove(PENDING_POPUP_KEY);

            // Send result to the originating tab's content script
            if (pending.tabId) {
              chrome.tabs.sendMessage(pending.tabId, {
                type: 'popup_result',
                mode: pending.type,
                result: message.payload?.result,
                origin: pending.origin,
              });
            }

            return { success: true };
          } catch (error) {
            console.error('[WindowLLM] Failed to handle popup result:', error);
            return { error: error instanceof Error ? error.message : 'Failed to handle popup result' };
          }

        case 'get_pending_popup':
          // Get pending popup request (called by popup on load)
          try {
            const pendingJson = (await chrome.storage.local.get(PENDING_POPUP_KEY) as Record<string, string | undefined>)[PENDING_POPUP_KEY];
            if (!pendingJson) {
              return { pending: null };
            }

            const pending = JSON.parse(pendingJson) as PendingPopupRequest;

            // Check if request is stale (older than 5 minutes)
            if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
              await chrome.storage.local.remove(PENDING_POPUP_KEY);
              return { pending: null };
            }

            return { pending };
          } catch (error) {
            return { pending: null };
          }

        default:
          console.warn('[WindowLLM] Unknown message type:', message.type);
          return { error: 'Unknown message type' };
      }
    } catch (error) {
      console.error('[WindowLLM] Error handling message:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  };

  handleAsync().then(sendResponse);
  return true; // Will respond asynchronously
});

// Listen for storage changes to reload adapters
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[PROVIDERS_KEY]) {
    cachedModels = null;
    initializeAdapters();
  }
});

// Initialize on install
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[WindowLLM] Extension installed:', details.reason);

  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

// Initialize adapters on startup
initializeAdapters();
