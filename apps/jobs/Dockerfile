FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Root config (REQUIRED)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Workspace manifests (for caching)
COPY packages/sdk/package.json ./packages/sdk/
COPY apps/jobs/package.json ./apps/jobs/

# Install deps
RUN pnpm install --frozen-lockfile

# Copy actual source
COPY packages/sdk ./packages/sdk
COPY apps/jobs ./apps/jobs

WORKDIR /app/apps/jobs

EXPOSE 3001

CMD ["pnpm", "start"]