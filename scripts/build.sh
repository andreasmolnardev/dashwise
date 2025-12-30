#!/usr/bin/env bash
set -euo pipefail

# === Require root privileges ===
if [[ $EUID -ne 0 ]]; then
  echo "❌ This script must be run as root (use sudo)."
  exit 1
fi

# === Parse CLI arguments ===
DOCKER_USERNAME="andreasmolnardev"
GITHUB_REPO="https://github.com/andreasmolnardev/dashwise-next.git"
BRANCH="preview"
VERSION=""
CONTAINERS="all"
BUILD_TYPE="preview" # default

for arg in "$@"; do
  case $arg in
    --docker-username=*) DOCKER_USERNAME="${arg#*=}" ;;
    --github-repo=*) GITHUB_REPO="${arg#*=}" ;;
    --branch=*) BRANCH="${arg#*=}" ;;
    --version=*) VERSION="${arg#*=}" ;;
    --containers=*) CONTAINERS="${arg#*=}" ;;
    --build-type=*) BUILD_TYPE="${arg#*=}" ;;
    *) echo "❌ Unknown argument: $arg"; exit 1 ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "Usage:"
  echo "  sudo ./build.sh --version=\"1.0.0\" --build-type=preview|dev|stable [--containers=all|jobs|pocketbase|app]"
  exit 1
fi

# === Validate build type ===
if [[ ! "$BUILD_TYPE" =~ ^(dev|preview|stable)$ ]]; then
  echo "❌ Invalid build type: $BUILD_TYPE (must be dev, preview, or stable)"
  exit 1
fi

# === Detect platform ===
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) PLATFORM="linux/amd64"; TAG_SUFFIX="" ;;
  aarch64|armv7l) PLATFORM="linux/arm64"; TAG_SUFFIX="-arm" ;;
  *) echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
esac
echo "🧠 Detected native platform: $PLATFORM"
echo "🏷️  Tag suffix: '$TAG_SUFFIX'"

# === Clone repo ===
TMP_DIR="$(mktemp -d)"
echo "📦 Cloning $GITHUB_REPO (branch: $BRANCH) into $TMP_DIR..."
git clone --branch "$BRANCH" --depth 1 "$GITHUB_REPO" "$TMP_DIR"
cd "$TMP_DIR"

# === Ensure Buildx is ready ===
if docker buildx inspect >/dev/null 2>&1; then
  echo "🔧 Using existing Docker Buildx builder."
else
  echo "🆕 Creating default Buildx builder..."
  docker buildx create --use --name default
fi

# === Tag setup based on build type ===
declare -a TAGS_APP TAGS_PB TAGS_JOBS

case "$BUILD_TYPE" in
  dev)
    TAGS_APP=(":dev${TAG_SUFFIX}" ":develop${TAG_SUFFIX}" ":latest${TAG_SUFFIX}")
    TAGS_PB=(":dev${TAG_SUFFIX}" ":develop${TAG_SUFFIX}" ":latest${TAG_SUFFIX}")
    TAGS_JOBS=(":dev${TAG_SUFFIX}" ":develop${TAG_SUFFIX}" ":latest${TAG_SUFFIX}")
    ;;
  preview)
    TAGS_APP=(":${VERSION}-pre${TAG_SUFFIX}" ":preview${TAG_SUFFIX}")
    TAGS_PB=(":${VERSION}-pre${TAG_SUFFIX}" ":preview${TAG_SUFFIX}")
    TAGS_JOBS=(":${VERSION}-pre${TAG_SUFFIX}" ":preview${TAG_SUFFIX}")
    ;;
  stable)
    TAGS_APP=(":${VERSION}${TAG_SUFFIX}" ":stable${TAG_SUFFIX}")
    TAGS_PB=(":${VERSION}${TAG_SUFFIX}" ":stable${TAG_SUFFIX}")
    TAGS_JOBS=(":${VERSION}${TAG_SUFFIX}" ":stable${TAG_SUFFIX}")
    ;;
esac

# === Helper functions ===
should_build() {
  [[ "$CONTAINERS" == "all" ]] || [[ "$CONTAINERS" == *"$1"* ]]
}

build_and_push() {
  local dir=$1
  local base_name=$2
  shift 2
  local tags=("$@")

  echo "🔨 Building ${base_name}..."
  local tag_args=()
  for tag in "${tags[@]}"; do
    tag_args+=("-t" "${DOCKER_USERNAME}/${base_name}${tag}")
  done

  docker buildx build \
    --platform "$PLATFORM" \
    "${tag_args[@]}" \
    -f "${dir}/Dockerfile" \
    --push "${dir}"
}

# === Build targets ===
echo "🚀 Building type: ${BUILD_TYPE} | Containers: ${CONTAINERS}"

if should_build "app"; then
  build_and_push "." "dashwise" "${TAGS_APP[@]}"
fi

if should_build "pocketbase"; then
  build_and_push "./pocketbase" "dashwise-pb" "${TAGS_PB[@]}"
fi

if should_build "jobs"; then
  build_and_push "./jobs" "dashwise-jobs" "${TAGS_JOBS[@]}"
fi

echo "✅ All builds completed successfully!"
