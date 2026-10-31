# Connect an existing vault inside a cross-site iframe

Browsers partition localStorage and IndexedDB by top-level site. A writable empty
partition does not establish that the user's top-level vault is unconfigured.
The frame now requests browser-granted access to both stores and keeps all
credential operations inside the vault origin.

The iframe sandbox includes `allow-storage-access-by-user-activation`. When
storage access is needed, the client reveals that same iframe with a Connect
vault button. The click inside the vault calls
`document.requestStorageAccess({localStorage:true,indexedDB:true})`. Supported
browsers return unpartitioned storage handles. The local storage adapter uses the
granted Storage object, and encryption key restoration uses the granted IDBFactory.
Model metadata caching follows the selected storage adapter too.

After access is granted, the frame returns to hidden mode and the pending
handshake resumes. Per-site AI consent and vault unlock remain separate checks;
their normal popups close after completion. No blank connection window remains.
Previously granted browser permission is activated without another prompt when
the browser exposes it; some browser policies require another click in a new
frame. Unsupported non-cookie access reports an extension requirement instead
of treating isolated storage as an empty account.

The additive `storage_access` request returns success or a storage-access error.
It is accepted only from the actual embedding window with a non-opaque origin.
Protocol responses must come from the exact vault frame and vault origin.
Denied or cancelled initialization can be retried through `waitForReady()`.

Sites can opt in to local diagnostic events by setting
`window.WINDOWLLM_ACTIVITY = true` before loading the client. The client emits
`windowllm:activity` CustomEvents for sent/received vault messages and consent or
unlock events. Session tokens, nonces and credential fields are redacted. These
events are diagnostics, never authorization or execution inputs.

## Verification

Unit tests cover an empty writable partition, previously granted access, an
actual in-frame click, cancellation, partial handles and concurrent requests.
Workspace type checks, builds and unit tests pass.

A Chrome test used an encrypted disposable vault on `windowllm.localhost` and a
different top-level site, `test.localhost`. A local OpenAI-compatible fixture
requires the decrypted test key. The hidden iframe completed a request with no
helper windows open. This exercises real browser storage handles and encryption
key restoration; it does not use a real provider account.

To reproduce on loopback HTTP (a browser secure context), run from a dedicated
checkout:

```sh
npm ci --ignore-scripts
npm run build --workspace=@windowllm/types --workspace=@windowllm/protocol --workspace=@windowllm/page-tools --workspace=@windowllm/adapters
npm run build --workspace=@windowllm/client
WINDOWLLM_STORAGE_TESTS=1 WINDOWLLM_STORAGE_TEST_HTTP=1 VITE_PORT=43140 npm run dev --workspace=@windowllm/vault -- --host 127.0.0.1
# In a second terminal:
WINDOWLLM_STORAGE_TEST_HTTP=1 node tests/storage-access/server.mjs
```

Open `http://windowllm.localhost:43140/__test/storage-access/vault.html` and create
the disposable encrypted vault. Open `http://test.localhost:43141/`, connect the
vault from the embedded prompt, allow this disposable site's AI consent, and
press Connect models and Complete through iframe. Check connection surfaces
must report zero open helper windows and a hidden iframe. The test-only seed
route exists only in the development server when explicitly enabled.

The public site must deploy both the updated client and vault frame. The client
uses a versioned frame URL so cached pre-fix HTML does not keep selecting old
frame assets.
