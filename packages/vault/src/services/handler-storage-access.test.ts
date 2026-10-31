import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const access = vi.hoisted(() => ({ request: vi.fn(async () => {}) }));
vi.mock('./frame-storage.js', () => ({ getFrameStorageAccess: () => access }));
import { VaultHandler } from './handler.js';

describe('storage access request source', () => {
  let receive: (event: MessageEvent) => Promise<void>;
  let parent: { postMessage: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    access.request.mockClear(); parent = { postMessage: vi.fn() };
    vi.stubGlobal('window', { parent, addEventListener: (_type: string, listener: typeof receive) => { receive = listener; } });
    new VaultHandler();
  });
  afterEach(() => vi.unstubAllGlobals());
  const request = () => ({ protocol: 'windowllm', version: '1.0.0', id: 'request', timestamp: 1, direction: 'request', type: 'storage_access', payload: {} });

  it('rejects another window before showing a permission prompt', async () => {
    const other = { postMessage: vi.fn() };
    await receive({ data: request(), origin: 'https://other.example', source: other } as unknown as MessageEvent);
    expect(access.request).not.toHaveBeenCalled();
    expect(other.postMessage.mock.calls[0]?.[0].payload.code).toBe('PERMISSION_DENIED');
  });
  it('rejects an opaque embedding origin', async () => {
    await receive({ data: request(), origin: 'null', source: parent } as unknown as MessageEvent);
    expect(access.request).not.toHaveBeenCalled();
    expect(parent.postMessage.mock.calls[0]?.[0].payload.code).toBe('PERMISSION_DENIED');
  });
  it('responds only to the actual embedding window and its browser-provided origin', async () => {
    await receive({ data: request(), origin: 'https://site.example', source: parent } as unknown as MessageEvent);
    expect(access.request).toHaveBeenCalledOnce();
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request', type: 'storage_access', payload: { success: true } }), 'https://site.example');
  });
});
