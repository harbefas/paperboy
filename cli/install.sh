#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"

HOST_SCRIPT="$SCRIPT_DIR/paperboy-host.js"
CLI_SCRIPT="$SCRIPT_DIR/paperboy.js"

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js not found. Install it from https://nodejs.org and re-run." >&2
  exit 1
fi

echo "Installing paperboy CLI..."

mkdir -p "$BIN_DIR"

chmod +x "$HOST_SCRIPT"
chmod +x "$CLI_SCRIPT"

ln -sf "$HOST_SCRIPT" "$BIN_DIR/paperboy-host"
ln -sf "$CLI_SCRIPT"  "$BIN_DIR/paperboy"

echo "  ✓ Symlinks created in $BIN_DIR"

if ! command -v paperboy &>/dev/null 2>&1; then
  echo ""
  echo "NOTE: $BIN_DIR is not in PATH. Add this to your shell profile:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

echo ""
echo "Installing native messaging manifests..."

MANIFEST_CONTENT() {
  cat <<EOF
{
  "name": "paperboy",
  "description": "paperboy native messaging host",
  "path": "$BIN_DIR/paperboy-host",
  "type": "stdio",
  "allowed_extensions": ["paperboy@paperboy.dev"]
}
EOF
}

install_manifest() {
  local dir="$1"
  mkdir -p "$dir"
  MANIFEST_CONTENT > "$dir/paperboy.json"
  echo "  ✓ $dir/paperboy.json"
}

case "$(uname -s)" in
  Linux)
    install_manifest "$HOME/.mozilla/native-messaging-hosts"
    ;;
  Darwin)
    install_manifest "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
    ;;
  *)
    echo "  Unsupported OS. Manually place the native manifest in your browser's NativeMessagingHosts directory."
    ;;
esac

echo ""
echo "Initializing ~/paperboy directory..."
"$BIN_DIR/paperboy" init

echo ""
echo "Done! Run 'paperboy doctor' to verify the setup."
