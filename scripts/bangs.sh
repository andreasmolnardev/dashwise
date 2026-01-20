# copy https://duckduckgo.com/bang.js into ../public/bangs.js
#!/bin/bash

# Define the target path
TARGET_DIR="public"
TARGET_FILE="$TARGET_DIR/bangs.js"

# Create the directory if it doesn't exist
mkdir -p "$TARGET_DIR"

echo "Fetching DuckDuckGo bang data..."

# Use curl to download the file
# -s: Silent mode
# -L: Follow redirects
# -o: Output file path
curl -sL https://duckduckgo.com/bang.js -o "$TARGET_FILE"

# Check if the download was successful
if [ $? -eq 0 ]; then
  echo "✅ Successfully copied bang.js to $TARGET_FILE"
  
  # Optional: Log the size of the file
  FILESIZE=$(du -h "$TARGET_FILE" | cut -f1)
  echo "File size: $FILESIZE"
else
  echo "❌ Error: Failed to download bang.js"
  exit 1
fi