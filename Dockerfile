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

FROM alpine:latest AS shoutrrr
ARG SHOUTRRR_VERSION=0.8.0
ARG TARGETARCH

RUN apk add --no-cache wget

RUN case "${TARGETARCH}" in \
      "arm64") ARCH="arm64" ;; \
      "amd64") ARCH="amd64" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    wget -O /tmp/shoutrrr.tar.gz https://github.com/containrrr/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_linux_${ARCH}.tar.gz && \
    tar -xzf /tmp/shoutrrr.tar.gz -C /usr/local/bin shoutrrr && \
    rm /tmp/shoutrrr.tar.gz && \
    chmod +x /usr/local/bin/shoutrrr

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

RUN rm -rf apps/web/dist apps/backend/dist && \
    bun run --cwd apps/web build && \
    mkdir -p apps/backend/dist/public && \
    cp -R apps/web/dist/. apps/backend/dist/public/ && \
    bun run --cwd apps/backend build && \
    bun build apps/backend/src/index.ts --target=bun --outdir=apps/backend/dist

# Prune to production deps only
RUN bun install --production --frozen-lockfile

FROM deps AS dev
WORKDIR /app

COPY --from=pocketbase /usr/local/bin/pocketbase /usr/local/bin/pocketbase
COPY --from=shoutrrr /usr/local/bin/shoutrrr /usr/local/bin/shoutrrr
ENV PB_BINARY_PATH=/usr/local/bin/pocketbase
ENV ENVIRONMENT=dev

RUN touch /app/.root.ind

COPY . .

EXPOSE 3000 5173 8090
CMD ["bun", "--hot", "--cwd", "apps/backend", "src/index.ts"]

FROM oven/bun:1-alpine
WORKDIR /app/apps/backend

COPY --from=pocketbase /usr/local/bin/pocketbase /usr/local/bin/pocketbase
COPY --from=shoutrrr /usr/local/bin/shoutrrr /usr/local/bin/shoutrrr
ENV PB_BINARY_PATH=/usr/local/bin/pocketbase
ENV NODE_PATH=/app/apps/backend:/app/packages
ENV ENVIRONMENT=production

RUN mkdir -p /app && touch /app/.root.ind

COPY --from=build /app/apps/backend/dist     /app/apps/backend/dist
COPY --from=build /app/apps/backend/openapi.yaml /app/apps/backend/openapi.yaml
COPY --from=build /app/apps/backend/package.json /app/apps/backend/package.json
COPY --from=build /app/pocketbase/migrations /app/pocketbase/migrations
COPY --from=build /app/node_modules          /app/node_modules
COPY --from=build /app/packages              /app/packages

EXPOSE 3000 8090
CMD ["bun", "dist/index.js"]
