/**
 * Vault API
 *
 * Programmatic interface for vault operations. Wraps VaultStorage and
 * VaultEncryption into a clean, testable API.
 *
 * This API can be used by:
 * - Vault UI components
 * - E2E tests via window.vaultAPI
 * - Extension popup
 */

import type { ModelCapabilities } from '@windowllm/types';
import {
  createOpenAIAdapter,
  createAnthropicAdapter,
  createOllamaAdapter,
  createOpenRouterAdapter,
  createGeminiAdapter,
} from '@windowllm/adapters';
import {
  VaultStorage,
  getVaultStorage,
  type StoredProviderConfig,
  type SitePermission,
  type VaultSettings,
  type StorageAdapter,
} from './storage.js';
import { VaultEncryption, getVaultEncryption } from './crypto.js';

export interface VaultAPIOptions {
  storage?: StorageAdapter;
}

/**
 * Provider operations interface
 */
export interface ProvidersAPI {
  /** List all configured providers */
  list(): Promise<StoredProviderConfig[]>;

  /** Get a provider by ID */
  get(id: string): Promise<StoredProviderConfig | null>;

  /** Create a new provider */
  create(
    config: Omit<StoredProviderConfig, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<StoredProviderConfig>;

  /** Update an existing provider */
  update(
    id: string,
    updates: Partial<Omit<StoredProviderConfig, 'id' | 'createdAt'>>
  ): Promise<StoredProviderConfig>;

  /** Delete a provider */
  delete(id: string): Promise<void>;

  /** Test a provider's connection */
  test(id: string): Promise<boolean>;

  /** Enable or disable a provider */
  setEnabled(id: string, enabled: boolean): Promise<void>;

  /** Get all enabled providers */
  getEnabled(): Promise<StoredProviderConfig[]>;
}

/**
 * Permission operations interface
 */
export interface PermissionsAPI {
  /** List all site permissions */
  list(): Promise<SitePermission[]>;

  /** Get permission for a specific origin */
  get(origin: string): Promise<SitePermission | null>;

  /** Grant permission to a site */
  grant(permission: SitePermission): Promise<void>;

  /** Revoke permission for a site */
  revoke(origin: string): Promise<void>;

  /** Check if a site has a specific capability */
  check(origin: string, capability: keyof ModelCapabilities): Promise<boolean>;
}

/**
 * Settings operations interface
 */
export interface SettingsAPI {
  /** Get vault settings */
  get(): Promise<VaultSettings>;

  /** Update vault settings */
  update(settings: Partial<VaultSettings>): Promise<void>;
}

/**
 * Encryption operations interface
 */
export interface EncryptionAPI {
  /** Check if encryption has been set up */
  isSetUp(): Promise<boolean>;

  /** Check if vault is locked */
  isLocked(): boolean;

  /** Set up encryption with a passphrase (first-time setup) */
  setup(passphrase: string): Promise<boolean>;

  /** Unlock vault with passphrase */
  unlock(passphrase: string): Promise<boolean>;

  /** Lock the vault */
  lock(): Promise<void>;

  /** Get remaining time until auto-lock (ms) */
  getRemainingLockTime(): number;
}

/**
 * VaultAPI - Programmatic interface for all vault operations
 */
export class VaultAPI {
  private storage: VaultStorage;
  private encryption: VaultEncryption;

  /** Provider management operations */
  public readonly providers: ProvidersAPI;

  /** Permission management operations */
  public readonly permissions: PermissionsAPI;

  /** Settings management operations */
  public readonly settings: SettingsAPI;

  /** Encryption management operations */
  public readonly encryption_: EncryptionAPI;

  constructor(options?: VaultAPIOptions) {
    this.storage = options?.storage
      ? new VaultStorage(options.storage)
      : getVaultStorage();
    this.encryption = getVaultEncryption(options?.storage);

    // Initialize sub-APIs
    this.providers = this.createProvidersAPI();
    this.permissions = this.createPermissionsAPI();
    this.settings = this.createSettingsAPI();
    this.encryption_ = this.createEncryptionAPI();
  }

  private createProvidersAPI(): ProvidersAPI {
    const storage = this.storage;

    return {
      list: () => storage.getProviders(),

      get: (id: string) => storage.getProvider(id),

      create: async (config) => {
        const newProvider: StoredProviderConfig = {
          ...config,
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await storage.saveProvider(newProvider);
        return newProvider;
      },

      update: async (id, updates) => {
        const existing = await storage.getProvider(id);
        if (!existing) {
          throw new Error(`Provider not found: ${id}`);
        }
        const updated: StoredProviderConfig = {
          ...existing,
          ...updates,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: Date.now(),
        };
        await storage.saveProvider(updated);
        return updated;
      },

      delete: (id: string) => storage.deleteProvider(id),

      test: async (id: string) => {
        const provider = await storage.getProvider(id);
        if (!provider) return false;

        try {
          let adapter;
          switch (provider.type) {
            case 'openai':
              adapter = createOpenAIAdapter({
                apiKey: provider.apiKey,
                baseUrl: provider.baseUrl,
              });
              break;
            case 'anthropic':
              adapter = createAnthropicAdapter({
                apiKey: provider.apiKey,
                baseUrl: provider.baseUrl,
              });
              break;
            case 'ollama':
              adapter = createOllamaAdapter({ baseUrl: provider.baseUrl });
              break;
            case 'openrouter':
              adapter = createOpenRouterAdapter({
                apiKey: provider.apiKey,
                baseUrl: provider.baseUrl,
              });
              break;
            case 'gemini':
              adapter = createGeminiAdapter({
                apiKey: provider.apiKey,
                baseUrl: provider.baseUrl,
              });
              break;
            case 'custom':
              adapter = createOpenAIAdapter({
                apiKey: provider.apiKey,
                baseUrl: provider.baseUrl,
              });
              break;
            default:
              return false;
          }
          return await adapter.testConnection();
        } catch {
          return false;
        }
      },

      setEnabled: async (id, enabled) => {
        const provider = await storage.getProvider(id);
        if (!provider) {
          throw new Error(`Provider not found: ${id}`);
        }
        await storage.saveProvider({ ...provider, enabled, updatedAt: Date.now() });
      },

      getEnabled: () => storage.getEnabledProviders(),
    };
  }

  private createPermissionsAPI(): PermissionsAPI {
    const storage = this.storage;

    return {
      list: () => storage.getPermissions(),
      get: (origin: string) => storage.getPermission(origin),
      grant: (permission: SitePermission) => storage.grantPermission(permission),
      revoke: (origin: string) => storage.revokePermission(origin),
      check: (origin: string, capability: keyof ModelCapabilities) =>
        storage.hasPermission(origin, capability),
    };
  }

  private createSettingsAPI(): SettingsAPI {
    const storage = this.storage;

    return {
      get: () => storage.getSettings(),
      update: (settings: Partial<VaultSettings>) => storage.saveSettings(settings),
    };
  }

  private createEncryptionAPI(): EncryptionAPI {
    const encryption = this.encryption;
    const storage = this.storage;

    // After a successful unlock/setup, upgrade any legacy XOR-obfuscated keys
    // to AES-256-GCM so the vault's "encrypted at rest" guarantee is real.
    const migrate = async (ok: boolean): Promise<boolean> => {
      if (ok) {
        try {
          await storage.migrateProvidersToEncryption();
        } catch {
          // migration is best-effort; unlock still succeeded
        }
      }
      return ok;
    };

    return {
      isSetUp: () => encryption.isSetUp(),
      isLocked: () => encryption.locked,
      setup: (passphrase: string) => encryption.setup(passphrase).then(migrate),
      unlock: (passphrase: string) => encryption.unlock(passphrase).then(migrate),
      lock: () => encryption.lock(),
      getRemainingLockTime: () => encryption.getRemainingLockTime(),
    };
  }

  /**
   * Check if the vault is configured (has at least one enabled provider)
   */
  async isConfigured(): Promise<boolean> {
    return this.storage.isConfigured();
  }

  /**
   * Clear all vault data
   */
  async clear(): Promise<void> {
    await this.storage.clear();
  }

  /**
   * Export vault configuration (without API keys)
   */
  async export(): Promise<string> {
    return this.storage.export();
  }
}

// Singleton instance
let vaultAPIInstance: VaultAPI | null = null;

/**
 * Get the singleton VaultAPI instance
 */
export function getVaultAPI(options?: VaultAPIOptions): VaultAPI {
  if (!vaultAPIInstance) {
    vaultAPIInstance = new VaultAPI(options);
  }
  return vaultAPIInstance;
}

/**
 * Reset the VaultAPI instance (useful for testing)
 */
export function resetVaultAPI(): void {
  vaultAPIInstance = null;
}

// Re-export types for convenience
export type {
  StoredProviderConfig,
  SitePermission,
  VaultSettings,
} from './storage.js';
