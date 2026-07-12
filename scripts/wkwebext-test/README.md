# Headless WebKit extension test (`wkwebext-test`)

Proves the **real WindowLLM Safari extension code** injects `window.llm`
(`provider === "extension"`) inside Apple's WebKit WebExtension engine — the same
engine Safari uses to run extensions — with **no Safari, no enable toggle, no
signing, no TCC, no VM**.

```bash
npm run test:extension:webkit      # from repo root (builds dist, then runs)
# or, if dist/ is already built:
bash scripts/wkwebext-test/run.sh
```

Exit code `0` and `provider === "extension"` == pass.

## How it works

`host.swift` compiles to a tiny `.app` and uses the public `WKWebExtension` /
`WKWebExtensionContext` / `WKWebExtensionController` API (WebKit 18.4+ / macOS 26):

1. Loads `packages/extension/dist/` (the built Safari manifest folder) as a
   `WKWebExtension`.
2. Grants `<all_urls>` + `storage`, loads the context into a controller.
3. Attaches the controller to an offscreen `WKWebView` (a normal browsing tab)
   and navigates to a local test page over http.
4. Polls `window.llm` via `evaluateJavaScript` and asserts `provider === "extension"`.

This runs the actual `content.js` → inlined `inject.js` → `window.llm` path, plus
loads the background service worker. It is the same WebExtension runtime Safari
embeds, so it is high-fidelity for the extension's **web-facing behavior**.

## What it does and does NOT cover — vs. the VM harness

| | `wkwebext-test` (this) | `scripts/safari-test` (tart VM) |
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

It does **not** perform a live LLM round-trip (that needs a configured provider +
network); it verifies injection and the `window.llm` API surface.
