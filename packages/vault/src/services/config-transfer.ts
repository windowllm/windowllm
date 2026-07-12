/**
 * Encrypted export / import of vault configuration.
 *
 * The exported file is a self-contained JSON envelope: the config bundle is
 * encrypted with AES-256-GCM using a key derived from a user-chosen password
 * (PBKDF2, 100k iterations). It does NOT depend on the vault's own master key,
 * so a file can be imported into a fresh vault on another browser or device.
 *
 * The bundle currently carries providers (with their API keys), settings, and
 * per-site permissions. FUTURE exportable config — custom model aliases, saved
 * prompts, per-site token budgets, usage history, UI preferences, ... — should
 * be added as new fields on ConfigBundle, with the VERSION bumped and a
 * migration handled in decryptConfig()/applyConfig().
 */

import {
  getVaultStorage,
  type StoredProviderConfig,
  type SitePermission,
  type VaultSettings,
} from './storage.js';

const FORMAT = 'windowllm-vault-export';
const VERSION = 1;
const PBKDF2_ITERATIONS = 100_000;

export interface ConfigBundle {
  providers: StoredProviderConfig[];
  settings: VaultSettings;
  permissions: SitePermission[];
  // future: modelAliases, prompts, budgets, ...
}

interface ExportEnvelope {
  format: string;
  version: number;
  exportedAt: string;
  kdf: { name: 'PBKDF2'; iterations: number; hash: 'SHA-256'; salt: string };
  cipher: { name: 'AES-GCM'; iv: string; ciphertext: string };
}

export type ImportMode = 'additive' | 'fresh';

function requireSubtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WindowLLM needs a secure (HTTPS) connection for encryption.');
  }
  return crypto.subtle;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = requireSubtle();
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Collect the current, decrypted config. Requires the vault to be unlocked. */
export async function gatherConfig(): Promise<ConfigBundle> {
  const storage = getVaultStorage();
  const [providers, settings, permissions] = await Promise.all([
    storage.getProviders(),
    storage.getSettings(),
    storage.getPermissions(),
  ]);
  return { providers, settings, permissions };
}

/** Encrypt the current config with `password`; returns a downloadable Blob. */
export async function exportConfig(password: string): Promise<Blob> {
  const bundle = await gatherConfig();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const ciphertext = await requireSubtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource);
  const envelope: ExportEnvelope = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2', iterations: PBKDF2_ITERATIONS, hash: 'SHA-256', salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) },
  };
  return new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
}

/** Decrypt an export file with `password`. Throws a friendly error on failure. */
export async function decryptConfig(fileText: string, password: string): Promise<ConfigBundle> {
  let env: ExportEnvelope;
  try {
    env = JSON.parse(fileText);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (env?.format !== FORMAT) throw new Error('That is not a WindowLLM export file.');
  const key = await deriveKey(password, fromBase64(env.kdf.salt));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await requireSubtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(env.cipher.iv) as BufferSource },
      key,
      fromBase64(env.cipher.ciphertext) as BufferSource,
    );
  } catch {
    throw new Error('Wrong password, or the file is corrupted.');
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(plaintext))) as ConfigBundle;
}

/**
 * Apply an imported bundle. `fresh` first removes existing providers and
 * permissions (the vault passphrase is preserved); `additive` merges on top.
 * Returns counts for a confirmation message.
 */
export async function applyConfig(
  bundle: ConfigBundle,
  mode: ImportMode,
): Promise<{ providers: number; permissions: number }> {
  const storage = getVaultStorage();

  if (mode === 'fresh') {
    for (const p of await storage.getProviders()) await storage.deleteProvider(p.id);
    for (const perm of await storage.getPermissions()) await storage.revokePermission(perm.origin);
  }

  const providers = bundle.providers ?? [];
  for (const p of providers) {
    // saveProvider re-encrypts apiKey with THIS vault's key, so the import is
    // portable across devices even though vault salts differ.
    await storage.saveProvider({ ...p, id: p.id || crypto.randomUUID() });
  }
  if (bundle.settings) await storage.saveSettings(bundle.settings);
  const permissions = bundle.permissions ?? [];
  for (const perm of permissions) await storage.grantPermission(perm);

  return { providers: providers.length, permissions: permissions.length };
}
