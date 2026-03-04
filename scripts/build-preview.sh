#!/usr/bin/env bash
set -euo pipefail

# === Require root privileges ===
if [[ $EUID -ne 0 ]]; then
  echo "❌ This script must be run as root (use sudo)."
  exit 1
fi

# === Parse CLI arguments ===
DOCKER_USERNAME=""
GITHUB_REPO=""
BRANCH="preview"
VERSION=""
DOCKER_USERNAME="andreasmolnardev"
GITHUB_REPO="https://github.com/andreasmolnardev/dashwise-next.git"
CONTAINERS="all"

for arg in "$@"; do
  case $arg in
    --docker-username=*) DOCKER_USERNAME="${arg#*=}" ;;
    --github-repo=*) GITHUB_REPO="${arg#*=}" ;;
    --branch=*) BRANCH="${arg#*=}" ;;
    --version=*) VERSION="${arg#*=}" ;;
    --containers=*) CONTAINERS="${arg#*=}" ;;  # new flag
    *) echo "❌ Unknown argument: $arg"; exit 1 ;;
  esac
done


if [[ -z "$VERSION" ]]; then
  echo "Usage:"
  echo "  sudo ./build-native-preview.sh --version=\"1.0.0\" [--branch=preview] [--containers=all|jobs|pocketbase|app]"
  exit 1
fi


# === Detect platform ===
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)
    PLATFORM="linux/amd64"
    TAG_SUFFIX=""
    ;;
  aarch64|armv7l)
    PLATFORM="linux/arm64"
    TAG_SUFFIX="-arm"
    ;;
  *)
    echo "❌ Unsupported architecture: $ARCH"
    exit 1
    ;;
esac
echo "🧠 Detected native platform: $PLATFORM"
echo "🏷️  Tag suffix: '$TAG_SUFFIX'"

# === Clone repo into temp directory ===
TMP_DIR="$(mktemp -d)"
echo "📦 Cloning $GITHUB_REPO (branch: $BRANCH) into $TMP_DIR..."
git clone --branch "$BRANCH" --depth 1 "$GITHUB_REPO" "$TMP_DIR"
cd "$TMP_DIR"

echo "⚙️ Checking Docker Buildx setup..."

# Check if any builder exists
if docker buildx inspect >/dev/null 2>&1; then
  echo "🔧 Using existing Docker Buildx builder."
else
  echo "🆕 No Buildx builder found, initializing default one..."
  docker buildx create --use --name default
fi
# === Build and push native images ===
echo "🚀 Building and pushing containers for ${PLATFORM} (version: $VERSION${TAG_SUFFIX})..."
echo "📦 Selected containers: ${CONTAINERS}"

# Helper to check if a container should be built
should_build() {
  [[ "$CONTAINERS" == "all" ]] || [[ "$CONTAINERS" == *"$1"* ]]
}

if should_build "app"; then
  echo "🔨 Building Dashwise main app..."
  docker buildx build \
    --platform "$PLATFORM" \
    -t "${DOCKER_USERNAME}/dashwise:${VERSION}-pre${TAG_SUFFIX}" \
    -t "${DOCKER_USERNAME}/dashwise:pre-release${TAG_SUFFIX}" \
    -t "${DOCKER_USERNAME}/dashwise:preview${TAG_SUFFIX}" \
    -f ./Dockerfile \
    --push .
fi

if should_build "pocketbase"; then
  echo "🔨 Building PocketBase..."
  docker buildx build \
    --platform "$PLATFORM" \
    -t "${DOCKER_USERNAME}/dashwise-pb:${VERSION}-pre${TAG_SUFFIX}" \
    -t "${DOCKER_USERNAME}/dashwise-pb:pre-release${TAG_SUFFIX}" \
    -t "${DOCKER_USERNAME}/dashwise-pb:preview${TAG_SUFFIX}" \
    -f ./pocketbase/Dockerfile \
    --push ./pocketbase
fi

if should_build "jobs"; then
  echo "🔨 Building Job Runner..."
  docker buildx build \
    --platform "$PLATFORM" \
    -t "${DOCKER_USERNAME}/dashwise-jobs:${VERSION}-pre${TAG_SUFFIX}" \
    -t "${DOCKER_USERNAME}/dashwise-jobs:pre-release${TAG_SUFFIX}" \
    -t "${DOCKER_USERNAME}/dashwise-jobs:preview${TAG_SUFFIX}" \
    -f ./jobs/Dockerfile \
    --push .
fi
