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
trap 'rm -rf "$TMP_DIR"' EXIT
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

# Attempt a manual docker push with a few retries/backoff
manual_push_with_retries() {
  local full_tag=$1
  local max_attempts=5
  local attempt=0

  until docker push "$full_tag"; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge $max_attempts ]]; then
      echo "❌ Failed to push ${full_tag} after ${attempt} attempts."
      return 1
    fi
    sleep_time=$((attempt * 2))
    echo "⚠️ Retry ${attempt}/${max_attempts} for ${full_tag} after ${sleep_time}s..."
    sleep "${sleep_time}"
  done

  echo "✅ Successfully pushed ${full_tag}."
  return 0
}

build_and_push() {
  local context=$1
  local dockerfile=$2
  local base_name=$3
  shift 3
  local tags=("$@")

  if [[ -z "$dockerfile" ]]; then
    dockerfile="${context}/Dockerfile"
  fi

  echo "🔨 Building ${base_name}..."
  local tag_args=()
  for tag in "${tags[@]}"; do
    tag_args+=("-t" "${DOCKER_USERNAME}/${base_name}${tag}")
  done

  # Build without pushing
  docker buildx build \
    --platform "$PLATFORM" \
    "${tag_args[@]}" \
    -f "$dockerfile" \
    --load \
    "$context"

  # Push manually with retries
  for tag in "${tags[@]}"; do
    full="${DOCKER_USERNAME}/${base_name}${tag}"
    echo "→ Pushing ${full}..."
    manual_push_with_retries "$full"
  done
}

# === Build targets ===
echo "🚀 Building type: ${BUILD_TYPE} | Containers: ${CONTAINERS}"

if should_build "app"; then
  build_and_push "." "./Dockerfile" "dashwise" "${TAGS_APP[@]}"
fi

if should_build "jobs"; then
  build_and_push "." "./jobs/Dockerfile" "dashwise-jobs" "${TAGS_JOBS[@]}"
fi

echo "✅ All builds completed successfully!"
