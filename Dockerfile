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

FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/web/package.json ./apps/web/
COPY packages/integrationskit/package.json ./packages/integrationskit/
COPY packages/sdk/package.json ./packages/sdk/
RUN bun install --frozen-lockfile

COPY . .
RUN bun --cwd apps/web run build && mkdir -p apps/backend/dist/public && cp -R apps/web/dist/. apps/backend/dist/public/

FROM oven/bun:1-alpine
WORKDIR /app

COPY --from=pocketbase /usr/local/bin/pocketbase /usr/local/bin/pocketbase
ENV PB_BINARY_PATH=/usr/local/bin/pocketbase

COPY --from=build /app /app

EXPOSE 3000
CMD ["bun", "run", "apps/backend/src/index.ts"]
