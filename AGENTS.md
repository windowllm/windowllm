# WindowLLM Development Guidelines

## Project Overview

WindowLLM is a universal browser LLM API that gives users sovereignty over their AI.
It is **live at https://windowllm.org** (served from GitHub Pages). The project provides:

1. **`window.llm` API** — a standardized browser API for LLM access
2. **Vault** — the user's configuration hub at windowllm.org (React app)
3. **Browser Extension** — optional, required on Safari and for local models
4. **Provider Adapters** — normalize differences between LLM providers

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Third-Party Website                      │
│  <script src="https://windowllm.org/llm.js"></script>       │
│                                                              │
│  const session = await window.llm.requestSession();         │
│  const result = await session.complete("Hello!");           │
└─────────────────────────────────────────────────────────────┘
                              │
                    postMessage protocol
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Vault iframe (windowllm.org/frame.html)         │
│  • User's API keys (encrypted, never leave this origin)      │
│  • Provider configuration • Per-site permissions             │
│  • Rate limiting • Adapters make the actual API calls        │
└─────────────────────────────────────────────────────────────┘
                              │
                         API calls
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│   LLM Providers                                              │
│   Anthropic · OpenAI · Google Gemini · OpenRouter (browser-  │
│   direct CORS) · Ollama / LM Studio (local, via extension)   │
└─────────────────────────────────────────────────────────────┘
```

The site at windowllm.org has three faces, all served from `packages/vault/dist`:

- `/` — the marketing **home** page (Landing).
- `/vault` — the **vault** app (setup / unlock / dashboard). "Exit" returns home.
- `/frame.html` — the hidden **iframe** a site embeds via `llm.js`; `/unlock` and
  consent popups are opened from it. These client-routed paths resolve through a
  SPA fallback (`404.html`) because GitHub Pages is static.
- `/demo/` — the example pages (see `examples/`).

## Package Structure

```
packages/
├── types/       # @windowllm/types    - shared TypeScript types
├── protocol/    # @windowllm/protocol - postMessage protocol
├── adapters/    # @windowllm/adapters - provider adapters (flat files: anthropic.ts,
│                #                        openai.ts, gemini.ts, ollama.ts, openrouter.ts,
│                #                        mock.ts, index.ts)
├── client/      # @windowllm/client   - llm.js library (built to llm.iife.js)
├── vault/       # @windowllm/vault    - React vault app + iframe + extension pages
└── extension/   # @windowllm/extension- MV3 browser extension (content/inject/background)
```

### Dependency Graph

```
types → protocol → adapters → client → vault
                                     ↘ extension
```

## Development Commands

```bash
npm install                 # install all workspaces

# Build in DEPENDENCY ORDER — root `npm run build` is NOT topological. CI and
# deploy build explicitly (the spec and dev guide are static HTML, no build):
npm run build --workspace=@windowllm/types --workspace=@windowllm/protocol --workspace=@windowllm/adapters
npm run build --workspace=@windowllm/client
npm run build --workspace=@windowllm/vault

npm run typecheck           # tsc --noEmit across workspaces
npm test                    # unit tests (vitest) across workspaces
npm run test:e2e            # Playwright e2e (Chromium + Firefox) against local dev servers
npm run test:extension:webkit  # headless Safari-extension test (macOS + Xcode CLT)

# Local dev (HTTPS via mkcert; run `npm run setup:https` once):
npm run dev                 # vault at windowllm.localhost:3000
npm run dev:test-vault      # vault on :3100  } used together for e2e / manual
npm run dev:test-page       # test page on :3101 } cross-origin testing
npm run dev:examples        # the examples/ demos
```

## Deployment

- `.github/workflows/deploy-pages.yml` builds the shared packages + client + vault,
  assembles `_site` (`vault/dist/*` + `llm.js` + `examples/` → `/demo` +
  `spec/index.html` → `/spec/` + `docs/index.html` → `/docs/` + `CNAME` +
  `404.html` + `/vault/index.html`), and force-pushes the **gh-pages** branch on
  every push to `main`.
- The **spec** (`/spec/`, ReSpec — renders client-side, no build) and the **developer
  guide** (`/docs/`, self-contained static HTML) are copied in as plain files, so
  GitHub Pages serves them directly ahead of the SPA `404.html` fallback.
- GitHub Pages serves gh-pages at **windowllm.org** with **Enforce HTTPS on** (a
  secure context is required — `crypto.subtle` for key encryption only exists over
  HTTPS/localhost). HTML is CDN-cached ~10 min, so fixes need a hard refresh.
- `.github/workflows/ci.yml` runs on push/PR: typecheck + unit tests (ubuntu) and
  the WKWebExtension test (macos-15).

## Key Design Principles

1. **User sovereignty** — API keys never leave the vault origin; per-site consent.
2. **Provider agnosticism** — one `window.llm` API; sites request capabilities, not
   vendors; adapters normalize differences.
3. **Progressive enhancement** — works with no install via the iframe + postMessage;
   the extension adds local models, lifts CORS limits, and is **required on Safari**
   (Safari partitions iframe storage, and its Storage Access API grants cookies only).
4. **Web platform alignment** — Permissions-API patterns, `AsyncIterable` streaming,
   standard error types with retry hints.

## Security & Storage

- **Key encryption**: when a passphrase is set, keys are encrypted at rest with
  **AES-256-GCM** (key derived via PBKDF2), in `services/crypto.ts` (`VaultEncryption`).
  The master key persists in IndexedDB so the iframe can decrypt after unlock. Keys
  without a passphrase fall back to legacy XOR obfuscation (not secure); both formats
  coexist and are detected per-key.
- **postMessage**: always validate `event.origin` (browser-enforced); correlate by
  message id; never trust origin claims in the payload.
- **Permissions**: consent is effectively binary — once a site is allowed it may use
  any capability the chosen model supports; permissions are revocable per site.
- **Config export/import** (`services/config-transfer.ts`): providers, settings, and
  permissions can be exported to a self-contained **encrypted file** (AES-256-GCM +
  PBKDF2 from a user password) and imported additively or fresh. Portable across
  devices. Add future exportable config (aliases, prompts, budgets) to `ConfigBundle`.

## Testing

- **Unit** (`vitest`): adapters (mock responses), vault storage/crypto, extension
  background message auth.
- **E2E** (`playwright`, `tests/e2e/`): full client↔vault flow against local dev
  servers in Chromium and Firefox. These exercise the iframe/client path; they do
  **not** load the Chrome or Firefox browser extensions.
- **Safari extension** (`scripts/wkwebext-test/`): a small Swift `.app` loads the
  built extension into `WKWebExtensionController` (the same WebExtension engine Safari
  embeds) and asserts `window.llm.provider === "extension"` — headless, no VM, no
  signing. This **replaced** a removed tart macOS-VM harness (which could never enable
  the unsigned extension and only exercised the iframe fallback).
- The Safari extension build is currently **ad-hoc signed**; enabling an unsigned
  extension headlessly in real Safari is not automatable, which is why the WebKit
  host test exists.

### E2E Setup and Execution

From a fresh checkout, install dependencies, create the local HTTPS certificates,
install the Playwright browsers, and build the workspace dependencies in order:

```bash
npm install
npm run setup:https
npx playwright install chromium firefox

npm run build --workspace=@windowllm/types --workspace=@windowllm/protocol --workspace=@windowllm/adapters
npm run build --workspace=@windowllm/client
```

`npm run setup:https` uses `mkcert`, installs its local CA when needed, and writes
the certificate and key to `.certs/`. The Playwright web servers expect these files;
without them Vite starts over HTTP while Playwright waits for HTTPS.

Run the complete iframe/client E2E suite with:

```bash
npm run test:e2e
```

`playwright.config.ts` automatically starts the vault at
`https://windowllm.localhost:3100` and the cross-origin test page at
`https://test.localhost:3101`, then runs every test against Chromium and Firefox.
The ports must be free. In sandboxed agent environments, run this command outside
the sandbox because the suite must bind both ports and launch browser processes.

Useful focused runs:

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test tests/e2e/client/
npx playwright test tests/e2e/vault/
```

The Playwright suite does not load the Chrome or Firefox extension packages. There
is currently no extension-loaded E2E suite for those browsers. On macOS 15.4+ with
Xcode 16.3+ command-line tools, run the Safari/WebKit extension injection smoke test
separately:

```bash
npm run test:extension:webkit
```

This loads the real built extension into `WKWebExtensionController` and verifies
that it injects the extension-backed `window.llm` API. It does not cover Safari UI,
extension installation/signing, popup/options workflows, or a live provider request.

## Code Style

- TypeScript strict mode; `readonly` for immutable props; `interface` over `type`
  for object shapes; `AsyncIterable` for streaming; JSDoc on public APIs.
- No em dashes in UI copy. Keep the vault/demos on the gold-on-slate brand.

## Common Tasks

### Adding a New Provider
1. Create `packages/adapters/src/<provider>.ts` implementing `ProviderAdapter`
   (from `./index.js`); set `browserDirect` truthfully.
2. Register it in the vault handler's `createAdapter` (`packages/vault/src/services/handler.ts`)
   and add the type to `PROVIDER_INFO` + `ProviderLogo`.
3. Add unit tests with mock responses.

### Adding a New Capability
1. Add to `ModelCapabilities` in `@windowllm/types`.
2. Report it from the adapters; gate it in the session/completion path.

### Modifying the Protocol
1. Update `@windowllm/protocol`; update client + vault message handling; keep
   backwards compatibility or bump the version.

## Useful References

- [Specification](./spec/index.html) — **normative** [ReSpec](https://respec.org/)
  spec (source-accurate WebIDL), published at `windowllm.org/spec/`. This replaced
  the old Bikeshed source. Edit the WebIDL/prose here when the `window.llm` surface
  in `@windowllm/types` changes.
- [Developer Guide](./docs/index.html) — friendly, example-driven guide for site
  authors, published at `windowllm.org/docs/`. Self-contained (no third-party requests).
- [API Design](./docs/api-design.md) — internal design notes / rationale.
- [README](./README.md) — setup, provider CORS status, testing details
