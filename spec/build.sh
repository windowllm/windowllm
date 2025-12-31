#!/bin/bash
#
# Build the WindowLLM specification
#
# Requires: bikeshed (Python) or curl to use the API
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

INPUT="index.bs"
OUTPUT="index.html"

echo "Building WindowLLM specification..."

# Try local bikeshed first
if command -v bikeshed &> /dev/null; then
    echo "Using local bikeshed..."
    bikeshed spec "$INPUT" "$OUTPUT"
elif command -v python3 &> /dev/null && python3 -c "import bikeshed" 2>/dev/null; then
    echo "Using Python bikeshed module..."
    python3 -m bikeshed spec "$INPUT" "$OUTPUT"
else
    echo "Using Bikeshed API (requires internet)..."
    # Use the online API as fallback
    curl -s -F file=@"$INPUT" https://api.csswg.org/bikeshed/ -o "$OUTPUT"

    # Check if we got HTML back (case-insensitive)
    if ! grep -qi '<!doctype html>' "$OUTPUT" 2>/dev/null; then
        echo "Error: Bikeshed API returned an error"
        cat "$OUTPUT"
        rm -f "$OUTPUT"
        exit 1
    fi
fi

echo "Specification built: $OUTPUT"
echo ""
echo "To install bikeshed locally for faster builds:"
echo "  pip3 install bikeshed"
echo "  bikeshed update"
