#!/bin/bash
# Headless WebKit test of the WindowLLM Safari extension via WKWebExtensionController.
# Runs the shared API contract and extension-specific checks through the real
# extension inside Apple's WebKit engine — no Safari UI, enable toggle, or TCC.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
EXT_DIR="$ROOT/packages/extension/dist"
PORT="${PORT:-3199}"
TIMEOUT="${TIMEOUT:-25}"
BIN="$DIR/.build/host"

# 1. Ensure the extension is built as a loadable folder (Safari manifest).
if [ ! -f "$EXT_DIR/manifest.json" ] || [ ! -f "$EXT_DIR/content.js" ]; then
  echo "[run] building extension dist (safari manifest)…"
  ( cd "$ROOT/packages/extension" \
    && WINDOWLLM_EXTENSION_E2E=1 npm run build:with-ui \
    && cp manifest.safari.json dist/manifest.json \
    && cp -r icons dist/ )
fi

# 2. Compile the Swift host tool into a minimal .app bundle.
#    WKWebView's WebContent process refuses to launch from a bare CLI binary
#    (no CFBundleIdentifier) — navigation silently never starts — so we wrap it.
APP="$DIR/.build/WindowLLMExtTest.app"
BIN="$APP/Contents/MacOS/host"
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>org.windowllm.wkwebext-test</string>
  <key>CFBundleName</key><string>WindowLLMExtTest</string>
  <key>CFBundleExecutable</key><string>host</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>15.4</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict>
</plist>
PLIST
if [ ! -x "$BIN" ] || [ "$DIR/host.swift" -nt "$BIN" ]; then
  echo "[run] compiling host.swift…"
  # WKWebExtension* requires a 15.4+ deployment target. swiftc defaults to the
  # host OS version, which on some CI runners (macos-15) is below 15.4 and fails
  # the availability check, so pin it explicitly. The runner OS is >= 15.4.
  swiftc -swift-version 5 -O -target "$(uname -m)-apple-macos15.4" \
    -o "$BIN" "$DIR/host.swift" -framework WebKit -framework AppKit
  codesign --force --sign - "$APP" 2>/dev/null || true
fi

# 3. Serve the shared contract page and deterministic Ollama-compatible API.
PORT="$PORT" node "$ROOT/tests/extension/server.mjs" >"$DIR/.build/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
until curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do sleep 0.2; done

# 4. Run the host test.
echo "[run] loading extension into WKWebExtensionController and running contracts…"
set +e
OUT="$("$BIN" "$EXT_DIR" "http://127.0.0.1:$PORT/?runner=safari" "$TIMEOUT")"
CODE=$?
set -e
echo "[result] $OUT"
if [ "$CODE" -eq 0 ]; then
  echo "[run] PASS — shared API and extension runtime contracts passed in WebKit"
else
  echo "[run] FAIL (exit $CODE)"
fi
exit $CODE
