import { LocalStorageAdapter, setStorageAdapter } from './storage-adapter.js';
import { resetVaultEncryption, setVaultIndexedDB } from './crypto.js';
import { resetVaultStorage } from './storage.js';

export interface VaultStorageHandle {
  readonly localStorage?: Storage;
  readonly indexedDB?: IDBFactory;
}

interface AccessDocument {
  requestStorageAccess?: (types: { localStorage: boolean; indexedDB: boolean }) => Promise<VaultStorageHandle | undefined>;
}

export function installFrameStorage(handle: VaultStorageHandle): void {
  if (!handle.localStorage || !handle.indexedDB) throw new Error('This browser cannot provide access to the existing vault. Use the WindowLLM extension.');
  setStorageAdapter(new LocalStorageAdapter(handle.localStorage));
  setVaultIndexedDB(handle.indexedDB);
  resetVaultEncryption();
  resetVaultStorage();
}

/** Browser storage permission is separate from a site's permission to use AI. */
export class FrameStorageAccess {
  private ready = false;
  private initializing: Promise<boolean> | null = null;
  private pending: Promise<void> | null = null;

  constructor(
    private readonly win: Window = window,
    private readonly doc: Document = document,
    private readonly permissions: Pick<Permissions, 'query'> = navigator.permissions,
    private readonly install: (handle: VaultStorageHandle) => void = installFrameStorage,
  ) {}

  private hasVaultData(): boolean {
    try {
      return ['windowllm:crypto_salt', 'windowllm:providers'].some(key => this.win.localStorage.getItem(key) !== null);
    } catch { return false; }
  }

  private async grant(): Promise<void> {
    const request = (this.doc as unknown as AccessDocument).requestStorageAccess;
    if (!request) throw new Error('Storage access is unavailable in this browser. Use the WindowLLM extension.');
    // Call before yielding: a click inside the vault frame supplies activation.
    const handle = await request.call(this.doc, { localStorage: true, indexedDB: true });
    if (handle?.localStorage && handle.indexedDB) this.install(handle);
    else if (!this.hasVaultData()) throw new Error('This browser does not expose the existing vault to embedded sites. Use the WindowLLM extension.');
    this.ready = true;
  }

  async ensure(): Promise<boolean> {
    if (this.ready) return true;
    if (this.win.self === this.win.top) return this.ready = true;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        const permission = await this.permissions.query({ name: 'storage-access' as PermissionName });
        if (permission.state === 'granted') { await this.grant(); return true; }
      } catch { /* Older browsers can already expose the real vault storage. */ }
      return this.ready = this.hasVaultData();
    })();
    try { return await this.initializing; } finally { this.initializing = null; }
  }

  async request(): Promise<void> {
    if (await this.ensure()) return;
    if (this.pending) return this.pending;
    const panel = this.doc.createElement('main');
    panel.style.cssText = 'font:16px system-ui;color:#17202a;background:#fffaf0;padding:24px;max-width:430px;margin:auto;line-height:1.5';
    const title = this.doc.createElement('h1'); title.textContent = 'Connect your WindowLLM vault'; title.style.fontSize = '22px';
    const explanation = this.doc.createElement('p'); explanation.textContent = 'Allow this WindowLLM frame to use your existing vault. Your API keys stay inside WindowLLM.';
    const connect = this.doc.createElement('button'); connect.textContent = 'Connect vault'; connect.style.cssText = 'background:#f5a623;color:#171717;border:0;border-radius:8px;padding:12px 18px;font:inherit;cursor:pointer';
    const cancel = this.doc.createElement('button'); cancel.textContent = 'Cancel'; cancel.style.cssText = 'margin-left:12px;padding:12px;font:inherit';
    const status = this.doc.createElement('p'); status.setAttribute('role', 'status');
    const bodyDisplay = this.doc.body.style.display;
    this.doc.body.style.display = 'block';
    panel.append(title, explanation, connect, cancel, status); this.doc.body.append(panel);
    this.pending = new Promise<void>((resolve, reject) => {
      connect.addEventListener('click', () => {
        connect.disabled = true; cancel.disabled = true; status.textContent = 'Waiting for browser permission…';
        void this.grant().then(resolve, reject);
      });
      cancel.addEventListener('click', () => reject(new Error('Vault storage access cancelled.')));
    });
    try { await this.pending; } finally { panel.remove(); this.doc.body.style.display = bodyDisplay; this.pending = null; }
  }
}

let frameAccess: FrameStorageAccess | undefined;
export function getFrameStorageAccess(): FrameStorageAccess {
  return frameAccess ??= new FrameStorageAccess();
}
