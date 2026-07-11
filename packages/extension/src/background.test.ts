/**
 * Security tests for the background message listener.
 *
 * The critical property under test: privileged vault operations
 * (grant_permission, get_config, lock_vault, ...) must be reachable ONLY from
 * the extension's own pages, never from a content script forwarding a message
 * on behalf of an arbitrary web page.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

const EXTENSION_ID = 'testextensionid';
const EXTENSION_BASE = `chrome-extension://${EXTENSION_ID}/`;

const PERMISSIONS_KEY = 'windowllm:permissions';
const PENDING_POPUP_KEY = 'windowllm:pending_popup';

type Listener = (
  message: any,
  sender: any,
  sendResponse: (response: unknown) => void
) => boolean | void;

let messageListener: Listener;
// Backing store for chrome.storage.local
let store: Record<string, unknown>;

/** Invoke the captured listener and resolve with the async response. */
function send(message: unknown, sender: unknown): Promise<any> {
  return new Promise((resolve) => {
    messageListener(message, sender, resolve);
  });
}

const pageSender = (origin: string) => ({
  url: `${origin}/page.html`,
  tab: { id: 7 },
  frameId: 0,
});

const extensionSender = () => ({
  url: `${EXTENSION_BASE}popup.html`,
  // popup has no tab
});

beforeAll(async () => {
  store = {};
  const chromeMock = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => { messageListener = fn; } },
      onInstalled: { addListener: vi.fn() },
      getURL: (path: string) => `${EXTENSION_BASE}${path}`,
      openOptionsPage: vi.fn(),
    },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (obj: Record<string, unknown>) => { Object.assign(store, obj); },
        remove: async (key: string) => { delete store[key]; },
      },
      onChanged: { addListener: vi.fn() },
    },
    tabs: { sendMessage: vi.fn() },
    action: { openPopup: vi.fn().mockResolvedValue(undefined) },
  };
  (globalThis as any).chrome = chromeMock;

  await import('./background.ts');
  expect(messageListener).toBeTypeOf('function');
});

beforeEach(() => {
  // Reset persisted state between tests.
  for (const k of Object.keys(store)) delete store[k];
});

function storedPermissions(): Array<{ origin: string }> {
  const raw = store[PERMISSIONS_KEY];
  return raw ? JSON.parse(raw as string) : [];
}

describe('privileged messages from a web page are rejected', () => {
  for (const type of ['grant_permission', 'get_config', 'revoke_permission', 'get_permissions', 'lock_vault', 'popup_result', 'get_pending_popup']) {
    it(`rejects ${type} from a page sender`, async () => {
      const res = await send(
        { type, payload: { origin: 'https://evil.com' } },
        pageSender('https://evil.com')
      );
      expect(res).toEqual({ error: 'Unauthorized' });
    });
  }

  it('a page cannot grant itself permission', async () => {
    await send(
      { type: 'grant_permission', payload: { origin: 'https://evil.com' } },
      pageSender('https://evil.com')
    );
    expect(storedPermissions()).toHaveLength(0);
  });

  it('a page cannot read the provider config', async () => {
    store['windowllm:providers'] = JSON.stringify([{ id: '1', apiKey: 'secret' }]);
    const res = await send({ type: 'get_config' }, pageSender('https://evil.com'));
    expect(res).toEqual({ error: 'Unauthorized' });
  });
});

describe('the legitimate popup flow works', () => {
  it('grants to the pending consent origin, ignoring a spoofed payload origin', async () => {
    // Background stored a pending consent for good.com (from a real page request).
    store[PENDING_POPUP_KEY] = JSON.stringify({ type: 'consent', origin: 'https://good.com', tabId: 7, timestamp: Date.now() });

    // The popup approves. Even if the payload names a different origin, the
    // grant must bind to the pending request's origin.
    const res = await send(
      { type: 'grant_permission', payload: { origin: 'https://evil.com' } },
      extensionSender()
    );
    expect(res).toEqual({ success: true });

    const perms = storedPermissions();
    expect(perms.map((p) => p.origin)).toEqual(['https://good.com']);
  });

  it('exposes the pending popup to the extension page', async () => {
    store[PENDING_POPUP_KEY] = JSON.stringify({ type: 'consent', origin: 'https://good.com', tabId: 7, timestamp: Date.now() });
    const res = await send({ type: 'get_pending_popup' }, extensionSender());
    expect(res.pending?.origin).toBe('https://good.com');
  });
});

describe('protected messages are gated by the sender origin', () => {
  it('session_init from an unpermitted page requires consent for the sender origin', async () => {
    const res = await send(
      { type: 'session_init', payload: { sessionId: 'abc', origin: 'https://good.com' } },
      pageSender('https://real-site.com')
    );
    // Consent is required, and the origin is the browser-verified sender origin,
    // NOT the value smuggled into the payload.
    expect(res).toEqual({ requiresConsent: true, origin: 'https://real-site.com' });
  });

  it('check_permission reports the sender origin only, ignoring payload', async () => {
    store[PERMISSIONS_KEY] = JSON.stringify([{ origin: 'https://real-site.com', capabilities: [], grantedAt: 1 }]);
    const res = await send(
      { type: 'check_permission', payload: { origin: 'https://good.com' } },
      pageSender('https://real-site.com')
    );
    expect(res).toEqual({ hasPermission: true });
  });
});
