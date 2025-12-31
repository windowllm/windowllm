# WindowLLM Development Guidelines

## Project Overview

WindowLLM is a universal browser LLM API that gives users sovereignty over their AI. The project provides:

1. **`window.llm` API** - A standardized browser API for LLM access
2. **Vault** - User's configuration hub at windowllm.org
3. **Browser Extension** - Optional extension for enhanced capabilities
4. **Provider Adapters** - Normalize differences between LLM providers

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
│                   Vault (windowllm.org)                      │
│                                                              │
│  • User's API keys (never leave this origin)                │
│  • Provider configuration                                    │
│  • Per-site permissions                                      │
│  • Rate limiting                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                         API calls
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              LLM Providers                                   │
│  Anthropic | OpenAI | Ollama | LM Studio | OpenRouter       │
└─────────────────────────────────────────────────────────────┘
```

## Package Structure

```
packages/
├── types/       # @windowllm/types - Shared TypeScript types
├── protocol/    # @windowllm/protocol - postMessage protocol
├── adapters/    # @windowllm/adapters - Provider adapters
├── client/      # @windowllm/client - llm.js library
├── vault/       # @windowllm/vault - React vault application
└── extension/   # @windowllm/extension - Browser extension
```

### Dependency Graph

```
types ────────────────────────────────────────┐
  │                                           │
  ├──► protocol ─────────────────────────┐    │
  │        │                             │    │
  ├──► adapters ──────────────────┐      │    │
  │        │                      │      │    │
  └──► client ◄───────────────────┼──────┘    │
           │                      │           │
           │    ┌─────────────────┴───────────┘
           │    │
           ▼    ▼
        vault  extension
```

## Development Commands

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Run vault in development mode
npm run dev

# Run tests
npm test

# Type check all packages
npm run typecheck
```

## Key Design Principles

### 1. User Sovereignty
- API keys NEVER leave the vault origin
- Users control which sites can access their LLM
- Per-site permission model with granular capabilities

### 2. Provider Agnosticism
- Same `window.llm` API works for all providers
- Sites request capabilities, not specific models
- Adapters normalize provider differences

### 3. Progressive Enhancement
- Works without extension via iframe + postMessage
- Extension provides enhanced capabilities (local models, no CORS)
- Graceful degradation when features unavailable

### 4. Web Platform Alignment
- Follows Web Permissions API patterns
- AsyncIterable for streaming (not callbacks)
- Standard error types with retry hints

## Security Considerations

### postMessage Security
- Always validate `event.origin` (browser-enforced, cannot be spoofed)
- Use message IDs for request/response correlation
- Never trust origin claims in message payload

### Key Protection
- Keys stored encrypted in localStorage
- Keys never sent over postMessage
- All API calls made from vault origin

### Permission Model
- Explicit user consent per site
- Capability-based (not all-or-nothing)
- Revocable at any time

## Testing Guidelines

### Unit Tests
- Test adapters with mock responses
- Test protocol message encoding/decoding
- Test permission logic

### Integration Tests
- Test postMessage flow between client and vault
- Test storage access flows (FedCM, SAA)
- Test extension detection

### E2E Tests
- Test full flow from site to LLM response
- Test permission consent flows
- Test streaming responses

## Code Style

- TypeScript strict mode enabled
- Use `readonly` for immutable properties
- Prefer `interface` over `type` for object shapes
- Use `AsyncIterable` for streaming, not callbacks
- Document public APIs with JSDoc

## Common Tasks

### Adding a New Provider

1. Create adapter in `packages/adapters/src/providers/`
2. Implement `ProviderAdapter` interface
3. Add provider to registry
4. Add tests with mock responses
5. Update vault UI to support configuration

### Adding a New Capability

1. Add to `ModelCapabilities` interface in types
2. Update adapters to report capability
3. Add capability check in session options
4. Update vault permission UI

### Modifying the Protocol

1. Update types in `packages/protocol/`
2. Update client message handling
3. Update vault message handling
4. Ensure backwards compatibility or bump version

## Useful References

- [Plan File](/.claude/plans/delightful-spinning-iverson.md) - Implementation plan
- [API Design](./docs/api-design.md) - Full API specification
- [Bikeshed Spec](./spec/index.bs) - W3C-style specification

## Storage Access Flows

### FedCM Flow (Chrome/Safari)
1. Site loads llm.js
2. llm.js requests FedCM credential
3. Browser shows "Sign in with WindowLLM"
4. User consents, storage access granted
5. Vault iframe can access localStorage

### Storage Access API Flow (Firefox/Safari)
1. Site loads llm.js
2. llm.js shows "Connect to WindowLLM" button
3. User clicks, popup opens to windowllm.org
4. User grants permission in popup
5. Storage access granted via SAA

### Extension Flow
1. Extension injects `window.llm` at `document_start`
2. llm.js detects existing implementation
3. llm.js defers to extension
4. No iframe or storage access needed
