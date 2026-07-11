/**
 * Vault Encryption Module
 *
 * Provides secure encryption for API keys and other sensitive data
 * using Web Crypto API with PBKDF2 key derivation and AES-256-GCM.
 *
 * Features:
 * - CryptoKey persistence via IndexedDB (survives page reloads)
 * - Auto-lock after 30 minutes of inactivity
 * - Explicit lock clears all persisted state
 * - Works with both localStorage (vault) and chrome.storage (extension)
 */

import { type StorageAdapter, getStorageAdapter } from './storage-adapter.js';

const STORAGE_PREFIX = 'windowllm:';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 100000;

// Default timeout: 30 minutes in milliseconds
const DEFAULT_LOCK_TIMEOUT_MS = 30 * 60 * 1000;

// IndexedDB constants
const DB_NAME = 'windowllm-vault';
const DB_VERSION = 1;
const KEY_STORE = 'keys';

/**
 * Encrypted data structure stored in localStorage
 */
interface EncryptedData {
  version: 1;
  salt: string;      // Base64 encoded
  iv: string;        // Base64 encoded
  ciphertext: string; // Base64 encoded
}

/**
 * Open IndexedDB connection
 */
function openDatabase(): Promise<IDBDatabase> {
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
 * Store CryptoKey in IndexedDB
 */
async function storeKey(key: CryptoKey): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite');
    const store = tx.objectStore(KEY_STORE);
    const request = store.put(key, 'masterKey');

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    tx.oncomplete = () => db.close();
  });
}

/**
 * Retrieve CryptoKey from IndexedDB
 */
async function retrieveKey(): Promise<CryptoKey | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const store = tx.objectStore(KEY_STORE);
      const request = store.get('masterKey');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);

      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/**
 * Clear all keys from IndexedDB
 */
async function clearKeys(): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      const store = tx.objectStore(KEY_STORE);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();

      tx.oncomplete = () => db.close();
    });
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Vault encryption service using Web Crypto API
 *
 * Usage:
 * 1. Call unlock(passphrase) to derive key from user passphrase
 * 2. Use encrypt/decrypt for sensitive data
 * 3. Call lock() when done or on timeout
 *
 * The CryptoKey is persisted in IndexedDB and survives page reloads.
 * Auto-lock occurs after 30 minutes of inactivity.
 * Works with both localStorage (vault) and chrome.storage (extension).
 */
export class VaultEncryption {
  private masterKey: CryptoKey | null = null;
  private isUnlocked = false;
  private salt: Uint8Array | null = null;
  private lastActivity: number = 0;
  private lockTimeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS;
  private lockCheckInterval: ReturnType<typeof setInterval> | null = null;
  private storage: StorageAdapter;

  constructor(storage?: StorageAdapter) {
    this.storage = storage ?? getStorageAdapter();
    // Try to restore from IndexedDB on construction
    this.tryRestoreSession();
  }

  /**
   * Check if vault is currently locked (includes timeout check)
   */
  get locked(): boolean {
    if (!this.isUnlocked) return true;

    // Check if timed out
    if (this.isTimedOut()) {
      this.lock();
      return true;
    }

    return false;
  }

  /**
   * Check if the lock timeout has been exceeded
   */
  private isTimedOut(): boolean {
    if (this.lastActivity === 0) return false;
    return Date.now() - this.lastActivity > this.lockTimeoutMs;
  }

  /**
   * Update last activity timestamp
   */
  touchActivity(): void {
    this.lastActivity = Date.now();
    // Use sessionStorage if available (web), otherwise just keep in memory (extension)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`${STORAGE_PREFIX}last_activity`, String(this.lastActivity));
    }
  }

  /**
   * Try to restore session from IndexedDB
   */
  private async tryRestoreSession(): Promise<void> {
    // Check if we have a session marker (web only, extensions use IndexedDB directly)
    if (typeof sessionStorage !== 'undefined') {
      const lastActivity = sessionStorage.getItem(`${STORAGE_PREFIX}last_activity`);
      if (!lastActivity) return;

      this.lastActivity = parseInt(lastActivity, 10);

      // Check if timed out
      if (this.isTimedOut()) {
        await this.lock();
        return;
      }
    }

    // Try to retrieve key from IndexedDB
    const key = await retrieveKey();
    if (key) {
      this.masterKey = key;
      this.salt = await this.getOrCreateSalt();
      this.isUnlocked = true;
      this.touchActivity();
      this.startLockCheckInterval();
    }
  }

  /**
   * Check if session can be restored from IndexedDB
   * This is useful for iframe contexts where the session might have been
   * unlocked in a different window/popup/tab
   */
  async checkAndRestoreSession(): Promise<boolean> {
    // If already unlocked, nothing to do
    if (this.isUnlocked) return true;

    // If not set up, nothing to restore
    if (!(await this.isSetUp())) return false;

    // Try to retrieve key from IndexedDB
    // Note: We don't require sessionStorage marker here because the vault
    // might have been unlocked in a different tab. IndexedDB is shared
    // across all same-origin contexts.
    const key = await retrieveKey();
    if (key) {
      this.masterKey = key;
      this.salt = await this.getOrCreateSalt();
      this.isUnlocked = true;
      this.touchActivity();
      this.startLockCheckInterval();
      return true;
    }

    return false;
  }

  /**
   * Start periodic check for lock timeout
   */
  private startLockCheckInterval(): void {
    if (this.lockCheckInterval) return;

    // Check every minute
    this.lockCheckInterval = setInterval(() => {
      if (this.isTimedOut()) {
        this.lock();
      }
    }, 60000);
  }

  /**
   * Stop the lock check interval
   */
  private stopLockCheckInterval(): void {
    if (this.lockCheckInterval) {
      clearInterval(this.lockCheckInterval);
      this.lockCheckInterval = null;
    }
  }

  /**
   * Initialize or retrieve the salt
   * Salt is stored persistently and used for key derivation
   */
  private async getOrCreateSalt(): Promise<Uint8Array> {
    const storedSalt = await this.storage.get(`${STORAGE_PREFIX}crypto_salt`);
    if (storedSalt) {
      return Uint8Array.from(atob(storedSalt), c => c.charCodeAt(0));
    }

    // Generate new salt for first-time setup
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    await this.storage.set(`${STORAGE_PREFIX}crypto_salt`, btoa(String.fromCharCode(...salt)));
    return salt;
  }

  /**
   * Check if encryption has been set up (passphrase was created)
   */
  async isSetUp(): Promise<boolean> {
    const salt = await this.storage.get(`${STORAGE_PREFIX}crypto_salt`);
    const check = await this.storage.get(`${STORAGE_PREFIX}crypto_check`);
    return salt !== null && check !== null;
  }

  /**
   * First-time setup: create salt and store verification value
   */
  async setup(passphrase: string): Promise<boolean> {
    if (await this.isSetUp()) {
      throw new Error('Encryption already set up. Use unlock() instead.');
    }

    // Generate and store salt
    this.salt = await this.getOrCreateSalt();

    // Derive key from passphrase
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this.masterKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(this.salt!),
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );

    // Store encrypted check value to verify passphrase on unlock
    const checkValue = await this.encrypt('windowllm_check_value');
    await this.storage.set(`${STORAGE_PREFIX}crypto_check`, checkValue);

    // Persist key in IndexedDB
    await storeKey(this.masterKey);

    this.isUnlocked = true;
    this.touchActivity();
    this.startLockCheckInterval();

    return true;
  }

  /**
   * Unlock the vault with user passphrase
   * Derives encryption key from passphrase using PBKDF2
   */
  async unlock(passphrase: string): Promise<boolean> {
    if (!(await this.isSetUp())) {
      throw new Error('Encryption not set up. Use setup() first.');
    }

    this.salt = await this.getOrCreateSalt();

    // Derive key from passphrase
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this.masterKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(this.salt!),
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );

    // Verify passphrase by decrypting check value
    try {
      const checkEncrypted = await this.storage.get(`${STORAGE_PREFIX}crypto_check`);
      if (!checkEncrypted) {
        this.masterKey = null;
        return false;
      }

      const checkValue = await this.decrypt(checkEncrypted);
      if (checkValue !== 'windowllm_check_value') {
        this.masterKey = null;
        return false;
      }

      // Persist key in IndexedDB
      await storeKey(this.masterKey);

      this.isUnlocked = true;
      this.touchActivity();
      this.startLockCheckInterval();

      return true;
    } catch {
      // Decryption failed - wrong passphrase
      this.masterKey = null;
      return false;
    }
  }

  /**
   * Lock the vault, clearing the encryption key from memory and IndexedDB
   */
  async lock(): Promise<void> {
    this.masterKey = null;
    this.isUnlocked = false;
    this.lastActivity = 0;
    this.stopLockCheckInterval();

    // Clear persisted key
    await clearKeys();

    // Clear session marker (web only)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(`${STORAGE_PREFIX}last_activity`);
    }
  }

  /**
   * Get remaining time until auto-lock (in milliseconds)
   */
  getRemainingLockTime(): number {
    if (!this.isUnlocked || this.lastActivity === 0) return 0;
    const remaining = this.lockTimeoutMs - (Date.now() - this.lastActivity);
    return Math.max(0, remaining);
  }

  /**
   * Set the lock timeout duration
   */
  setLockTimeout(ms: number): void {
    this.lockTimeoutMs = ms;
  }

  /**
   * Encrypt plaintext using AES-256-GCM
   * Returns JSON string containing version, salt, iv, and ciphertext
   */
  async encrypt(plaintext: string): Promise<string> {
    if (!this.masterKey) {
      throw new Error('Vault is locked. Call unlock() first.');
    }

    // Update activity on encrypt
    this.touchActivity();

    // Generate random IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.masterKey,
      encoded
    );

    const data: EncryptedData = {
      version: 1,
      salt: btoa(String.fromCharCode(...this.salt!)),
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    };

    return JSON.stringify(data);
  }

  /**
   * Decrypt ciphertext using AES-256-GCM
   */
  async decrypt(encryptedJson: string): Promise<string> {
    if (!this.masterKey) {
      throw new Error('Vault is locked. Call unlock() first.');
    }

    // Update activity on decrypt
    this.touchActivity();

    const data = JSON.parse(encryptedJson) as EncryptedData;

    if (data.version !== 1) {
      throw new Error(`Unsupported encryption version: ${data.version}`);
    }

    const iv = Uint8Array.from(atob(data.iv), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(data.ciphertext), c => c.charCodeAt(0));

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.masterKey,
      ciphertext
    );

    return new TextDecoder().decode(plaintext);
  }

/**
   * Check if a string looks like encrypted data (vs legacy obfuscation)
   */
  static isEncryptedFormat(data: string): boolean {
    try {
      const parsed = JSON.parse(data);
      return parsed.version === 1 && !!parsed.iv && !!parsed.ciphertext;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let vaultEncryptionInstance: VaultEncryption | null = null;

/**
 * Get the singleton VaultEncryption instance
 * @param storage Optional storage adapter (defaults to auto-detected)
 */
export function getVaultEncryption(storage?: StorageAdapter): VaultEncryption {
  if (!vaultEncryptionInstance) {
    vaultEncryptionInstance = new VaultEncryption(storage);
  }
  return vaultEncryptionInstance;
}

/**
 * Reset the vault encryption instance (useful for testing)
 */
export function resetVaultEncryption(): void {
  vaultEncryptionInstance = null;
}
