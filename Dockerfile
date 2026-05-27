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
COPY packages/app-icon/package.json ./packages/app-icon/
COPY packages/assets/package.json ./packages/assets/
COPY packages/api-types/package.json ./packages/api-types/
COPY packages/types/package.json ./packages/types/
RUN bun install --frozen-lockfile

COPY . .
RUN bun --cwd apps/web run build && mkdir -p apps/backend/dist/public && cp -R apps/web/dist/. apps/backend/dist/public/
RUN bun --cwd apps/backend run build
RUN bun install --production --frozen-lockfile
FROM oven/bun:1-alpine
WORKDIR /app/apps/backend

COPY --from=pocketbase /usr/local/bin/pocketbase /usr/local/bin/pocketbase
ENV PB_BINARY_PATH=/usr/local/bin/pocketbase
ENV NODE_PATH=/app/apps/backend:/app/packages
RUN mkdir -p /app && touch /app/.root.ind

# Copy only the runtime artifacts: backend source, built frontend assets, and production deps
COPY --from=build /app/apps/backend/dist /app/apps/backend/dist
COPY --from=build /app/apps/backend/dist/public /app/apps/backend/dist/public
COPY --from=build /app/apps/backend/src /app/apps/backend/src
COPY --from=build /app/apps/backend/package.json /app/apps/backend/package.json
COPY --from=build /app/pocketbase/migrations /app/pocketbase/migrations
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages

EXPOSE 3000 8090
CMD ["bun", "run", "src/index.ts"]
