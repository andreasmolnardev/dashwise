#!/bin/bash
set -euo pipefail

# Target directory
TARGET_DIR="./public/icons"

# Temp clone location
TMP_DIR=$(mktemp -d)

# Repo URL
REPO_URL="https://github.com/selfhst/icons.git"

echo "Cloning latest repo..."
git clone --depth 1 "$REPO_URL" "$TMP_DIR"

echo "Syncing required files..."
mkdir -p "$TARGET_DIR"

# Copy svg folder
rsync -a --delete "$TMP_DIR/svg/" "$TARGET_DIR/svg/"
rsync -a --delete "$TMP_DIR/webp/" "$TARGET_DIR/webp/"
rsync -a --delete "$TMP_DIR/png/" "$TARGET_DIR/png/"

# Copy JSON files
cp "$TMP_DIR/tags.json" "$TMP_DIR/index.json" "$TARGET_DIR/"

echo "Cleaning up..."
rm -rf "$TMP_DIR"

echo "✅ Done. Files are in $TARGET_DIR"
