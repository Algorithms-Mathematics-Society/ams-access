#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
export PATH="$scratch:$PATH" TRACE="$scratch/trace"

cat > "$scratch/sudo" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ $1 == timeout && $3 == apt-get ]]

for arg in "$@"; do
  case "$arg" in
    Dir::Etc::sourcelist=*) sources=${arg#*=} ;;
    update) command=update ;;
    --download-only) command=download ;;
    --no-download) command=install ;;
  esac
done
grep -q 'signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg' "$sources"
mirror=$(awk 'NR == 1 {print $3}' "$sources")
printf '%s %s\n' "$command" "$mirror" >> "$TRACE"

case "$command" in
  update)
    [[ $* == *"APT::Update::Error-Mode=any"* ]]
    [[ $MODE != unavailable && ($MODE != fallback || $mirror == *kernel.org*) ]]
    ;;
  download)
    [[ $* == *"--no-install-recommends libunwind-14-dev- libunwind-dev"* ]]
    [[ $MODE != download-fallback || $mirror == *kernel.org* ]]
    ;;
  install)
    [[ $* == *"--no-install-recommends libunwind-14-dev- libunwind-dev"* ]]
    ;;
esac
MOCK
chmod +x "$scratch/sudo"

for mode in primary fallback download-fallback unavailable; do
  : > "$TRACE"
  if MODE=$mode bash "$script_dir/install-jammy-ci-deps.sh" libunwind-14-dev- libunwind-dev; then
    [[ $mode != unavailable ]]
  else
    [[ $mode == unavailable ]]
  fi
  case "$mode" in
    primary)
      expected=$'update https://archive.ubuntu.com/ubuntu\ndownload https://archive.ubuntu.com/ubuntu\ninstall https://archive.ubuntu.com/ubuntu'
      ;;
    fallback)
      expected=$'update https://archive.ubuntu.com/ubuntu\nupdate https://mirrors.edge.kernel.org/ubuntu\ndownload https://mirrors.edge.kernel.org/ubuntu\ninstall https://mirrors.edge.kernel.org/ubuntu'
      ;;
    download-fallback)
      expected=$'update https://archive.ubuntu.com/ubuntu\ndownload https://archive.ubuntu.com/ubuntu\nupdate https://mirrors.edge.kernel.org/ubuntu\ndownload https://mirrors.edge.kernel.org/ubuntu\ninstall https://mirrors.edge.kernel.org/ubuntu'
      ;;
    unavailable)
      expected=$'update https://archive.ubuntu.com/ubuntu\nupdate https://mirrors.edge.kernel.org/ubuntu'
      ;;
  esac
  [[ $(cat "$TRACE") == "$expected" ]]
done
