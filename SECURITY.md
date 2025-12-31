# WindowLLM Security Model

This document describes the security architecture and threat model for WindowLLM.

## Overview

WindowLLM provides browser-based LLM access while maintaining strict isolation between:
- **User credentials** (API keys, tokens) - stored only in the vault origin
- **Website code** - runs in the client origin, never sees credentials
- **LLM providers** - receive API calls from vault, authenticated with user's keys

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        User's Browser                                    │
│                                                                          │
│  ┌─────────────────────────┐     ┌─────────────────────────────────┐   │
│  │   Client Origin         │     │   Vault Origin                  │   │
│  │   (example.com)         │     │   (windowllm.org)               │   │
│  │                         │     │                                 │   │
│  │  ┌─────────────────┐   │     │  ┌─────────────────────────┐   │   │
│  │  │  Website Code   │   │     │  │  Vault Application      │   │   │
│  │  │  + llm.js       │◄─────────►│                         │   │   │
│  │  │                 │ postMsg  │  │  ┌─────────────────┐   │   │   │
│  │  └─────────────────┘   │     │  │  │ localStorage    │   │   │   │
│  │                         │     │  │  │ - API keys      │   │   │   │
│  │  NO ACCESS TO:         │     │  │  │ - Permissions   │   │   │   │
│  │  - API keys            │     │  │  │ - Settings      │   │   │   │
│  │  - Other origins' data │     │  │  └─────────────────┘   │   │   │
│  │                         │     │  │                         │   │   │
│  └─────────────────────────┘     │  │  ┌─────────────────┐   │   │   │
│                                   │  │  │ Provider        │───────────►
│                                   │  │  │ Adapters        │   │   │  LLM
│                                   │  │  └─────────────────┘   │   │  APIs
│                                   │  └─────────────────────────┘   │   │
│                                   └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Threat Model

### What We Protect Against

| Threat | Mitigation |
|--------|------------|
| **Malicious website stealing API keys** | Keys stored in vault origin's localStorage, inaccessible to other origins (Same-Origin Policy) |
| **XSS on client site** | Even with XSS, attacker cannot access vault's localStorage or intercept API keys |
| **Man-in-the-middle** | HTTPS required; postMessage validates origins |
| **Malicious iframe injection** | Vault validates `event.origin` on all messages |
| **Unauthorized API usage** | Per-origin permissions, rate limiting, user consent required |
| **Cost runaway** | User-configurable rate limits (requests/minute, tokens/day) |
| **Fingerprinting via model info** | Coarse-grained capability exposure, no exact version strings |

### What We Don't Protect Against

| Threat | Reason |
|--------|--------|
| **Malicious vault** | Users must trust windowllm.org (or self-host). The vault has full access to keys. |
| **LLM provider access to prompts** | Prompts are sent to providers. This is fundamental to how LLMs work. |
| **Browser extension with all-hosts permission** | Such extensions can read any page content, including postMessage traffic |
| **Compromised user device** | Local keyloggers, malware, etc. are out of scope |

### Protecting Against Malicious Vault (SRI Verification)

While users must trust the vault origin, **site developers** can protect their users from hijacked vault implementations using Subresource Integrity (SRI):

```html
<!-- Verify llm.js hasn't been tampered with -->
<script
  src="https://windowllm.org/llm.js"
  integrity="sha384-HASH_OF_KNOWN_GOOD_VERSION"
  crossorigin="anonymous"
></script>
```

**When to use SRI:**
- Production deployments where script integrity is critical
- High-security applications handling sensitive prompts
- Enterprise deployments with compliance requirements

**Generating the hash:**
```bash
# Fetch the script and compute its SHA-384 hash
curl -s https://windowllm.org/llm.js | openssl dgst -sha384 -binary | openssl base64 -A
```

**Limitations:**
- SRI only protects the client library, not the vault iframe content
- For maximum security, consider self-hosting both the client and vault

## Security Boundaries

### Origin Isolation (Primary Defense)

The browser's Same-Origin Policy is our primary security mechanism:

1. **Vault origin** (`windowllm.org`): Stores credentials, makes API calls
2. **Client origins** (any website): Can only communicate via postMessage
3. **No cross-origin access**: Client cannot read vault's localStorage, cookies, or DOM

### postMessage Protocol Security

All communication uses `postMessage` with strict validation:

```typescript
// Vault validates every incoming message:
window.addEventListener('message', (event) => {
  // 1. Validate origin against permission list
  if (!isAuthorizedOrigin(event.origin)) {
    return; // Ignore messages from unauthorized origins
  }

  // 2. Validate message structure
  if (!isValidProtocol(event.data)) {
    return;
  }

  // 3. Check per-origin rate limits
  if (!checkRateLimit(event.origin)) {
    sendRateLimitResponse(event);
    return;
  }

  // 4. Process request...
});
```

### Permission Model

Permissions are granted per-origin and per-capability:

```typescript
interface OriginPermission {
  origin: string;           // "https://example.com"
  capabilities: string[];   // ["chat", "streaming"]
  grantedAt: number;        // Unix timestamp
  expiresAt?: number;       // Optional expiration
  limits?: {
    requestsPerMinute: number;
    tokensPerDay: number;
  };
}
```

Users explicitly grant permissions through a consent UI. Sites cannot:
- Access capabilities they weren't granted
- Exceed rate limits
- Access other origins' permissions or usage data

## Credential Storage

### Storage Location

API keys are stored in the vault origin's `localStorage`:

```typescript
// Stored in windowllm.org's localStorage
{
  "providers": [
    {
      "id": "anthropic-1",
      "type": "anthropic",
      "apiKey": "sk-ant-...",  // Encrypted at rest (future)
      "enabled": true
    }
  ]
}
```

### Key Security Properties

1. **Same-Origin Isolation**: Only `windowllm.org` JavaScript can access this data
2. **No Network Transmission to Clients**: Keys are used server-side (from vault to provider)
3. **HTTPS Required**: Both vault and providers require HTTPS
4. **No Key Echo**: Provider responses are parsed; keys are never included in postMessage

### Implementation Status

The security model described above represents the target architecture. Current implementation status:

| Feature | Status | Notes |
|---------|--------|-------|
| Same-Origin Isolation | ✅ Implemented | Browser-enforced |
| postMessage Origin Validation | ✅ Implemented | All responses use verified origin |
| Capability-Based Permissions | ✅ Implemented | Enforced in handleCompletion/handleEmbedding |
| Session Permission Binding | ✅ Implemented | Capabilities snapshot at session creation |
| Rate Limiting (requests) | ✅ Implemented | Per-origin request counting |
| Rate Limiting (tokens) | ✅ Implemented | Per-origin daily token tracking |
| Encryption at Rest | ✅ Implemented | Web Crypto API (PBKDF2 + AES-256-GCM) |

### Future Enhancements

- **Hardware key storage**: Integration with WebAuthn/platform authenticators
- **Key rotation reminders**: Prompt users to rotate keys periodically

## Vault Locking

The vault uses a lock/unlock mechanism to protect API keys even when the browser is left unattended.

### Lock States

| State | Description |
|-------|-------------|
| **Locked** | Master key cleared from memory; API keys inaccessible |
| **Unlocked** | Master key available; can decrypt and use API keys |

### Unlock Persistence

The derived CryptoKey is stored in **IndexedDB** which:
- Survives page reloads within the same browser session
- Is cleared when the browser is closed (via sessionStorage marker)
- Is immediately cleared on explicit lock

### Auto-Lock Timeout

The vault automatically locks after **30 minutes of inactivity**:

1. Every API operation (handshake, completion, embedding, models list) resets the timer
2. The timeout is checked:
   - Before each operation
   - Periodically via background interval (every 60 seconds)
3. When timeout is exceeded, the master key is cleared from both memory and IndexedDB

### Manual Lock

Users can lock the vault at any time via the lock button in the vault UI. This immediately:
1. Clears the CryptoKey from memory
2. Clears the CryptoKey from IndexedDB
3. Clears the session activity marker
4. Returns to the unlock screen

### Client Popup Flow

When a client site requests access to a locked vault:
1. Vault returns `VAULT_LOCKED` response with unlock URL
2. Client opens a popup window to the unlock page
3. User enters passphrase in popup
4. On success, popup sends `vault_unlocked` message to opener
5. Client retries the original request

## Rate Limiting

### Default Limits

```typescript
const DEFAULT_LIMITS = {
  requestsPerMinute: 60,
  tokensPerMinute: 100000,
  tokensPerDay: 1000000,
};
```

### Per-Origin Tracking

Each origin has independent limits:
- Requests are counted in sliding windows
- Token usage is tracked per day
- Exceeding limits returns `RATE_LIMITED` error with `retryAfter`

### User Control

Users can configure:
- Global limits (apply to all sites)
- Per-origin limits (override for specific sites)
- Spending caps (cost-based limits)

## Content Security

### Request Validation

All requests are validated before forwarding to providers:
- Message structure matches expected schema
- No injection of unexpected parameters
- Token counts within configured limits

### Response Handling

Provider responses are parsed, not passed through raw:
- Only expected fields are extracted
- Error messages are sanitized
- No credential leakage in error responses

## Browser Extension Mode

When using the browser extension instead of iframe:

### Additional Capabilities
- Direct API calls (no CORS restrictions)
- Local model access (Ollama, LM Studio)
- Works offline (with local models)

### Security Properties
- Same permission model as iframe
- Credentials stored in extension storage (encrypted)
- Content script isolation from page scripts

### Extension Permissions
```json
{
  "permissions": ["storage"],
  "host_permissions": ["<all_urls>"]
}
```

The `<all_urls>` permission is required to inject `window.llm` into pages, not to read page content.

## Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. Email security@windowllm.org with details
3. Include steps to reproduce
4. Allow 90 days for fix before public disclosure

## Security Checklist for Self-Hosters

If self-hosting the vault:

- [ ] Serve vault over HTTPS only
- [ ] Set appropriate CSP headers
- [ ] Enable HSTS
- [ ] Review and configure CORS headers
- [ ] Use secure cookies if implementing server-side features
- [ ] Regular security updates for dependencies
- [ ] Consider additional authentication for vault access

## Comparison with Alternatives

| Approach | Key Location | Cross-Site | User Control |
|----------|-------------|------------|--------------|
| **WindowLLM (iframe)** | Vault origin | Yes (postMessage) | Full |
| **WindowLLM (extension)** | Extension storage | Yes | Full |
| **Per-site API keys** | Each site | No | None |
| **Backend proxy** | Server | No | None |
| **window.ai (Chrome)** | Browser | Yes | Limited |

## References

- [Same-Origin Policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy)
- [postMessage Security](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns)
- [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
