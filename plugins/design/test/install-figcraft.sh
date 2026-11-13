#!/usr/bin/env bash
# Downloads the pinned FigCraft CLI and server for this machine into $1 (default /tmp/figcraft),
# checked against the release's SHA256SUMS.txt. Used by the real contract test and CI.
set -euo pipefail
VERSION="${FIGCRAFT_VERSION:-0.18.1}"
DEST="${1:-/tmp/figcraft}"
case "$(uname -m)" in
  aarch64|arm64) ARCH=aarch64 ;;
  x86_64|amd64) ARCH=x86_64 ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
BASE="https://github.com/storytold/figcraft/releases/download/v${VERSION}"
APP="figcraft-${VERSION}-linux-${ARCH}.tar.gz"
SERVER="figcraft-server-${VERSION}-linux-${ARCH}.tar.gz"
mkdir -p "$DEST"
cd "$DEST"
curl -fsSL -o SHA256SUMS.txt "$BASE/SHA256SUMS.txt"
for asset in "$APP" "$SERVER"; do
  [ -f "$asset" ] || curl -fsSL -o "$asset" "$BASE/$asset"
  grep " ${asset}\$" SHA256SUMS.txt | sha256sum -c - >&2
done
tar xzf "$APP"
tar xzf "$SERVER"
CLI="$(find "$DEST" -path '*/bin/figcraft-cli' -type f | head -1)"
SRV="$(find "$DEST" -name figcraft-server -type f | head -1)"
chmod +x "$CLI" "$SRV"
echo "FIGCRAFT_CLI=$CLI"
echo "FIGCRAFT_SERVER_BIN=$SRV"
