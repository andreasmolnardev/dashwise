FROM alpine:3.22 AS shoutrrr
ARG SHOUTRRR_VERSION=0.8.0
ARG TARGETARCH

RUN case "${TARGETARCH}" in \
      "arm64") ARCH="arm64" ;; \
      "amd64") ARCH="amd64" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    apk add --no-cache wget && \
    wget -O /tmp/shoutrrr.tar.gz "https://github.com/containrrr/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_linux_${ARCH}.tar.gz" && \
    tar -xzf /tmp/shoutrrr.tar.gz -C /usr/local/bin shoutrrr && \
    rm /tmp/shoutrrr.tar.gz && \
    chmod +x /usr/local/bin/shoutrrr

FROM oven/bun:1-alpine AS web-deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/web/package.json ./apps/web/
COPY packages/integrationskit/package.json ./packages/integrationskit/
COPY packages/app-icon/package.json ./packages/app-icon/
COPY packages/assets/package.json ./packages/assets/
COPY packages/api-types/package.json ./packages/api-types/
COPY packages/types/package.json ./packages/types/
COPY packages/integration-example-rest/package.json ./packages/integration-example-rest/
COPY packages/integrations-sdk/package.json ./packages/integrations-sdk/
COPY packages/integrations/homeassistant/package.json ./packages/integrations/homeassistant/
COPY packages/integrations/groovewise/package.json ./packages/integrations/groovewise/
COPY packages/integrations/jellyfin/package.json ./packages/integrations/jellyfin/
COPY packages/integrations/music-assistant/package.json ./packages/integrations/music-assistant/
RUN bun install --frozen-lockfile

FROM web-deps AS web-build
WORKDIR /app
COPY . .
RUN bun run --cwd packages/assets build
RUN bun run --cwd apps/web build

FROM golang:1.26-alpine AS backend-build
WORKDIR /src
COPY apps/backend/go.mod apps/backend/go.sum ./apps/backend/
COPY packages/foundation/go.mod ./packages/foundation/go.mod
COPY packages/assets/go.mod ./packages/assets/go.mod
WORKDIR /src/apps/backend
RUN go mod download
WORKDIR /src
COPY . .
WORKDIR /src/apps/backend
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/dashwise ./cmd/dashwise

FROM alpine:3.22
ARG DASHWISE_VERSION=dev
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata && \
    mkdir -p /data /app/public

COPY --from=backend-build /out/dashwise /usr/local/bin/dashwise
COPY --from=web-build /app/apps/web/dist /app/public
COPY --from=shoutrrr /usr/local/bin/shoutrrr /usr/local/bin/shoutrrr

ENV ENVIRONMENT=production \
    DASHWISE_VERSION=${DASHWISE_VERSION} \
    PORT=3000 \
    DATA_DIR=/data \
    DATABASE_PATH=/data/dashwise.sqlite \
    WEB_DIST=/app/public \
    SHOUTRRR_BINARY_PATH=/usr/local/bin/shoutrrr

EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/dashwise"]
