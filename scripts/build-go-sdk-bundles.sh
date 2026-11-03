#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

# Keep esbuild pinned so regenerated Go-embedded provider bundles are
# reproducible without relying on a floating bunx latest version.
bunx --yes esbuild@0.25.5 \
  packages/integrations/homeassistant/src/index.ts \
  --bundle \
  --format=cjs \
  --platform=neutral \
  --target=es2020 \
  --legal-comments=none \
  --outfile=apps/backend/internal/sdkproviders/bundles/homeassistant.cjs
