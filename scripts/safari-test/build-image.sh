#!/bin/bash
# Build Safari VM image for testing
#
# Uses tart exec for all VM configuration - no SSH, no HTTP during build.
# The harness is installed and added to login items so it auto-starts on boot.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VM_NAME="windowllm-safari-test"
HASH_FILE="$SCRIPT_DIR/.image-hash"
SHARED_DIR="$SCRIPT_DIR/.shared"

# Use latest macOS (Tahoe) base image with Homebrew pre-installed
BASE_IMAGE="ghcr.io/cirruslabs/macos-tahoe-base:latest"

# Parse arguments
SHOW_DISPLAY=false
FORCE_BOOTSTRAP=false
for arg in "$@"; do
    case $arg in
        --ui)
            SHOW_DISPLAY=true
            ;;
        --bootstrap)
            FORCE_BOOTSTRAP=true
            ;;
    esac
done

echo "=========================================="
echo "  WindowLLM Safari VM Image Builder"
echo "=========================================="

# Check prerequisites
if ! command -v tart &> /dev/null; then
    echo "Error: Tart is not installed. Install with: brew install cirruslabs/cli/tart"
    exit 1
fi

# Cleanup function
cleanup() {
    if [ -n "$VM_PID" ]; then
        echo "Stopping VM..."
        kill $VM_PID 2>/dev/null || true
        wait $VM_PID 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Stop any running VM with the same name
echo ""
echo "Checking for running VM..."
if tart list 2>/dev/null | grep -q "$VM_NAME.*running"; then
    echo "Stopping running VM '$VM_NAME'..."
    tart stop "$VM_NAME" 2>/dev/null || true
    sleep 5
fi

# Step 1: Build Safari extension
echo ""
echo "Step 1: Building Safari extension..."
cd "$PROJECT_ROOT"
npm run build:extension:safari

EXTENSION_APP="$PROJECT_ROOT/packages/extension/safari-project/build/WindowLLM.app"
if [ ! -d "$EXTENSION_APP" ]; then
    echo "Error: Safari extension not built. Expected: $EXTENSION_APP"
    exit 1
fi
echo "Extension built: $EXTENSION_APP"

# Step 2: Prepare shared directory
echo ""
echo "Step 2: Preparing shared directory..."
sudo rm -rf "$SHARED_DIR" 2>/dev/null || rm -rf "$SHARED_DIR" 2>/dev/null || true
mkdir -p "$SHARED_DIR"

# Copy harness files
cp -r "$SCRIPT_DIR/harness" "$SHARED_DIR/harness"
cp "$SCRIPT_DIR/enable-extension.applescript" "$SHARED_DIR/harness/"

# Copy extension
cp -r "$EXTENSION_APP" "$SHARED_DIR/WindowLLM.app"

# Copy the mkcert root CA so the VM can trust the local HTTPS dev servers.
CA_ROOT="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem"
if [ -f "$CA_ROOT" ]; then
    cp "$CA_ROOT" "$SHARED_DIR/rootCA.pem"
    echo "Copied mkcert root CA into shared dir"
else
    echo "Warning: mkcert root CA not found ($CA_ROOT). Run 'npm run setup:https' first."
fi

echo "Shared directory prepared: $SHARED_DIR"

# Step 3: Create or update VM
echo ""
echo "Step 3: Setting up VM..."
if tart list 2>/dev/null | grep -q "^local.*$VM_NAME"; then
    if [ "$FORCE_BOOTSTRAP" = true ]; then
        echo "Force bootstrap requested. Deleting existing VM..."
        tart delete "$VM_NAME" || true
        echo "Cloning from $BASE_IMAGE..."
        tart clone "$BASE_IMAGE" "$VM_NAME"
    else
        echo "VM '$VM_NAME' already exists. Using existing image."
    fi
else
    echo "VM not found. Cloning from $BASE_IMAGE..."
    tart clone "$BASE_IMAGE" "$VM_NAME"
fi

# Step 4: Start VM with shared directory
echo ""
echo "Step 4: Starting VM..."
if [ "$SHOW_DISPLAY" = true ]; then
    echo "(UI mode: VM display will be visible)"
    tart run "$VM_NAME" --dir "$SHARED_DIR" &
else
    tart run "$VM_NAME" --dir "$SHARED_DIR" --no-graphics &
fi
VM_PID=$!

# Wait for VM to boot and tart exec to be available
echo "Waiting for VM to boot..."
for i in {1..60}; do
    if tart exec "$VM_NAME" echo "ready" 2>/dev/null | grep -q "ready"; then
        echo "VM ready for commands."
        break
    fi
    sleep 2
    echo -n "."
done
echo ""

# Get VM IP for later verification
VM_IP=$(tart ip "$VM_NAME" 2>/dev/null || echo "")
echo "VM IP: $VM_IP"

# Step 5: Ensure Node.js is installed
echo ""
echo "Step 5: Checking Node.js..."
tart exec "$VM_NAME" bash -c '
    if ! command -v node &> /dev/null; then
        echo "Installing Node.js via Homebrew..."
        brew install node
    else
        echo "Node.js already installed: $(node --version)"
    fi
    echo "Node path: $(which node)"
'

# Step 6: Install harness to home directory
echo ""
echo "Step 6: Installing harness..."
tart exec "$VM_NAME" bash -c "
    rm -rf ~/safari-test-harness
    cp -r '/Volumes/My Shared Files/harness' ~/safari-test-harness
    echo 'Harness installed to ~/safari-test-harness'
"

# Step 7: Add harness to login items via LaunchAgent
echo ""
echo "Step 7: Adding harness to login items..."
tart exec "$VM_NAME" bash -c '
    NODE_PATH=$(which node)
    mkdir -p ~/Library/LaunchAgents
    cat > ~/Library/LaunchAgents/org.windowllm.safari-test-harness.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>org.windowllm.safari-test-harness</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${HOME}/safari-test-harness/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${HOME}/safari-test-harness</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/safari-harness.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/safari-harness.err</string>
</dict>
</plist>
EOF
    echo "LaunchAgent created with node at: $NODE_PATH"
'

# Step 7b: Trust the local mkcert CA so Safari accepts the dev-server HTTPS certs
echo ""
echo "Step 7b: Trusting local CA..."
tart exec "$VM_NAME" sudo bash -c '
    CA="/Volumes/My Shared Files/rootCA.pem"
    if [ -f "$CA" ]; then
        security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA" \
            && echo "Local CA trusted in System keychain" \
            || echo "Warning: failed to trust local CA"
    else
        echo "Warning: rootCA.pem not present in shared mount"
    fi
'

# Step 8: Configure Safari
echo ""
echo "Step 8: Configuring Safari..."
tart exec "$VM_NAME" bash -c '
    defaults write com.apple.Safari IncludeDevelopMenu -bool true
    defaults write com.apple.Safari WebKitDeveloperExtrasEnabledPreferenceKey -bool true
    defaults write com.apple.Safari "WebKitPreferences.developerExtrasEnabled" -bool true
    defaults write com.apple.Safari DeveloperAllowUnsignedExtensions -bool true
    # Required for osascript `do JavaScript ... in document` to work.
    defaults write com.apple.Safari AllowJavaScriptFromAppleEvents -bool true
    defaults write com.apple.Safari SuppressSearchSuggestions -bool true
    defaults write com.apple.Safari UniversalSearchEnabled -bool false
    echo "Safari configured"
'

# Step 9: Install extension
echo ""
echo "Step 9: Installing extension..."
tart exec "$VM_NAME" bash -c "
    rm -rf ~/WindowLLM.app
    cp -r '/Volumes/My Shared Files/WindowLLM.app' ~/WindowLLM.app
    echo 'Extension copied to ~/WindowLLM.app'
"

# Launch the extension app to register with Safari
echo "Registering extension with Safari..."
tart exec "$VM_NAME" bash -c '
    open ~/WindowLLM.app
    sleep 5
    echo "Extension app launched"
'

# Enable the extension in Safari preferences
echo "Enabling extension in Safari..."
tart exec "$VM_NAME" bash -c '
    # This will trigger automation permission dialog on first run
    # User must click "OK" when running with --ui
    osascript ~/safari-test-harness/enable-extension.applescript 2>&1 || true
    sleep 2
    # Close Safari
    osascript -e "tell application \"Safari\" to quit" 2>/dev/null || true
    sleep 1
    echo "Extension enabled"
'

# Step 10: Start harness to verify it works
echo ""
echo "Step 10: Verifying harness..."
tart exec "$VM_NAME" bash -c "nohup node ~/safari-test-harness/server.js > /tmp/harness-test.log 2>&1 &"
sleep 3

if curl -s "http://$VM_IP:3200/health" 2>/dev/null | grep -q "ok"; then
    echo "Harness verified working!"
else
    echo "Warning: Could not verify harness (may still work on next boot)"
fi

# Step 11: Stop VM
echo ""
echo "Step 11: Stopping VM..."
trap - EXIT
kill $VM_PID 2>/dev/null || true
wait $VM_PID 2>/dev/null || true
sleep 5

# Step 12: Save hash
echo ""
echo "Step 12: Saving build hash..."
# NOTE: must match check-rebuild.sh exactly (same paths + patterns), or every
# run is seen as "rebuild-needed".
find "$PROJECT_ROOT/packages/vault/src" "$PROJECT_ROOT/packages/extension/src" \
    "$PROJECT_ROOT/packages/extension/manifest.safari.json" \
    -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.json" \) 2>/dev/null | \
    sort | xargs shasum 2>/dev/null | shasum > "$HASH_FILE"

echo ""
echo "=========================================="
echo "  VM image '$VM_NAME' built successfully!"
echo "=========================================="
echo ""
echo "To run Safari tests:  npm run test:safari"
echo "To rebuild manually:  npm run test:safari:rebuild"
