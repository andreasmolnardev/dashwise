FROM alpine:latest AS pocketbase
ARG PB_VERSION=0.30.4
ARG TARGETARCH

RUN apk add --no-cache wget unzip

RUN case "${TARGETARCH}" in \
      "arm64") ARCH="arm64" ;; \
      "amd64") ARCH="amd64" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    wget -O /tmp/pocketbase.zip https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip && \
    unzip /tmp/pocketbase.zip -d /usr/local/bin && \
    rm /tmp/pocketbase.zip && \
    chmod +x /usr/local/bin/pocketbase

FROM oven/bun:1-alpine AS deps
WORKDIR /app

# Copy all package.json files for install layer caching
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/web/package.json ./apps/web/
COPY packages/integrationskit/package.json ./packages/integrationskit/
COPY packages/app-icon/package.json ./packages/app-icon/
COPY packages/assets/package.json ./packages/assets/
COPY packages/api-types/package.json ./packages/api-types/
COPY packages/types/package.json ./packages/types/
RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY . .

# Build package assets used by the backend at runtime
RUN bun run --cwd packages/assets build

# Build frontend, then copy output into backend's public dir
RUN bun run --cwd apps/web build

# Ensure the public dir exists and copy frontend dist into it
RUN mkdir -p apps/backend/dist/public && \
    cp -R apps/web/dist/. apps/backend/dist/public/

# Build backend
RUN bun run --cwd apps/backend build

FROM oven/bun:1-alpine
WORKDIR /app

RUN apk add --no-cache valkey

COPY --from=pocketbase /usr/local/bin/pocketbase /usr/local/bin/pocketbase
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENV PB_BINARY_PATH=/usr/local/bin/pocketbase
ENV NODE_PATH=/app/apps/backend:/app/packages

RUN mkdir -p /app && touch /app/.root.ind

COPY --from=build /app/apps/backend/dist     /app/apps/backend/dist
COPY --from=build /app/apps/backend/src      /app/apps/backend/src
COPY --from=build /app/apps/backend/openapi.yaml /app/apps/backend/openapi.yaml
COPY --from=build /app/apps/backend/package.json /app/apps/backend/package.json
COPY --from=build /app/package.json          /app/package.json
COPY --from=build /app/bun.lock              /app/bun.lock
COPY --from=build /app/apps/web/package.json /app/apps/web/package.json
COPY --from=build /app/packages/integrationskit/package.json /app/packages/integrationskit/package.json
COPY --from=build /app/packages/app-icon/package.json /app/packages/app-icon/package.json
COPY --from=build /app/packages/assets/package.json /app/packages/assets/package.json
COPY --from=build /app/packages/api-types/package.json /app/packages/api-types/package.json
COPY --from=build /app/packages/types/package.json /app/packages/types/package.json
COPY --from=build /app/pocketbase/migrations /app/pocketbase/migrations
COPY --from=build /app/packages              /app/packages
COPY --from=build /app/VERSION               /app/VERSION

RUN bun install --production --frozen-lockfile

EXPOSE 3000 8090
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "--cwd", "apps/backend", "start"]
