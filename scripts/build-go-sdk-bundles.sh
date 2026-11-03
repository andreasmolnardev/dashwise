#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

# Every supported retained JS SDK integration provider embedded into the Go
# runtime. YAML integrations are separate and never bundled here.
providers="groovewise homeassistant jellyfin music-assistant"

# Keep esbuild pinned so regenerated Go-embedded provider bundles are
# reproducible without relying on a floating bunx latest version.
for provider in $providers; do
  bunx --yes esbuild@0.25.5 \
    "packages/integrations/$provider/src/index.ts" \
    --bundle \
    --format=cjs \
    --platform=neutral \
    --target=es2020 \
    --legal-comments=none \
    "--outfile=apps/backend/internal/sdkproviders/bundles/$provider.cjs"
done
