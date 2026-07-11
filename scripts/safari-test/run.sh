#!/bin/bash
# Run Safari E2E tests (SSH-free, HTTP-based)
#
# This script:
# 1. Checks if VM image needs rebuilding
# 2. Starts dev servers (vault + test page)
# 3. Starts the Safari VM
# 4. Runs tests via HTTP harness
# 5. Reports results

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VM_NAME="windowllm-safari-test"
HARNESS_PORT=3200
SHARED_DIR="$SCRIPT_DIR/.shared"

# Parse arguments.
# NOTE: the VM reaches the host via a .test host (mapped in the VM's /etc/hosts
# below). macOS pins *.localhost to loopback and ignores /etc/hosts for it, so
# .localhost cannot be used from the VM.
SHOW_DISPLAY=false
TEST_URL="https://page.test:3101"
for arg in "$@"; do
    case $arg in
        --ui)
            SHOW_DISPLAY=true
            ;;
        *)
            TEST_URL="$arg"
            ;;
    esac
done

# Cleanup function
cleanup() {
    echo ""
    echo "Cleaning up..."
    [ -n "$VM_PID" ] && kill $VM_PID 2>/dev/null || true
    [ -n "$VAULT_PID" ] && kill $VAULT_PID 2>/dev/null || true
    [ -n "$TEST_PID" ] && kill $TEST_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "=========================================="
echo "      WindowLLM Safari Test Runner"
echo "      (SSH-free, HTTP-based)"
echo "=========================================="

# Check prerequisites
if ! command -v tart &> /dev/null; then
    echo "Error: Tart is not installed. Install with: brew install cirruslabs/cli/tart"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Warning: jq not installed. Install with: brew install jq"
    echo "Results will be shown as raw JSON."
fi

# Stop any running VM with the same name first
echo ""
echo "Checking for running VM..."
if tart list 2>/dev/null | grep -q "$VM_NAME.*running"; then
    echo "Stopping existing VM '$VM_NAME'..."
    tart stop "$VM_NAME" 2>/dev/null || true
    sleep 5
fi

# Step 1: Check if rebuild needed
echo ""
echo "Step 1: Checking if rebuild needed..."
REBUILD=$("$SCRIPT_DIR/check-rebuild.sh")
if [ "$REBUILD" = "rebuild-needed" ]; then
    echo "Source files changed. Rebuilding VM image..."
    "$SCRIPT_DIR/build-image.sh"
elif ! tart list 2>/dev/null | grep -q "$VM_NAME"; then
    echo "VM image not found. Building..."
    "$SCRIPT_DIR/build-image.sh"
else
    echo "VM image is up to date."
fi

# Step 2: Start dev servers
echo ""
echo "Step 2: Starting dev servers..."
cd "$PROJECT_ROOT"

# Bind dev servers to all interfaces so the VM can reach them via the host
# gateway (they otherwise bind only to the host loopback hostname).
export VITE_HOST_ALL=1

npm run dev:test-vault > /tmp/vault-server.log 2>&1 &
VAULT_PID=$!
echo "Vault server starting (PID: $VAULT_PID)..."

npm run dev:test-page > /tmp/test-page.log 2>&1 &
TEST_PID=$!
echo "Test page server starting (PID: $TEST_PID)..."

# Wait for servers to be ready
echo "Waiting for servers..."
for i in {1..30}; do
    if curl -sk https://windowllm.localhost:3100 > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

for i in {1..30}; do
    if curl -sk https://test.localhost:3101 > /dev/null 2>&1; then
        break
    fi
    sleep 1
done
echo "Dev servers ready."

# Step 3: Start VM
echo ""
echo "Step 3: Starting Safari VM..."

# Prepare shared directory with latest extension (in case it was rebuilt)
mkdir -p "$SHARED_DIR"
EXTENSION_APP="$PROJECT_ROOT/packages/extension/safari-project/build/WindowLLM.app"
if [ -d "$EXTENSION_APP" ]; then
    rm -rf "$SHARED_DIR/WindowLLM.app" 2>/dev/null || true
    cp -r "$EXTENSION_APP" "$SHARED_DIR/WindowLLM.app"
fi

if [ "$SHOW_DISPLAY" = true ]; then
    echo "(UI mode: VM display will be visible)"
    tart run "$VM_NAME" --dir "$SHARED_DIR" &
else
    tart run "$VM_NAME" --dir "$SHARED_DIR" --no-graphics &
fi
VM_PID=$!

echo "Waiting for VM to boot..."
sleep 30

# Get VM IP
VM_IP=$(tart ip "$VM_NAME" 2>/dev/null || echo "")
if [ -z "$VM_IP" ]; then
    echo "Error: Could not get VM IP address"
    exit 1
fi
echo "VM IP: $VM_IP"

# Point the VM at the host's dev servers. On tart's shared network the host is
# the VM's default gateway, which is the VM subnet's .1 (e.g. VM 192.168.64.2 ->
# host 192.168.64.1). `route` isn't on tart-exec's PATH, so derive it from the IP.
HOST_GW=$(echo "$VM_IP" | sed 's/\.[0-9]*$/.1/')
echo "Mapping .test dev hostnames in the VM to the host ($HOST_GW)..."
tart exec "$VM_NAME" sudo bash -c "sed -i '' '/[[:space:]]windowllm\.test/d;/[[:space:]]page\.test/d' /etc/hosts 2>/dev/null; printf '%s windowllm.test page.test\n' '$HOST_GW' >> /etc/hosts" 2>/dev/null \
    && echo "VM /etc/hosts updated" \
    || echo "Warning: failed to update VM /etc/hosts"

# Step 4: Wait for harness
echo ""
echo "Step 4: Waiting for harness..."
HARNESS_READY=false
for i in {1..30}; do
    if curl -s "http://$VM_IP:$HARNESS_PORT/health" > /dev/null 2>&1; then
        echo "Harness ready."
        HARNESS_READY=true
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# If harness not ready, try starting it via tart exec
if [ "$HARNESS_READY" = false ]; then
    echo "Harness not ready. Starting via tart exec..."
    tart exec "$VM_NAME" bash -c "nohup node ~/safari-test-harness/server.js > /tmp/harness.log 2>&1 &" 2>/dev/null || true

    for i in {1..30}; do
        if curl -s "http://$VM_IP:$HARNESS_PORT/health" > /dev/null 2>&1; then
            echo "Harness ready."
            HARNESS_READY=true
            break
        fi
        sleep 1
        echo -n "."
    done
    echo ""
fi

if [ "$HARNESS_READY" = false ]; then
    echo "Error: Harness did not become ready"
    echo "The VM may need to be rebuilt. Try: npm run test:safari:rebuild"
    exit 1
fi

# Step 5: Run tests
echo ""
echo "Step 5: Running Safari tests..."
echo "Test URL: $TEST_URL"
echo ""

RESULTS=$(curl -s -X POST "http://$VM_IP:$HARNESS_PORT/run-tests" \
    -H "Content-Type: application/json" \
    -d "{\"testUrl\": \"$TEST_URL\"}" \
    --max-time 180 || echo '[]')

# Step 6: Display results
echo ""
echo "═══════════════════════════════════════════════════════"
echo "                    TEST RESULTS                        "
echo "═══════════════════════════════════════════════════════"

if command -v jq &> /dev/null; then
    PASSED=$(echo "$RESULTS" | jq '[.[] | select(.status == "pass")] | length' 2>/dev/null || echo "0")
    FAILED=$(echo "$RESULTS" | jq '[.[] | select(.status == "fail")] | length' 2>/dev/null || echo "0")
    TOTAL=$(echo "$RESULTS" | jq 'length' 2>/dev/null || echo "0")

    # Show each test result
    echo "$RESULTS" | jq -r '.[] |
        if .status == "pass" then "✅ \(.name)"
        else "❌ \(.name)\n   └─ \(.error // "Unknown error")"
        end' 2>/dev/null || echo "$RESULTS"

    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Total: $TOTAL | Passed: $PASSED | Failed: $FAILED"
    echo "═══════════════════════════════════════════════════════"
else
    echo "$RESULTS"
fi

# Save results to file
echo "$RESULTS" > "$PROJECT_ROOT/safari-test-results.json"
echo ""
echo "Results saved to: safari-test-results.json"

# Exit with appropriate code
if command -v jq &> /dev/null; then
    FAILED=$(echo "$RESULTS" | jq '[.[] | select(.status == "fail")] | length' 2>/dev/null || echo "1")
    if [ "$FAILED" -gt 0 ]; then
        echo ""
        echo "❌ $FAILED test(s) failed"
        exit 1
    else
        echo ""
        echo "✅ All tests passed"
        exit 0
    fi
fi
