#!/bin/bash
#
# WindowLLM Local HTTPS Development Setup
#
# This script sets up local HTTPS development with:
# - mkcert for trusted local certificates
# - /etc/hosts entry for windowllm.localhost
#
# Tested on macOS 14+ (Sonoma) and macOS 15+ (Sequoia)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CERTS_DIR="$PROJECT_ROOT/.certs"

echo "🔐 WindowLLM Local HTTPS Setup"
echo "==============================="
echo ""

# Detect OS
OS="$(uname -s)"
echo "Detected OS: $OS"
echo ""

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "📦 mkcert not found. Installing..."

    case "$OS" in
        Darwin)
            if ! command -v brew &> /dev/null; then
                echo "❌ Homebrew not found. Please install Homebrew first:"
                echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
                exit 1
            fi
            echo "   Installing mkcert via Homebrew..."
            brew install mkcert

            # Install nss for Firefox support (optional, don't fail if it doesn't work)
            if brew list nss &>/dev/null || brew install nss 2>/dev/null; then
                echo "   ✓ nss installed for Firefox support"
            else
                echo "   ⚠ nss installation skipped (Firefox may need manual cert import)"
            fi
            ;;
        Linux)
            if command -v apt-get &> /dev/null; then
                sudo apt-get update
                sudo apt-get install -y libnss3-tools wget
                wget -q https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v*-linux-amd64 -O mkcert
                chmod +x mkcert
                sudo mv mkcert /usr/local/bin/mkcert
            elif command -v yum &> /dev/null; then
                sudo yum install -y nss-tools wget
                wget -q https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v*-linux-amd64 -O mkcert
                chmod +x mkcert
                sudo mv mkcert /usr/local/bin/mkcert
            else
                echo "❌ Please install mkcert manually: https://github.com/FiloSottile/mkcert"
                exit 1
            fi
            ;;
        *)
            echo "❌ Unsupported OS: $OS"
            echo "   Please install mkcert manually: https://github.com/FiloSottile/mkcert"
            exit 1
            ;;
    esac
fi

echo "   ✓ mkcert available: $(which mkcert)"

# Install the local CA
echo ""
echo "📜 Installing local CA..."
echo "   This adds a trusted certificate authority to your system keychain."
echo "   You may be prompted for your password."
echo ""

mkcert -install

# Create certs directory
mkdir -p "$CERTS_DIR"

# Generate certificates for local development
echo ""
echo "🔑 Generating certificates..."
cd "$CERTS_DIR"

# Remove old certs if they exist
rm -f key.pem cert.pem

mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 windowllm.localhost "*.windowllm.localhost"

if [[ -f "key.pem" && -f "cert.pem" ]]; then
    echo "   ✓ Certificates generated in $CERTS_DIR"
else
    echo "   ❌ Failed to generate certificates"
    exit 1
fi

# The .localhost TLD is a reserved special-use domain that automatically
# resolves to 127.0.0.1 (RFC 6761) - no /etc/hosts entry needed
echo ""
echo "🌐 Verifying DNS resolution..."
if ping -c 1 windowllm.localhost &> /dev/null; then
    echo "   ✓ windowllm.localhost resolves correctly (via .localhost TLD)"
else
    echo "   ⚠ windowllm.localhost not resolving - adding to /etc/hosts..."
    case "$OS" in
        Darwin)
            echo "127.0.0.1 windowllm.localhost" | sudo tee -a /etc/hosts > /dev/null
            ;;
        Linux)
            echo "127.0.0.1 windowllm.localhost" | sudo tee -a /etc/hosts > /dev/null
            ;;
    esac
    echo "   ✓ Added windowllm.localhost to /etc/hosts"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To start development, run these in separate terminals:"
echo ""
echo "  Terminal 1 (Vault):    npm run dev"
echo "  Terminal 2 (Examples): npm run dev:examples"
echo ""
echo "Then open:"
echo "  https://windowllm.localhost:3000  - Vault Configuration UI"
echo "  https://windowllm.localhost:3001  - Example pages"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
