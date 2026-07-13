# Headless WebKit extension test (`wkwebext-test`)

Runs the shared WindowLLM API contract and extension-runtime checks through the
**real Safari extension code** inside Apple's WebKit WebExtension engine, the same
engine Safari uses, with **no Safari UI, enable toggle, signing, TCC, or VM**.

```bash
npm run test:extension:webkit      # from repo root (builds dist, then runs)
# or, if dist/ is already built:
bash scripts/wkwebext-test/run.sh
```

Exit code `0` means all shared and extension-specific browser checks passed.

## How it works

`host.swift` compiles to a tiny `.app` and uses the public `WKWebExtension` /
`WKWebExtensionContext` / `WKWebExtensionController` API (WebKit 18.4+ / macOS 26):

1. Loads `packages/extension/dist/` (the built Safari manifest folder) as a
   `WKWebExtension`.
2. Grants `<all_urls>` + `storage`, loads the context into a controller.
3. Starts a deterministic Ollama-compatible HTTP fixture and attaches the controller
   to an offscreen `WKWebView` (a normal browsing tab).
4. Runs the same API contract used by Chrome and Firefox: injection, permissions,
   models, sessions, completion, streaming, and extension background routing.
5. Polls the structured browser result via `evaluateJavaScript` and fails if any
   contract check failed.

This runs the actual `content.js` → inlined `inject.js` → `window.llm` path, plus
loads the background service worker. It is the same WebExtension runtime Safari
embeds, so it is high-fidelity for the extension's **web-facing behavior**.

## What it does and does NOT cover — vs. the (retired) VM harness

This tool replaced a tart-based macOS-VM Safari harness that was removed because it
could never enable the unsigned extension, so it only ever exercised the iframe
fallback. For the record, here is how they compared:

| | `wkwebext-test` (this) | retired tart VM harness |
|---|---|---|
| Tests the **extension** (`window.llm`, content/inject/background) | ✅ real WebKit extension engine | ❌ only exercised the **iframe fallback** (`provider: "iframe"`) |
| Speed | ~1s, headless | minutes; boots a macOS VM |
| Requirements | macOS + Xcode CLT | Apple Silicon + tart + a built VM image |
| Fragility | low (one Swift file) | high (networking, TLS, TCC, AppleScript, Safari UI) |
| Safari `.app`/`.appex` packaging + signing | ❌ loads `dist/` directly | ⚠️ builds it, but can't enable it (unsigned) |
| Real Safari browser chrome / UI enable flow | ❌ | ❌ (unsigned extensions can't be auto-enabled) |

**Bottom line:** for verifying the extension's behavior, this replaces the VM and
is strictly better — the VM never actually tested the extension (it fell back to
the iframe path). The only thing genuinely outside this tool's scope is Safari's
`.appex` packaging/signing shell, which is a build-time concern better checked by
`npm run build:extension:safari` than by a whole VM.

It performs a complete provider round-trip against the local deterministic fixture,
not an external live LLM. Safari browser chrome, packaging/signing, and the enable
flow remain outside this harness.
