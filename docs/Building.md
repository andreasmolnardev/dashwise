# Building Dashwise

## Version and Build Date

The application now supports dynamic version and build date configuration through Docker build arguments. This eliminates the need to manually edit source files when building different versions.

### Build Arguments

- `VERSION`: The version string (e.g., "1.0.0", "0.4-dev")
- `BUILD_DATE`: The build timestamp in ISO 8601 format (auto-generated if not provided)

### Using build.sh

The recommended way to build images with proper versioning:

```bash
# Build a preview release
sudo ./scripts/build.sh --version="1.0.0" --build-type=preview

# Build a stable release
sudo ./scripts/build.sh --version="1.0.0" --build-type=stable

# Build a dev release
sudo ./scripts/build.sh --version="0.4" --build-type=dev

# Build specific containers only
sudo ./scripts/build.sh --version="1.0.0" --build-type=stable --containers=app
```

The build script automatically:
- Generates a build timestamp
- Passes VERSION and BUILD_DATE as build arguments
- Tags images appropriately based on build type

### Manual Docker Build

If building manually with Docker:

```bash
# Basic build
docker build \
  --build-arg VERSION="1.0.0" \
  --build-arg BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  -t andreasmolnardev/dashwise:stable \
  .

# Multi-platform build
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg VERSION="1.0.0" \
  --build-arg BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  -t andreasmolnardev/dashwise:stable \
  --push \
  .
```

### Development

For local development with docker-compose, version defaults to "0.4-dev" and build date is generated automatically:

```bash
docker-compose up
```

### Viewing Version Information

Users can view the version and build date in the application:
1. Navigate to Settings → General
2. The "App Info" section displays:
   - Application name and icon
   - Version number
   - Build date and time

### Environment Variables

The following environment variables control version information:

- `NEXT_PUBLIC_VERSION`: Application version (default: "0.4-dev")
- `NEXT_PUBLIC_BUILD_DATE`: Build timestamp (default: current timestamp)

These are automatically set during the Docker build process via build arguments.
