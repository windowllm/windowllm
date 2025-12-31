/**
 * Vault Storage Service
 *
 * Handles encrypted storage of provider configurations and permissions.
 * Works with both localStorage (web) and chrome.storage (extension).
 */

import type { ModelCapabilities } from '@windowllm/types';
import { getStorageAdapter, type StorageAdapter } from './storage-adapter.js';

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

  constructor(storage?: StorageAdapter) {
    this.storage = storage ?? getStorageAdapter();
    this.obfuscation = new SimpleObfuscation(this.storage);
  }

  // =========================================================================
  // Provider Configuration
  // =========================================================================

  async getProviders(): Promise<StoredProviderConfig[]> {
    const data = await this.storage.get(PROVIDERS_KEY);
    if (!data) return [];

    try {
      const providers = JSON.parse(data) as StoredProviderConfig[];
      // Decrypt API keys
      return Promise.all(
        providers.map(async p => ({
          ...p,
          apiKey: p.apiKey ? await this.obfuscation.decrypt(p.apiKey) : undefined,
        }))
      );
    } catch {
      return [];
    }
  }

  async getProvider(id: string): Promise<StoredProviderConfig | null> {
    const providers = await this.getProviders();
    return providers.find(p => p.id === id) || null;
  }

  async saveProvider(config: StoredProviderConfig): Promise<void> {
    const providers = await this.getProviders();
    const index = providers.findIndex(p => p.id === config.id);

    // Store with plain apiKey - encryption happens below for all providers
    const toStore = {
      ...config,
      updatedAt: Date.now(),
    };

    if (index >= 0) {
      const existing = providers[index]!;
      providers[index] = { ...toStore, createdAt: existing.createdAt };
    } else {
      providers.push({ ...toStore, createdAt: Date.now() });
    }

    // Encrypt all API keys before storing
    const encryptedProviders = await Promise.all(
      providers.map(async p => ({
        ...p,
        apiKey: p.apiKey ? await this.obfuscation.encrypt(p.apiKey) : undefined,
      }))
    );

    await this.storage.set(PROVIDERS_KEY, JSON.stringify(encryptedProviders));
  }

  async deleteProvider(id: string): Promise<void> {
    const providers = await this.getProviders();
    const filtered = providers.filter(p => p.id !== id);

    // Re-encrypt before storing
    const toStore = await Promise.all(
      filtered.map(async p => ({
        ...p,
        apiKey: p.apiKey ? await this.obfuscation.encrypt(p.apiKey) : undefined,
      }))
    );

    await this.storage.set(PROVIDERS_KEY, JSON.stringify(toStore));
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
