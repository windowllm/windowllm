# WindowLLM API Design

This document describes the design of the `window.llm` API, a browser-based interface for accessing Large Language Models through user-configured providers.

## Design Principles

1. **User Sovereignty** - Users control their AI configuration, not websites
2. **Provider Agnosticism** - Same API works for all LLM providers
3. **Capability-Based** - Sites request capabilities, not specific models
4. **Web Platform Alignment** - Follows established patterns (Permissions API, Streams)
5. **Progressive Enhancement** - Works without extension, better with it

## API Surface

### Entry Point

```typescript
interface WindowLLM {
  readonly version: string;
  readonly available: boolean;
  readonly provider: 'extension' | 'iframe' | 'native';

  readonly permissions: LLMPermissions;
  readonly capabilities: LLMCapabilities;
  readonly models: LLMModelRegistry;

  requestSession(options?: SessionOptions): Promise<LLMSession>;
  requestEmbedding(options?: EmbeddingOptions): Promise<EmbeddingSession>;
}
```

### Model Discovery

Sites can discover available models and their capabilities:

```typescript
// List all models
const models = await window.llm.models.list();

// Get a specific model
const model = await window.llm.models.get('anthropic/claude-3-opus');

// Find models by capability
const visionModels = await window.llm.models.match({
  capabilities: { required: ['vision', 'tools'] },
  limits: { minContextWindow: 100000 },
  preference: 'quality'
});
```

### Session Management

Chat interactions use a session-based model:

```typescript
const session = await window.llm.requestSession({
  model: 'anthropic/claude-3-opus',
  systemPrompt: 'You are a helpful assistant.',
  tools: [weatherTool],
});

// Single completion
const result = await session.complete('What is 2+2?');

// Streaming
for await (const chunk of session.stream('Write a story')) {
  output.textContent = chunk.accumulated;
}

// Multi-turn (context preserved)
await session.complete('Remember my name is Alice');
await session.complete('What is my name?');

// Branch conversation
const branch = await session.clone();

// Clean up
session.destroy();
```

### Streaming

Uses `AsyncIterable` for ergonomic streaming:

```typescript
for await (const chunk of session.stream(input)) {
  switch (chunk.type) {
    case 'text':
      output.textContent = chunk.accumulated;
      break;
    case 'tool_call':
      if (chunk.complete) {
        await handleToolCall(chunk.toolCall);
      }
      break;
    case 'done':
      console.log('Tokens:', chunk.result.usage.totalTokens);
      break;
  }
}
```

### Tool Calling

Follows a standard tool definition format:

```typescript
const weatherTool = {
  name: 'get_weather',
  description: 'Get the current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
      unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
    },
    required: ['location']
  }
};

const session = await window.llm.requestSession({ tools: [weatherTool] });
const result = await session.complete('Weather in Tokyo?');

if (result.finishReason === 'tool_use') {
  const toolResult = await executeWeather(result.toolCalls[0]);
  await session.complete([{
    role: 'user',
    toolResults: [{
      toolCallId: result.toolCalls[0].id,
      content: toolResult,
      success: true
    }]
  }]);
}
```

### Embeddings

```typescript
const embedder = await window.llm.requestEmbedding({
  dimensions: 1536
});

const single = await embedder.embed('Hello world');
const batch = await embedder.embedBatch(['Hello', 'World']);

// Returns Float32Array for efficiency
console.log(single.vector.length); // 1536
```

### Permissions

Follows the Web Permissions API pattern:

```typescript
// Check without prompting
const status = await window.llm.permissions.query({ name: 'chat' });

if (status.state === 'prompt') {
  // Will show consent dialog
  await window.llm.permissions.request({ name: 'chat' });
}

// Listen for changes
status.onchange = () => {
  if (status.state === 'denied') {
    showNoAccessMessage();
  }
};
```

## Error Handling

All errors use the `LLMError` class:

```typescript
try {
  const session = await window.llm.requestSession();
} catch (error) {
  if (error instanceof LLMError) {
    switch (error.code) {
      case 'PERMISSION_DENIED':
        showPermissionDeniedUI();
        break;
      case 'RATE_LIMITED':
        await delay(error.retryAfter);
        retry();
        break;
      case 'NOT_CONFIGURED':
        showSetupInstructions();
        break;
    }
  }
}
```

### Error Codes

| Code | Meaning | Retryable |
|------|---------|-----------|
| PERMISSION_DENIED | User denied permission | No |
| NOT_CONFIGURED | No provider configured | No |
| CAPABILITY_UNAVAILABLE | Requested capability not available | No |
| MODEL_NOT_FOUND | Specified model doesn't exist | No |
| RATE_LIMITED | Provider rate limit hit | Yes |
| QUOTA_EXCEEDED | Usage quota exceeded | No |
| CONTEXT_TOO_LONG | Input exceeds context window | No |
| CONTENT_FILTERED | Content policy violation | No |
| PROVIDER_ERROR | Upstream provider error | Yes |
| NETWORK_ERROR | Network issue | Yes |
| TIMEOUT | Request timed out | Yes |
| CANCELLED | Request was cancelled | No |

## Provider Normalization

The API normalizes differences between providers:

| Feature | Anthropic | OpenAI | Ollama |
|---------|-----------|--------|--------|
| System message | Separate param | In messages | In messages |
| Streaming | SSE content_block_delta | SSE delta | JSON lines |
| Tool calls | tool_use blocks | tool_calls array | OpenAI-compat |
| Vision | Base64 in content | URL or base64 | Varies |

Sites write against one API; adapters handle translation.

## Security Model

### Key Isolation

API keys never leave the vault origin:

```
Site (example.com)     Vault (windowllm.org)     Provider
       │                        │                     │
       │ ── postMessage ──────► │                     │
       │    "complete this"     │ ── API call ───────►│
       │                        │    (with key)       │
       │ ◄── postMessage ────── │ ◄── response ───────│
       │    "here's result"     │                     │
```

### Permission Model

- Per-site permissions (not all-or-nothing)
- Capability-based grants
- User can revoke at any time
- Sites cannot see other sites' permissions

### Rate Limiting

- Per-site limits enforced in vault
- Token usage tracking
- User-configurable limits

## Versioning

### API Version

```typescript
window.llm.version // "1.0.0"
```

Follows semver:
- **Major**: Breaking changes
- **Minor**: New capabilities (backward compatible)
- **Patch**: Bug fixes

### Capability Evolution

New features are exposed as capabilities:

```typescript
if (window.llm.capabilities.has('audio-input')) {
  // Use new audio feature
}
```

Old sites continue working without modification.

## Implementation Hierarchy

1. **Browser Extension** - Best experience, full capabilities
2. **FedCM** - Chrome/Safari, browser-integrated consent
3. **Storage Access API** - Firefox/Safari, popup flow
4. **Direct iframe** - Development/permissive browsers

## References

- [Chrome Built-in AI](https://developer.chrome.com/docs/ai/built-in)
- [W3C Prompt API Proposal](https://github.com/webmachinelearning/prompt-api)
- [Web Permissions API](https://developer.mozilla.org/en-US/docs/Web/API/Permissions_API)
