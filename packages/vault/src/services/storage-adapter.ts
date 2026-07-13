/**
 * Storage Adapter Interface
 *
 * Abstracts storage operations to work with both:
 * - localStorage (iframe/web mode)
 * - chrome.storage.local (extension mode)
 */

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * localStorage adapter for web/iframe mode
 */
export class LocalStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async clear(): Promise<void> {
    // Only clear windowllm keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('windowllm:')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
}

/**
 * chrome.storage.local adapter for extension mode
 */
export class ChromeStorageAdapter implements StorageAdapter {
  private get chromeStorage() {
    // Firefox's Promise API lives on `browser`; Chrome/Safari use `chrome`.
    return (globalThis as any).browser?.storage?.local
      ?? (globalThis as any).chrome?.storage?.local;
  }

  async get(key: string): Promise<string | null> {
    const result = await this.chromeStorage.get(key);
    return result[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.chromeStorage.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await this.chromeStorage.remove(key);
  }

  async clear(): Promise<void> {
    // Get all keys and remove only windowllm ones
    const all = await this.chromeStorage.get(null);
    const keysToRemove = Object.keys(all).filter((k: string) => k.startsWith('windowllm:'));
    if (keysToRemove.length > 0) {
      await this.chromeStorage.remove(keysToRemove);
    }
  }
}

/**
 * Detect which adapter to use based on environment
 */
export function createStorageAdapter(): StorageAdapter {
  // Check if we're in a Chrome extension context
  const chromeStorage = (globalThis as any).browser?.storage?.local
    ?? (globalThis as any).chrome?.storage?.local;
  if (chromeStorage) {
    return new ChromeStorageAdapter();
  }
  return new LocalStorageAdapter();
}

// Default adapter - can be overridden
let currentAdapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (!currentAdapter) {
    currentAdapter = createStorageAdapter();
  }
  return currentAdapter;
}

export function setStorageAdapter(adapter: StorageAdapter): void {
  currentAdapter = adapter;
}
