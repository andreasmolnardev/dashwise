#!/bin/sh
set -eu

# Target directory
TARGET_DIR="./public/icons"

# Temp workspace
TMP_DIR=$(mktemp -d)
ARCHIVE_PATH="$TMP_DIR/icons.tar.gz"
EXTRACT_DIR="$TMP_DIR/extracted"

# Source archive URL (main branch)
ARCHIVE_URL="https://codeload.github.com/selfhst/icons/tar.gz/refs/heads/main"

download_file() {
	url="$1"
	output="$2"

	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$url" -o "$output"
		return
	fi

	if command -v wget >/dev/null 2>&1; then
		wget -qO "$output" "$url"
		return
	fi

	echo "❌ Neither curl nor wget is available for HTTP download"
	exit 1
}

echo "Downloading latest icons archive..."
download_file "$ARCHIVE_URL" "$ARCHIVE_PATH"

echo "Extracting archive..."
mkdir -p "$EXTRACT_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"

SOURCE_DIR=$(find "$EXTRACT_DIR" -maxdepth 1 -mindepth 1 -type d | head -n 1)

if [ -z "$SOURCE_DIR" ]; then
	echo "❌ Could not locate extracted source directory"
	exit 1
fi

echo "Syncing required files..."
mkdir -p "$TARGET_DIR"

# Replace asset folders using cp
rm -rf "$TARGET_DIR/svg" "$TARGET_DIR/webp" "$TARGET_DIR/png"
cp -R "$SOURCE_DIR/svg" "$TARGET_DIR/svg"
cp -R "$SOURCE_DIR/webp" "$TARGET_DIR/webp"
cp -R "$SOURCE_DIR/png" "$TARGET_DIR/png"

# Copy JSON files
cp "$SOURCE_DIR/tags.json" "$SOURCE_DIR/index.json" "$TARGET_DIR/"

echo "Cleaning up..."
rm -rf "$TMP_DIR"

echo "✅ Done. Files are in $TARGET_DIR"
