# ---- Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable

# Copy root config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy workspace manifests (for caching)
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/integrationskit/package.json ./packages/integrationskit/
COPY apps/web/package.json ./apps/web/

# Install deps
RUN pnpm install --frozen-lockfile

# Copy full source
COPY packages/sdk ./packages/sdk
COPY packages/integrationskit ./packages/integrationskit
COPY apps/web ./apps/web

# Build app
WORKDIR /app/apps/web
RUN pnpm build

# ---- Runner ----
FROM node:20-alpine AS runner
WORKDIR /app

RUN corepack enable

# Copy standalone output (this is key)
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]