/**
 * Tests for at-rest API key encryption in VaultStorage.
 *
 * The security property: when a passphrase is set up (vault unlocked), keys are
 * stored as AES-256-GCM ciphertext; otherwise they fall back to legacy XOR.
 * The correctness property: mutating one provider while the vault is locked must
 * NOT drop the AES keys of other providers it cannot currently decrypt.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VaultStorage, type StoredProviderConfig } from './storage.js';
import { VaultEncryption } from './crypto.js';
import type { StorageAdapter } from './storage-adapter.js';

const PROVIDERS_KEY = 'windowllm:providers';

class MemoryStorage implements StorageAdapter {
  store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); }
  async remove(key: string) { this.store.delete(key); }
  async clear() { this.store.clear(); }
}

/** Fake AES layer producing VaultEncryption's on-disk format (version/iv/ciphertext). */
class FakeEncryption {
  locked = false;
  async encrypt(plain: string): Promise<string> {
    return JSON.stringify({ version: 1, salt: 'c2FsdA==', iv: 'aXZpdml2aXY=', ciphertext: btoa('AES:' + plain) });
  }
  async decrypt(json: string): Promise<string> {
    const d = JSON.parse(json);
    return atob(d.ciphertext).replace(/^AES:/, '');
  }
}

function provider(id: string, apiKey: string): StoredProviderConfig {
  return { id, type: 'anthropic', name: id, enabled: true, apiKey, createdAt: 1, updatedAt: 1 };
}

let mem: MemoryStorage;
let enc: FakeEncryption;
let vault: VaultStorage;

beforeEach(() => {
  mem = new MemoryStorage();
  enc = new FakeEncryption();
  vault = new VaultStorage(mem, enc as unknown as VaultEncryption);
});

function rawKeyFor(id: string): string | undefined {
  const raw = JSON.parse(mem.store.get(PROVIDERS_KEY)!) as StoredProviderConfig[];
  return raw.find(p => p.id === id)?.apiKey;
}

describe('unlocked vault encrypts keys with AES', () => {
  it('stores AES ciphertext and reads back plaintext', async () => {
    await vault.saveProvider(provider('a', 'sk-secret'));

    const stored = rawKeyFor('a')!;
    expect(VaultEncryption.isEncryptedFormat(stored)).toBe(true);
    expect(stored).not.toContain('sk-secret');

    const loaded = await vault.getProvider('a');
    expect(loaded?.apiKey).toBe('sk-secret');
  });
});

describe('locked vault falls back to obfuscation', () => {
  it('stores non-AES obfuscation but still round-trips', async () => {
    enc.locked = true;
    await vault.saveProvider(provider('a', 'sk-legacy'));

    const stored = rawKeyFor('a')!;
    expect(VaultEncryption.isEncryptedFormat(stored)).toBe(false);
    expect(stored).not.toContain('sk-legacy');

    const loaded = await vault.getProvider('a');
    expect(loaded?.apiKey).toBe('sk-legacy');
  });
});

describe('locked mutation preserves undecryptable AES keys', () => {
  it('does not wipe another provider’s AES key when saving while locked', async () => {
    // Save A while unlocked -> AES.
    await vault.saveProvider(provider('a', 'sk-aaa'));
    const aBlobBefore = rawKeyFor('a')!;
    expect(VaultEncryption.isEncryptedFormat(aBlobBefore)).toBe(true);

    // Lock, then save B.
    enc.locked = true;
    await vault.saveProvider(provider('b', 'sk-bbb'));

    // A's ciphertext must be byte-for-byte unchanged (not re-encrypted/dropped).
    expect(rawKeyFor('a')).toBe(aBlobBefore);
    expect(rawKeyFor('b')).toBeDefined();

    // While locked, A can't be decrypted (undefined) but B (XOR) can.
    const all = await vault.getProviders();
    expect(all.find(p => p.id === 'a')?.apiKey).toBeUndefined();
    expect(all.find(p => p.id === 'b')?.apiKey).toBe('sk-bbb');
  });
});

describe('migration upgrades legacy keys after unlock', () => {
  it('re-encrypts XOR keys as AES', async () => {
    // Store a legacy key while locked.
    enc.locked = true;
    await vault.saveProvider(provider('a', 'sk-old'));
    expect(VaultEncryption.isEncryptedFormat(rawKeyFor('a')!)).toBe(false);

    // Unlock and migrate.
    enc.locked = false;
    await vault.migrateProvidersToEncryption();

    expect(VaultEncryption.isEncryptedFormat(rawKeyFor('a')!)).toBe(true);
    const loaded = await vault.getProvider('a');
    expect(loaded?.apiKey).toBe('sk-old');
  });
});
