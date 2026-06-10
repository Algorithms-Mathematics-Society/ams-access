#!/usr/bin/env bash
# Creates a stable self-signed code-signing identity ("AMS Access Dev") for
# local macOS development builds.
#
# WHY: with `signingIdentity: null`, local bundles get an ad-hoc signature
# whose cdhash changes on every rebuild. macOS TCC keys camera / microphone /
# Accessibility grants to the code signature, so every rebuild silently resets
# the permissions — which looks exactly like the permission bugs recurring.
# Signing with one stable identity makes TCC grants persist across rebuilds.
#
# USAGE (once per dev machine):
#   bash apps/desktop/src-tauri/scripts/setup-macos-dev-signing.sh
# then build signed dev bundles with:
#   pnpm --filter @ams/desktop build:mac-dev
# and run the app from src-tauri/target/debug/bundle/macos/ for any testing
# that touches TCC permissions. (`tauri dev` runs the bare cargo binary, which
# stays ad-hoc signed — fine for UI work, not for permission testing.)
#
# CI is unaffected: release.yml injects APPLE_SIGNING_IDENTITY (Developer ID),
# which the bundler uses because tauri.conf.json leaves signingIdentity null.

set -euo pipefail

IDENTITY_NAME="AMS Access Dev"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is for macOS development machines only." >&2
  exit 1
fi

if security find-identity -v -p codesigning | grep -q "$IDENTITY_NAME"; then
  echo "✓ Code-signing identity '$IDENTITY_NAME' already exists — nothing to do."
  exit 0
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

cat > "$WORKDIR/openssl.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = codesign_ext
prompt = no
[dn]
CN = AMS Access Dev
[codesign_ext]
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
basicConstraints = critical,CA:false
EOF

openssl req -x509 -newkey rsa:2048 -days 1825 -nodes \
  -keyout "$WORKDIR/dev.key" -out "$WORKDIR/dev.crt" \
  -config "$WORKDIR/openssl.cnf"

P12_PASS="$(openssl rand -hex 12)"
openssl pkcs12 -export -inkey "$WORKDIR/dev.key" -in "$WORKDIR/dev.crt" \
  -out "$WORKDIR/dev.p12" -passout "pass:$P12_PASS" -name "$IDENTITY_NAME"

# Import into the default (login) keychain; -T lets codesign use the key.
security import "$WORKDIR/dev.p12" -P "$P12_PASS" -T /usr/bin/codesign

echo "Marking the certificate as trusted for code signing (sudo required)…"
sudo security add-trusted-cert -d -r trustRoot -p codeSign \
  -k /Library/Keychains/System.keychain "$WORKDIR/dev.crt"

echo "✓ Identity '$IDENTITY_NAME' created and trusted."
echo "  Build a signed dev bundle:  pnpm --filter @ams/desktop build:mac-dev"
echo "  The first codesign use may show a keychain prompt — choose 'Always Allow'."
