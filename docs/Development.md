# Development

Dashwise is a Bun monorepo with a React/Vite web app, a Bun/Hono backend, and PocketBase for persistence. Use Bun commands for local development and Docker Compose for containerized development or test runs.

## Prerequisites

- Bun, matching the version in `package.json` when possible.
- Docker with Docker Compose v2 for containerized development and test environments.
- `tmux` is optional. The test environment script uses it when available.

Install dependencies from the repository root:

```sh
bun install
```

## Local Bun Development

Run the backend and web app together from the repository root:

```sh
bun run dev
```

This starts:

- Backend API from `apps/backend` with Bun hot reload.
- Web app from `apps/web` through Vite on port `5173`.

Useful local commands:

```sh
bun run dev:backend
bun run dev:web
bun run build
bun run lint
```

The web build regenerates OpenAPI and API SDK output before running Vite:

```sh
bun --cwd apps/web run build
```

The backend build runs TypeScript compilation:

```sh
bun --cwd apps/backend run build
```

## Docker Development Stack

Use `docker-compose.dev.yaml` when you want the development app to run inside Docker with source files mounted into the container:

```sh
docker compose -f docker-compose.dev.yaml up --build
```

The dev stack exposes:

- App/API: `http://localhost:3000`
- Vite dev server: `http://localhost:5173`
- PocketBase: `http://localhost:8090`

The dev compose file uses `.env.dev`, mounts the repository into `/app`, and persists dependency folders in Docker volumes so installs do not overwrite the host workspace.

Restart the running dev stack:

```sh
docker compose -f docker-compose.dev.yaml restart
```

Stop the dev stack:

```sh
docker compose -f docker-compose.dev.yaml down
```

Rebuild after Dockerfile, dependency, or base image changes:

```sh
docker compose -f docker-compose.dev.yaml up --build
```

Force a clean image rebuild without cache:

```sh
docker compose -f docker-compose.dev.yaml build --no-cache
docker compose -f docker-compose.dev.yaml up
```

If dependency volumes become stale, remove them with the stack down:

```sh
docker compose -f docker-compose.dev.yaml down -v
docker compose -f docker-compose.dev.yaml up --build
```

## Scripted Test Environment

The fastest way to launch a disposable production-like test environment is:

```sh
bun run dev:testenv
```

This runs `scripts/dev-testenv.sh`. The script:

- Reads `docker-compose.test.yaml`.
- Writes a generated `docker-compose.test.testenv.yaml` with free local ports for the app and PocketBase.
- Starts Docker Compose with `up --build`.
- Waits for `GET /api/v1/appConfig` to become available.
- Creates or reuses a default test user.
- Opens the app with a login token.

Default test credentials:

```text
Email: testenv@dashwise.local
Password: DashwiseTestenv123
```

If `tmux` is installed, the script starts Compose in a `dashwise-testenv` tmux session. Attach to it with:

```sh
tmux attach -t dashwise-testenv
```

Stop the scripted test environment by pressing `Ctrl+C` in the terminal that launched `bun run dev:testenv`. The script traps exit and runs Compose down for the generated file.

If cleanup is needed manually:

```sh
docker compose -f docker-compose.test.testenv.yaml down --remove-orphans
```

Rebuild and restart the test environment:

```sh
bun run dev:testenv
```

The script always starts Compose with `up --build`, so code and Docker image changes are rebuilt when it launches.

## Manual Production-Like Compose Test

Use `docker-compose.test.yaml` directly when you need fixed ports instead of the auto-port script:

```sh
docker compose -f docker-compose.test.yaml up --build
```

Default fixed ports:

- App/API: `http://localhost:3016`
- PocketBase: `http://localhost:8093`

Restart it:

```sh
docker compose -f docker-compose.test.yaml restart
```

Stop it:

```sh
docker compose -f docker-compose.test.yaml down --remove-orphans
```

Rebuild it from scratch:

```sh
docker compose -f docker-compose.test.yaml build --no-cache
docker compose -f docker-compose.test.yaml up
```

## Verification

There are currently no dedicated unit test scripts in the root or app `package.json` files. Use these checks before opening or merging changes:

```sh
bun --cwd apps/backend run build
bun --cwd apps/web run build
bun --cwd apps/web run lint
```

For full workspace builds where package build scripts exist:

```sh
bun run build
```

When API routes or schemas change, make sure generated OpenAPI/API SDK output is refreshed by running the web build or:

```sh
bun run generate:openapi
bun run generate:api-sdk
```
