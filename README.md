# WindowLLM

**Universal Browser LLM API** - Giving users sovereignty over their AI.

Users configure their AI once. Every website gets access through a simple API. The user controls what models they use, what keys they provide, and which sites can access their LLM.

## Quick Start

For website developers:

```html
<script src="https://windowllm.org/llm.js"></script>
<script>
  const session = await window.llm.requestSession();
  const result = await session.complete("What is the capital of France?");
  console.log(result.message.content);
</script>
```

## Why WindowLLM?

**Current model**: Every site manages their own AI integration. Users have no control.

**WindowLLM model**: Users configure AI once. Sites request access through a standard API. Users control everything.

| Feature | Current Model | WindowLLM |
|---------|---------------|-----------|
| API Keys | Per-site, scattered | One vault, your control |
| Model Choice | Site decides | You decide |
| Privacy | Site sees everything | Site sees only responses |
| Cost Control | Per-site limits | Global limits you set |
| Permissions | All or nothing | Granular, revocable |

## API Overview

```typescript
// One-shot completion
const session = await window.llm.requestSession();
const result = await session.complete("Hello!");

// Streaming
for await (const chunk of session.stream("Write a story")) {
  output.textContent = chunk.accumulated;
}

// Tool calling
const session = await window.llm.requestSession({
  tools: [{ name: 'get_weather', ... }]
});

// Model discovery
const models = await window.llm.models.list();
const visionModels = await window.llm.models.match({
  capabilities: { required: ['vision'] }
});

// Embeddings
const embedder = await window.llm.requestEmbedding();
const vector = await embedder.embed("Hello world");
```

## How It Works

1. **User Setup**: Visit windowllm.org, add your API keys (Anthropic, OpenAI, Ollama, etc.)
2. **Site Integration**: Site includes `llm.js` script
3. **Permission Request**: Site requests LLM access, user sees consent prompt
4. **API Calls**: All calls go through vault - keys never leave windowllm.org

```
Site (example.com)     Vault (windowllm.org)     LLM Provider
       │                        │                      │
       │ ── postMessage ──────► │                      │
       │    "complete this"     │ ── API call ───────► │
       │                        │    (with your key)   │
       │ ◄── postMessage ────── │ ◄── response ─────── │
       │    "here's the result" │                      │
```

## Supported Providers

| Provider | Iframe Mode | Extension Mode | Notes |
|----------|-------------|----------------|-------|
| **Anthropic** | ✅ | ✅ | Full CORS support via `anthropic-dangerous-direct-browser-access` header |
| **OpenRouter** | ✅ | ✅ | CORS enabled, access to OpenAI/Anthropic/open models |
| **OpenAI** | ❌ | ✅ | No CORS support - use OpenRouter for browser access |
| **Ollama** | ❌ | ✅ | Local, requires extension to bypass CORS |
| **LM Studio** | ❌ | ✅ | Local, requires extension to bypass CORS |

**Recommendation**: For browser-only usage without extension, use **Anthropic** directly or **OpenRouter** (which provides access to OpenAI models).

## Installation Options

### No Install (iframe mode)
Just include the script. Works in Chrome and Firefox without issues.

#### Safari Limitations

Safari's iframe mode has significant limitations due to its aggressive storage partitioning (ITP - Intelligent Tracking Prevention):

| Storage Type | Chrome/Firefox | Safari |
|--------------|----------------|--------|
| localStorage | ✅ Accessible | ❌ Partitioned (empty) |
| IndexedDB | ✅ Accessible | ❌ Partitioned (empty) |
| Cookies | ✅ Accessible | ✅ Via Storage Access API |

**The problem**: Safari partitions all storage for third-party iframes. The vault iframe sees empty localStorage, even after the user grants permission via the Storage Access API. Safari's SAA only grants cookie access, not localStorage/IndexedDB.

**Why this happens**: WebKit has partitioned third-party storage since 2013 for privacy. While Chrome and Firefox support an extended Storage Access API (`requestStorageAccess({localStorage: true})`), Safari does not. WebKit's position on supporting this extension is ["under consideration"](https://github.com/WebKit/standards-positions/issues/262) with no timeline.

**Solution for Safari users**: Install the browser extension for full functionality.

**References**:
- [WebKit: Introducing Storage Access API](https://webkit.org/blog/8124/introducing-storage-access-api/) - "WebKit's implementation of the API only covers cookies"
- [privacycg/storage-access#4](https://github.com/privacycg/storage-access/issues/4) - Discussion on storage types covered
- [WebKit standards-positions#262](https://github.com/WebKit/standards-positions/issues/262) - WebKit's position on non-cookie storage (open, no timeline)
- [cookiestatus.com/safari](https://www.cookiestatus.com/safari/) - Safari storage restrictions overview

### Browser Extension (recommended)
Full capabilities, bypasses CORS for local models, works offline.

**How it works for apps**: Sites use the same `window.llm` API - no code changes needed. The extension injects `window.llm` before page scripts run, intercepting calls that would otherwise go to the iframe vault. Apps automatically use the extension when installed.

```
Without extension:  Site → window.llm (iframe) → postMessage → Vault iframe → Provider API
With extension:     Site → window.llm (extension) → Background worker → Provider API
```

**Benefits over iframe mode:**
- OpenAI works (no CORS restrictions)
- Local models work (Ollama, LM Studio)
- Background/service worker support
- Offline capable (with local models)

#### Building & Installing

```bash
# Build for Chrome
npm run build:extension

# Build for Firefox
npm run build:extension:firefox

# Build for Safari (macOS with Xcode required)
npm run build:extension:safari
```

**Chrome**: `chrome://extensions/` → Enable Developer mode → Load unpacked → Select `packages/extension/dist`

**Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → Select any file in `packages/extension/dist`

**Safari**: The build command creates the Xcode project, converts the extension, and builds the app automatically.

```bash
# Build and open (registers with Safari)
npm run build:extension:safari
open packages/extension/safari-project/build/WindowLLM.app
```

Then enable in Safari → Settings → Extensions → WindowLLM ✓

For distribution, copy to Applications: `cp -R packages/extension/safari-project/build/WindowLLM.app /Applications/`

**Safari build requirements:**
- macOS with Xcode installed
- Run `xcodebuild -runFirstLaunch` after first Xcode install
- Download Xcode from [developer.apple.com/download](https://developer.apple.com/download/all/) (free Apple ID required)

- [Chrome Web Store](#) (coming soon)
- [Firefox Add-ons](#) (coming soon)
- [Mac App Store](#) (coming soon)

## For Developers

### Installation

```bash
npm install @windowllm/client
```

```typescript
import { createLLMClient } from '@windowllm/client';

const llm = await createLLMClient();
const session = await llm.requestSession();
```

### TypeScript Types

```bash
npm install @windowllm/types
```

```typescript
import type { LLMSession, CompletionResult } from '@windowllm/types';
```

## Project Structure

```
packages/
├── types/       # @windowllm/types - Shared TypeScript types
├── protocol/    # @windowllm/protocol - postMessage protocol
├── adapters/    # @windowllm/adapters - Provider adapters
├── client/      # @windowllm/client - llm.js library
├── vault/       # @windowllm/vault - Vault application
└── extension/   # @windowllm/extension - Browser extension
```

## Development

```bash
# Clone and install
git clone https://github.com/windowllm/windowllm.git
cd windowllm
npm install

# Build all packages
npm run build

# Run vault in dev mode
npm run dev
```

## Testing

### Prerequisites

Before running E2E tests:

1. **Set up local HTTPS certificates:**

```bash
npm run setup:https
```

This creates self-signed certificates in `.certs/` for `windowllm.localhost` and `test.localhost`.

2. **Install Playwright browsers:**

```bash
npx playwright install chromium firefox
```

This downloads the browser binaries needed for headless testing.

### Running Tests

```bash
# Run all E2E tests (headless Chrome + Firefox)
npm run test:e2e

# Run E2E tests with Playwright UI (interactive debugging)
npm run test:e2e:ui

# Run unit tests for all packages
npm test
```

### Test Architecture

The E2E test infrastructure includes:

- **Vault API** (`packages/vault/src/services/api.ts`): Programmatic API for vault operations, exposed on `window.vaultAPI` in dev mode for testing
- **Mock Adapter** (`packages/adapters/src/mock.ts`): Configurable mock provider for testing without real API calls
- **Test Page** (`tests/pages/`): Standalone page that loads `llm.js` and exercises the WindowLLM API
- **Playwright Tests** (`tests/e2e/`): E2E tests for vault operations and client API

### Test Structure

```
tests/
├── e2e/
│   ├── fixtures/          # Shared test fixtures
│   │   └── vault.fixture.ts
│   ├── vault/             # Vault operation tests
│   │   ├── providers.spec.ts
│   │   ├── permissions.spec.ts
│   │   └── settings.spec.ts
│   └── client/            # Client API tests
│       └── loading.spec.ts
└── pages/                 # Test page served at test.localhost:3001
    ├── index.html
    └── vite.config.ts
```

### Running Individual Test Suites

```bash
# Run only vault tests
npx playwright test tests/e2e/vault/

# Run only client tests
npx playwright test tests/e2e/client/

# Run tests in specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
```

### Development Servers

The E2E tests automatically start two dev servers on dedicated ports (to avoid conflicts with `npm run dev`):

- **Test Vault**: `https://windowllm.localhost:3100` - The vault application for testing
- **Test Page**: `https://test.localhost:3101` - Test page that loads `llm.js`

You can also run these manually:

```bash
# In separate terminals:
npm run dev:test-vault     # Vault at windowllm.localhost:3100
npm run dev:test-page      # Test page at test.localhost:3101
```

## Security Model

WindowLLM's security is built on **defense in depth** using standard web platform primitives:

### Design-Level Mitigations

| Threat | Design Mitigation |
|--------|-------------------|
| **Credential theft** | Same-Origin Policy isolation. Keys stored only in vault origin (`windowllm.org`), inaccessible to any other origin. |
| **XSS key exfiltration** | Even with XSS on client sites, attackers cannot access vault's localStorage—browser-enforced origin isolation. |
| **Man-in-the-middle** | HTTPS required for all origins; postMessage validates `event.origin`. |
| **Unauthorized API usage** | Per-origin capability-based permissions; explicit user consent required. |
| **Cost runaway** | User-configurable rate limits (requests/minute, tokens/day) enforced server-side. |
| **Replay attacks** | Message IDs correlate requests/responses; timeouts prevent stale message acceptance. |
| **Malicious iframe injection** | Vault validates `event.origin` on every message; never trusts payload-claimed origins. |

### What We Don't Protect Against

- **Malicious vault**: Users must trust `windowllm.org` (or self-host)
- **LLM provider access**: Prompts are sent to providers—this is fundamental to how LLMs work
- **All-hosts extensions**: Browser extensions with broad permissions can intercept anything
- **Compromised devices**: Local malware, keyloggers are out of scope

See [SECURITY.md](./SECURITY.md) for the full threat model.

## Rationale

### The Problem

LLM integration on the web is fragmented and user-hostile:

1. **Scattered credentials**: Users enter API keys into dozens of sites, each a potential leak vector
2. **No portability**: Switch from ChatGPT to Claude? Re-configure every site
3. **Zero user control**: Sites choose your model, see your prompts, set your limits
4. **Vendor lock-in**: Chrome's `window.ai` ships Gemini Nano - one vendor, no choice

### Why Not Just Use Backend Proxies?

Sites could proxy LLM calls through their servers, but:
- Users must trust each site with their prompts
- No cross-site consistency or shared configuration
- Each site reinvents rate limiting, model selection, error handling
- Users can't use their own API keys or local models

### Why This Architecture?

**Vault isolation via Same-Origin Policy**: The browser's security model already solves credential isolation. By storing keys in a separate origin (windowllm.org), no website can access them - even with XSS.

**postMessage for cross-origin communication**: Standard web platform primitive, works everywhere, no extension required.

**Progressive enhancement**: Works as iframe (universal), better with extension (local models, offline).

**Provider agnosticism**: Normalize Anthropic, OpenAI, Ollama differences behind one API. Users swap providers; sites don't change code.

### Design Principles

1. **User-first**: Every design decision prioritizes user control over developer convenience
2. **No new trust**: Users already trust their browser; we don't add new trusted parties
3. **Graceful degradation**: Core functionality works everywhere; extensions enhance it
4. **Open standard**: Not a product - a specification anyone can implement

### Interactive-Only Design

The core `window.llm` API requires a DOM context (window with iframe). This means:
- Service workers cannot directly use the API
- Background/scheduled tasks need alternative approaches

**Current solutions:**
1. **Extension mode**: The browser extension's service worker can handle background requests via `chrome.runtime.sendMessage`

**Future extension (requires provider support):**
2. **Scoped credentials**: Providers may support issuing limited, time-bound credentials during interactive sessions. These credentials could be used by service workers, backend servers, or any other context - similar to AWS presigned URLs. This depends entirely on LLM providers offering such functionality.

### Context

Chrome ships Gemini Nano via `window.ai` - vendor lock-in with no user choice. WindowLLM is the open alternative: same DX, user sovereignty, any provider.

## License

MIT

## Contributing

Contributions welcome! See [AGENTS.md](./AGENTS.md) for development guidelines.
