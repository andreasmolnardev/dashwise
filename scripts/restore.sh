#!/usr/bin/env bash
set -euo pipefail

# Restore a tar.gz created by scripts/backup.sh. The current data directory is
# retained beside the restored one until the operator removes it.
# Usage: scripts/restore.sh archive.tar.gz

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "usage: scripts/restore.sh archive.tar.gz" >&2
  exit 2
fi
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"
archive=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
data_dir=${DATA_DIR_HOST:-./dashwise-data}
parent=$(dirname "$data_dir")
base=$(basename "$data_dir")
mkdir -p "$parent"
parent=$(cd "$parent" && pwd)
data_dir="$parent/$base"
staging=$(mktemp -d "$parent/.${base}.restore.XXXXXX")
previous="$parent/${base}.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
stopped=0
swapped=0

cleanup() {
  if (( swapped )) && [[ -e "$previous" ]]; then
    if [[ -e "$data_dir" ]]; then mv "$data_dir" "$staging.failed"; fi
    mv "$previous" "$data_dir"
    rm -rf "$staging.failed"
  fi
  if (( stopped )); then docker compose start dashwise >/dev/null || true; fi
  rm -rf "$staging"
}
trap cleanup EXIT INT TERM

# Reject absolute paths and parent traversal before extracting the archive.
if tar -tzf "$archive" | awk 'BEGIN { bad=0 } /^\// { bad=1 } /(^|\/)\.\.($|\/)/ { bad=1 } END { exit bad }'; then
  :
else
  echo "backup contains unsafe paths" >&2
  exit 1
fi
tar --no-same-owner -xzf "$archive" -C "$staging"
if [[ ! -f "$staging/dashwise.sqlite" || ! -f "$staging/secret.key" || ! -d "$staging/wallpapers" ]]; then
  echo "backup is missing dashwise.sqlite, secret.key, or wallpapers/" >&2
  exit 1
fi

docker compose stop dashwise
stopped=1
if [[ -e "$data_dir" ]]; then
  mv "$data_dir" "$previous"
  swapped=1
fi
mv "$staging" "$data_dir"
swapped=1
docker compose start dashwise
stopped=0
swapped=0
trap - EXIT INT TERM
echo "Restored Dashwise data. Previous data retained at: $previous"
