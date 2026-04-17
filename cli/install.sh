#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
MANIFEST_DIR_FIREFOX="$HOME/.mozilla/native-messaging-hosts"
MANIFEST_DIR_CHROME="$HOME/.config/google-chrome/NativeMessagingHosts"

HOST_SCRIPT="$SCRIPT_DIR/paperboy-host.js"
CLI_SCRIPT="$SCRIPT_DIR/paperboy.js"

echo "Installing paperboy..."

mkdir -p "$BIN_DIR"

ln -sf "$HOST_SCRIPT" "$BIN_DIR/paperboy-host"
ln -sf "$CLI_SCRIPT" "$BIN_DIR/paperboy"

chmod +x "$HOST_SCRIPT"
chmod +x "$CLI_SCRIPT"

if ! grep -q "$BIN_DIR" <<< "$PATH" 2>/dev/null; then
  echo ""
  echo "NOTE: Add $BIN_DIR to your PATH."
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

echo ""
echo "Installing native messaging manifests..."

mkdir -p "$MANIFEST_DIR_FIREFOX"
cat > "$MANIFEST_DIR_FIREFOX/paperboy.json" << EOF
{
  "name": "paperboy",
  "description": "paperboy native messaging host",
  "path": "$BIN_DIR/paperboy-host",
  "type": "stdio",
  "allowed_extensions": ["paperboy@paperboy.dev"]
}
EOF

mkdir -p "$MANIFEST_DIR_CHROME"
cat > "$MANIFEST_DIR_CHROME/com.paperboy.json" << EOF
{
  "name": "paperboy.paperboy",
  "description": "paperboy native messaging host",
  "path": "$BIN_DIR/paperboy-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://*/"]
}
EOF

echo "Firefox manifest installed to $MANIFEST_DIR_FIREFOX/paperboy.json"
echo "Chrome manifest installed to $MANIFEST_DIR_CHROME/com.paperboy.json"

echo ""
echo "Done! Next steps:"
echo ""
echo "  1. Initialize your paperboy directory:"
echo "     paperboy init"
echo ""
echo "  2. (Optional) Add a git remote for sync:"
echo "     cd ~/paperboy"
echo "     git remote add origin <your-repo-url>"
echo ""
echo "  3. (Optional) Set up auto-sync with cron:"
echo "     */5 * * * * paperboy sync"