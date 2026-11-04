#!/usr/bin/env bash
set -euo pipefail

# Snapshot the default Docker Compose data directory while Dashwise is stopped.
# Usage: scripts/backup.sh [archive-path]

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"
data_dir=${DATA_DIR_HOST:-./dashwise-data}
data_dir=$(cd "$data_dir" && pwd)
archive=${1:-"./dashwise-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"}
mkdir -p "$(dirname "$archive")"
archive=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")

if [[ "$archive" == "$data_dir"/* ]]; then
  echo "backup archive must be outside the Dashwise data directory" >&2
  exit 1
fi
if [[ ! -f "$data_dir/dashwise.sqlite" || ! -f "$data_dir/secret.key" ]]; then
  echo "expected dashwise.sqlite and secret.key in $data_dir; set DATA_DIR_HOST for a custom data directory" >&2
  exit 1
fi

stopped=0
restart() {
  if (( stopped )); then docker compose start dashwise >/dev/null; fi
}
trap restart EXIT INT TERM

docker compose stop dashwise
stopped=1
tar -C "$data_dir" -czf "$archive" .
chmod 600 "$archive"
docker compose start dashwise
stopped=0
trap - EXIT INT TERM
echo "Created Dashwise backup: $archive"
