#!/bin/bash
# Check if Safari VM image needs to be rebuilt based on source file changes

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HASH_FILE="$SCRIPT_DIR/.image-hash"

# Calculate current hash of vault and extension source files
CURRENT_HASH=$(find "$PROJECT_ROOT/packages/vault/src" "$PROJECT_ROOT/packages/extension/src" \
    "$PROJECT_ROOT/packages/extension/manifest.safari.json" \
    -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.json" \) 2>/dev/null | \
    sort | xargs shasum 2>/dev/null | shasum)

# Compare with stored hash
if [ -f "$HASH_FILE" ]; then
    STORED_HASH=$(cat "$HASH_FILE")
    if [ "$CURRENT_HASH" = "$STORED_HASH" ]; then
        echo "no-rebuild"
        exit 0
    fi
fi

echo "rebuild-needed"
exit 0
