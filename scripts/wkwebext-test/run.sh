#!/bin/bash
# Headless WebKit test of the WindowLLM Safari extension via WKWebExtensionController.
# Proves the real extension code injects window.llm (provider === "extension") inside
# Apple's WebKit engine — no Safari, no enable toggle, no signing, no TCC.
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
    && npm run build:with-ui \
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
  swiftc -swift-version 5 -O -o "$BIN" "$DIR/host.swift" -framework WebKit -framework AppKit
  codesign --force --sign - "$APP" 2>/dev/null || true
fi

# 3. Serve the test page over http (content_scripts match http://*/*).
python3 -m http.server "$PORT" --directory "$DIR/page" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
until curl -s "http://localhost:$PORT/" >/dev/null 2>&1; do sleep 0.2; done

# 4. Run the host test.
echo "[run] loading extension into WKWebExtensionController and probing window.llm…"
set +e
OUT="$("$BIN" "$EXT_DIR" "http://localhost:$PORT/" "$TIMEOUT")"
CODE=$?
set -e
echo "[result] $OUT"
if [ "$CODE" -eq 0 ]; then
  echo "[run] PASS — window.llm.provider === \"extension\" (real extension code injected in WebKit)"
else
  echo "[run] FAIL (exit $CODE)"
fi
exit $CODE
