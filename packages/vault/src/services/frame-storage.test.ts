import { describe, it, expect } from 'vitest';
import { FrameStorageAccess, type VaultStorageHandle } from './frame-storage.js';

class TestElement {
  textContent = '';
  style = { cssText: '', fontSize: '' };
  disabled = false;
  removed = false;
  listeners = new Map<string, () => void>();
  children: TestElement[] = [];
  append(...nodes: TestElement[]): void { this.children.push(...nodes); }
  setAttribute(): void {}
  addEventListener(type: string, listener: () => void): void { this.listeners.set(type, listener); }
  click(): void { this.listeners.get('click')?.(); }
  remove(): void { this.removed = true; }
}

function fixture({ state = 'prompt', configured = false, topLevel = false, grant }: {
  state?: PermissionState; configured?: boolean; topLevel?: boolean;
  grant?: () => Promise<VaultStorageHandle | undefined>;
} = {}) {
  const values = new Map<string, string>(); if (configured) values.set('windowllm:providers', '[]');
  const storage = { getItem: (key: string) => values.get(key) ?? null } as Storage;
  const win = { localStorage: storage } as unknown as Window;
  Object.assign(win, { self: win, top: topLevel ? win : {} });
  const nodes: TestElement[] = [], body = new TestElement();
  let calls = 0;
  const doc = { body, createElement: () => { const node = new TestElement(); nodes.push(node); return node; }, requestStorageAccess: () => { calls++; return grant?.() ?? Promise.resolve({ localStorage: storage, indexedDB: {} as IDBFactory }); } } as unknown as Document;
  const installed: VaultStorageHandle[] = [];
  const access = new FrameStorageAccess(win, doc, { query: async () => ({ state } as PermissionStatus) }, handle => { installed.push(handle); });
  return { access, installed, nodes, values, get calls() { return calls; } };
}

describe('cross-site vault storage access', () => {
  it('does not mistake writable empty partitioned storage for a configured vault', async () => {
    const f = fixture(); expect(await f.access.ensure()).toBe(false); expect(f.calls).toBe(0);
  });

  it('leaves top-level and already accessible vaults alone', async () => {
    for (const options of [{ topLevel: true }, { configured: true }]) {
      const f = fixture(options); expect(await f.access.ensure()).toBe(true); expect(f.calls).toBe(0);
    }
  });

  it('activates previously granted localStorage and IndexedDB handles without another prompt', async () => {
    const f = fixture({ state: 'granted' }); expect(await f.access.ensure()).toBe(true);
    expect(f.installed).toHaveLength(1); expect(f.installed[0]?.indexedDB).toBeDefined();
    expect(await f.access.ensure()).toBe(true); expect(f.calls).toBe(1);
  });

  it('requests storage access only inside a click in the vault frame', async () => {
    let inClick = false;
    const handle = { localStorage: {} as Storage, indexedDB: {} as IDBFactory };
    const f = fixture({ grant: async () => { expect(inClick).toBe(true); return handle; } });
    const pending = f.access.request(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.calls).toBe(0);
    inClick = true; f.nodes.find(node => node.textContent === 'Connect vault')!.click(); inClick = false;
    await pending; expect(f.installed).toEqual([handle]); expect(await f.access.ensure()).toBe(true);
    expect(f.nodes[0]?.removed).toBe(true);
  });

  it('does not install partial access and allows retry after denial', async () => {
    const f = fixture({ grant: async () => ({ localStorage: {} as Storage }) });
    const pending = f.access.request(); await new Promise(resolve => setTimeout(resolve, 0));
    const rejected = expect(pending).rejects.toThrow(/extension/);
    f.nodes.find(node => node.textContent === 'Connect vault')!.click(); await rejected;
    expect(f.installed).toHaveLength(0); expect(await f.access.ensure()).toBe(false);
    const retry = f.access.request(); await new Promise(resolve => setTimeout(resolve, 0));
    const cancelled = expect(retry).rejects.toThrow(/cancelled/);
    f.nodes.filter(node => node.textContent === 'Cancel').at(-1)!.click(); await cancelled;
  });

  it('shares one permission panel across concurrent requests', async () => {
    const f = fixture(); const first = f.access.request(), second = f.access.request();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.nodes.filter(node => node.textContent === 'Connect vault')).toHaveLength(1);
    f.nodes.find(node => node.textContent === 'Connect vault')!.click(); await Promise.all([first, second]); expect(f.calls).toBe(1);
  });
});
