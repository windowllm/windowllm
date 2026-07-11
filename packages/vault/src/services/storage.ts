/**
 * Vault Storage Service
 *
 * Handles encrypted storage of provider configurations and permissions.
 * Works with both localStorage (web) and chrome.storage (extension).
 */

import type { ModelCapabilities } from '@windowllm/types';
import { getStorageAdapter, type StorageAdapter } from './storage-adapter.js';
import { VaultEncryption, getVaultEncryption } from './crypto.js';

const STORAGE_PREFIX = 'windowllm:';
const PROVIDERS_KEY = `${STORAGE_PREFIX}providers`;
const PERMISSIONS_KEY = `${STORAGE_PREFIX}permissions`;
const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;

/**
 * Provider configuration stored in vault
 */
export interface StoredProviderConfig {
  id: string;
  type: 'openai' | 'anthropic' | 'ollama' | 'openrouter' | 'custom' | 'mock';
  name: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Site permission record
 */
export interface SitePermission {
  origin: string;
  capabilities: (keyof ModelCapabilities)[];
  grantedAt: number;
  expiresAt?: number;
  allowedModels?: string[];
  rateLimit?: {
    requestsPerMinute: number;
    tokensPerDay: number;
  };
}

/**
 * Vault settings
 */
export interface VaultSettings {
  defaultProvider?: string;
  requireApproval: boolean;
  autoApproveOrigins: string[];
  globalRateLimit: {
    requestsPerMinute: number;
    tokensPerDay: number;
  };
}

const DEFAULT_SETTINGS: VaultSettings = {
  requireApproval: true,
  autoApproveOrigins: [],
  globalRateLimit: {
    requestsPerMinute: 60,
    tokensPerDay: 100000,
  },
};

const ENCRYPTION_KEY_KEY = `${STORAGE_PREFIX}key`;

/**
 * Simple obfuscation for API keys (legacy mode)
 *
 * This provides basic protection against casual inspection but is NOT
 * cryptographically secure. It's used as a fallback when the user hasn't
 * set up passphrase-based encryption (VaultEncryption in crypto.ts).
 *
 * For secure encryption with PBKDF2 + AES-256-GCM, see VaultEncryption.
 */
class SimpleObfuscation {
  private storage: StorageAdapter;
  private keyCache: string | null = null;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  private async getOrCreateKey(): Promise<string> {
    if (this.keyCache) {
      return this.keyCache;
    }

    let key = await this.storage.get(ENCRYPTION_KEY_KEY);
    if (!key) {
      // Generate a new key using two UUIDs for sufficient length
      key = crypto.randomUUID() + crypto.randomUUID();
      await this.storage.set(ENCRYPTION_KEY_KEY, key);
    }
    this.keyCache = key;
    return key;
  }

  async encrypt(data: string): Promise<string> {
    const key = await this.getOrCreateKey();
    const dataBytes = new TextEncoder().encode(data);
    const keyBytes = new TextEncoder().encode(key);
    const encrypted = new Uint8Array(dataBytes.length);

    for (let i = 0; i < dataBytes.length; i++) {
      encrypted[i] = dataBytes[i]! ^ keyBytes[i % keyBytes.length]!;
    }

    // Convert to base64
    return btoa(String.fromCharCode(...encrypted));
  }

  async decrypt(data: string): Promise<string> {
    const key = await this.getOrCreateKey();

    // Decode from base64
    const encryptedBytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const keyBytes = new TextEncoder().encode(key);
    const decrypted = new Uint8Array(encryptedBytes.length);

    for (let i = 0; i < encryptedBytes.length; i++) {
      decrypted[i] = encryptedBytes[i]! ^ keyBytes[i % keyBytes.length]!;
    }

    return new TextDecoder().decode(decrypted);
  }
}

/**
 * Storage service for vault data
 */
export class VaultStorage {
  private storage: StorageAdapter;
  private obfuscation: SimpleObfuscation;
  private encryption: VaultEncryption;

  constructor(storage?: StorageAdapter, encryption?: VaultEncryption) {
    this.storage = storage ?? getStorageAdapter();
    this.obfuscation = new SimpleObfuscation(this.storage);
    this.encryption = encryption ?? getVaultEncryption(this.storage);
  }

  // =========================================================================
  // API key encryption
  //
  // When a passphrase is set up and the vault is unlocked, API keys are
  // encrypted at rest with AES-256-GCM (VaultEncryption). Otherwise they fall
  // back to legacy XOR obfuscation — better than plaintext against a casual
  // profile scan, but NOT cryptographically secure. On read we detect the
  // format per key, so both live side by side during migration.
  // =========================================================================

  private async encryptKey(plain: string): Promise<string> {
    if (!this.encryption.locked) {
      try {
        return await this.encryption.encrypt(plain);
      } catch {
        // fall through to obfuscation if AES encryption fails
      }
    }
    return this.obfuscation.encrypt(plain);
  }

  /** Decrypt a stored key. Returns undefined if an AES key can't be read (vault locked). */
  private async decryptKey(stored: string): Promise<string | undefined> {
    if (VaultEncryption.isEncryptedFormat(stored)) {
      if (this.encryption.locked) return undefined;
      try {
        return await this.encryption.decrypt(stored);
      } catch {
        return undefined;
      }
    }
    try {
      return await this.obfuscation.decrypt(stored);
    } catch {
      return undefined;
    }
  }

  /** Read stored providers WITHOUT decrypting keys (for safe mutation while locked). */
  private async getRawProviders(): Promise<StoredProviderConfig[]> {
    const data = await this.storage.get(PROVIDERS_KEY);
    if (!data) return [];
    try {
      return JSON.parse(data) as StoredProviderConfig[];
    } catch {
      return [];
    }
  }

  /**
   * Re-encrypt any legacy XOR-obfuscated keys with AES-256-GCM. No-op while the
   * vault is locked. Safe to call opportunistically after unlock.
   */
  async migrateProvidersToEncryption(): Promise<void> {
    if (this.encryption.locked) return;
    const raw = await this.getRawProviders();
    let changed = false;
    for (const p of raw) {
      if (p.apiKey && !VaultEncryption.isEncryptedFormat(p.apiKey)) {
        try {
          const plain = await this.obfuscation.decrypt(p.apiKey);
          p.apiKey = await this.encryption.encrypt(plain);
          changed = true;
        } catch {
          // leave un-migratable entries as-is
        }
      }
    }
    if (changed) {
      await this.storage.set(PROVIDERS_KEY, JSON.stringify(raw));
    }
  }

  // =========================================================================
  // Provider Configuration
  // =========================================================================

  async getProviders(): Promise<StoredProviderConfig[]> {
    const providers = await this.getRawProviders();
    return Promise.all(
      providers.map(async p => ({
        ...p,
        apiKey: p.apiKey ? await this.decryptKey(p.apiKey) : undefined,
      }))
    );
  }

  async getProvider(id: string): Promise<StoredProviderConfig | null> {
    const providers = await this.getProviders();
    return providers.find(p => p.id === id) || null;
  }

  async saveProvider(config: StoredProviderConfig): Promise<void> {
    // Operate on the RAW stored list so other providers' encrypted keys are
    // preserved byte-for-byte (never round-tripped through a locked decrypt,
    // which would drop AES keys we can't currently read).
    const raw = await this.getRawProviders();
    const index = raw.findIndex(p => p.id === config.id);

    const encryptedKey = config.apiKey ? await this.encryptKey(config.apiKey) : undefined;
    const toStore: StoredProviderConfig = {
      ...config,
      apiKey: encryptedKey,
      updatedAt: Date.now(),
      createdAt: index >= 0 ? raw[index]!.createdAt : Date.now(),
    };

    if (index >= 0) {
      raw[index] = toStore;
    } else {
      raw.push(toStore);
    }

    await this.storage.set(PROVIDERS_KEY, JSON.stringify(raw));
  }

  async deleteProvider(id: string): Promise<void> {
    const raw = await this.getRawProviders();
    await this.storage.set(PROVIDERS_KEY, JSON.stringify(raw.filter(p => p.id !== id)));
  }

  async getEnabledProviders(): Promise<StoredProviderConfig[]> {
    const providers = await this.getProviders();
    return providers.filter(p => p.enabled);
  }

  // =========================================================================
  // Site Permissions
  // =========================================================================

  async getPermissions(): Promise<SitePermission[]> {
    const data = await this.storage.get(PERMISSIONS_KEY);
    if (!data) return [];

    try {
      return JSON.parse(data) as SitePermission[];
    } catch {
      return [];
    }
  }

  async getPermission(origin: string): Promise<SitePermission | null> {
    const permissions = await this.getPermissions();
    const permission = permissions.find(p => p.origin === origin);

    // Check if expired
    if (permission?.expiresAt && permission.expiresAt < Date.now()) {
      await this.revokePermission(origin);
      return null;
    }

    return permission || null;
  }

  async grantPermission(permission: SitePermission): Promise<void> {
    const permissions = await this.getPermissions();
    const index = permissions.findIndex(p => p.origin === permission.origin);

    if (index >= 0) {
      permissions[index] = permission;
    } else {
      permissions.push(permission);
    }

    await this.storage.set(PERMISSIONS_KEY, JSON.stringify(permissions));
  }

  async revokePermission(origin: string): Promise<void> {
    const permissions = await this.getPermissions();
    const filtered = permissions.filter(p => p.origin !== origin);
    await this.storage.set(PERMISSIONS_KEY, JSON.stringify(filtered));
  }

  async hasPermission(origin: string, capability: keyof ModelCapabilities): Promise<boolean> {
    const permission = await this.getPermission(origin);
    return permission?.capabilities.includes(capability) || false;
  }

  // =========================================================================
  // Settings
  // =========================================================================

  async getSettings(): Promise<VaultSettings> {
    const data = await this.storage.get(SETTINGS_KEY);
    if (!data) return DEFAULT_SETTINGS;

    try {
      const saved = JSON.parse(data);
      return {
        ...DEFAULT_SETTINGS,
        ...saved,
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async saveSettings(settings: Partial<VaultSettings>): Promise<void> {
    const current = await this.getSettings();
    await this.storage.set(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  async isConfigured(): Promise<boolean> {
    const providers = await this.getEnabledProviders();
    return providers.length > 0;
  }

  async clear(): Promise<void> {
    await this.storage.clear();
  }

  async export(): Promise<string> {
    const providers = await this.getProviders();
    const permissions = await this.getPermissions();
    const settings = await this.getSettings();

    return JSON.stringify({
      providers: providers.map(p => ({ ...p, apiKey: '***' })), // Don't export API keys
      permissions,
      settings,
    });
  }
}

// Singleton instance
let vaultStorageInstance: VaultStorage | null = null;

export function getVaultStorage(): VaultStorage {
  if (!vaultStorageInstance) {
    vaultStorageInstance = new VaultStorage();
  }
  return vaultStorageInstance;
}

// For backwards compatibility
export const vaultStorage = {
  get instance() {
    return getVaultStorage();
  },
};

// Re-export adapter utilities
export { getStorageAdapter, setStorageAdapter } from './storage-adapter.js';
export type { StorageAdapter } from './storage-adapter.js';

// Re-export crypto module
export { VaultEncryption, getVaultEncryption } from './crypto.js';
