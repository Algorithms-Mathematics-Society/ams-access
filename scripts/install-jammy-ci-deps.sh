#!/usr/bin/env bash
set -euo pipefail

sources=$(mktemp --suffix=.list)
trap 'rm -f "$sources"' EXIT

as_root=()
if (( EUID != 0 )); then
  as_root=(sudo)
fi

apt_options=(
  -o "Dir::Etc::sourcelist=$sources"
  -o Dir::Etc::sourceparts=-
  -o Acquire::Languages=none
  -o Acquire::IndexTargets::deb::CNF::DefaultEnabled=false
  -o Acquire::IndexTargets::deb::DEP-11::DefaultEnabled=false
  -o Acquire::https::Timeout=20
  -o Acquire::Retries=2
)

install=(install -y --no-install-recommends "$@")

# Download before changing packages so a stalled mirror never interrupts dpkg.
for mirror in https://archive.ubuntu.com/ubuntu https://mirrors.edge.kernel.org/ubuntu; do
  printf "deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] %s %s main restricted universe multiverse\n" \
    "$mirror" jammy "$mirror" jammy-updates "$mirror" jammy-security > "$sources"

  if "${as_root[@]}" timeout 150 apt-get "${apt_options[@]}" --no-list-cleanup -o APT::Update::Error-Mode=any update &&
    "${as_root[@]}" timeout 320 apt-get "${apt_options[@]}" --download-only "${install[@]}"; then
    "${as_root[@]}" timeout 180 apt-get "${apt_options[@]}" --no-download "${install[@]}"
    exit
  fi
  echo "Could not fetch all required Jammy packages from $mirror."
done

echo "::error::Both Jammy package mirrors failed to prepare dependencies."
exit 1
