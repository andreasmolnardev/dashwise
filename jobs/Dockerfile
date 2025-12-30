FROM node:20-alpine

WORKDIR /usr/src/app

# Install runtime deps needed for shoutrrr download
RUN apk add --no-cache curl tar gzip

# Install shoutrrr CLI into /usr/local/bin (multi-arch aware)
RUN set -eux; \
    ARCH="$(apk --print-arch)"; \
    case "$ARCH" in \
        x86_64)  SHOUTRRR_ARCH="linux_amd64" ;; \
        aarch64) SHOUTRRR_ARCH="linux_arm64" ;; \
        *) echo "Unsupported architecture: $ARCH" && exit 1 ;; \
    esac; \
    RELEASE_URL="$(curl -s https://api.github.com/repos/nicholas-fedor/shoutrrr/releases/latest \
        | grep -o "https://[^\"]*${SHOUTRRR_ARCH}[^\"]*\\.tar\\.gz")"; \
    if [ -z "$RELEASE_URL" ]; then \
        echo "Failed to find shoutrrr release for ${SHOUTRRR_ARCH}" && exit 1; \
    fi; \
    curl -L "$RELEASE_URL" | tar -xz -C /usr/local/bin; \
    chmod +x /usr/local/bin/shoutrrr

# Put workdir/bin on PATH
ENV PATH="/usr/src/app/bin:${PATH}"

# Remove build-only deps
RUN apk del curl tar gzip

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci

# Copy application source
COPY . .

EXPOSE 3001

CMD ["npm", "start"]
