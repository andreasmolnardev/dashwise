# Development

Dashwise is a Bun-managed monorepo with a React/Vite web app (`apps/web`) and a Go backend (`apps/backend`) that persists to an embedded SQLite database. Use Bun for workspace tooling, the web app, tests, and the integration development CLI; use Go tooling for the backend; use Docker Compose for containerized development or test runs.

## Prerequisites

- [Bun](https://bun.sh), matching the version in `package.json` when possible.
- Go 1.26 for the backend (`apps/backend/go.mod`).
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

- Backend API from `apps/backend` (`go run ./cmd/dashwise`) on port `3000`, with the SQLite database created under `./data/`.
- Web app from `apps/web` through Vite on port `5173`. The Vite dev server proxies API requests to the backend.

Useful local commands:

```sh
bun run dev                # Go backend + Vite web app
bun run dev:backend        # Go backend only
bun run dev:web            # Vite web app only
bun run build              # Build every workspace that defines a build script
bun run lint
```

The web build regenerates OpenAPI and API SDK output before running Vite:

```sh
bun --cwd apps/web run build
```

The backend build compiles all Go packages; the entrypoint is `./cmd/dashwise`:

```sh
go build ./...             # from apps/backend
```

## Docker Development Stack

Use `docker-compose.dev.yaml` when you want the development app to run inside Docker with source files mounted into the container:

```sh
docker compose -f docker-compose.dev.yaml up --build
```

The dev stack exposes:

- App/API: `http://localhost:3000`
- Vite dev server: `http://localhost:5173`

The dev compose file uses `.env.dev`, mounts the repository into `/app`, and persists dependency folders in Docker volumes so installs do not overwrite the host workspace. SQLite data lives in the mounted `./dashwise-data` directory (`DATA_DIR=/data`, `DATABASE_PATH=/data/dashwise.sqlite`).

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
- Writes a generated `docker-compose.test.testenv.yaml` with free local ports for the app.
- Starts Docker Compose with `up --build`.
- Waits for `GET /api/v1/appConfig` to become available.
- Creates or reuses a default test user through `/api/v1/auth/signup`.
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

(The compose file also maps port `8093` for the legacy migration stack; the production Go image itself listens only on its own port.)

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

## Migration Tooling

Dashwise ships export/import endpoints for moving account data from the older PocketBase-based app ("Dashwise fat") into a Go-backed instance:

- The Go backend serves authenticated endpoints under `/api/v1/migration/` (`export` and `import`) and re-encrypts sensitive values before writing them to SQLite. See `apps/backend/internal/importexport/README.md` for the archive format.
- The web app exposes this as the account migration archive UI at the Migrate page (`/migrate`), which downloads a JSON archive and imports it into the signed-in account.
- `docker-compose.legacy.yaml` runs the old image alongside a PocketBase container so the old app can produce the export archive against real data.

## Integration Development CLI

The independent Bun integration development CLI is preserved. Run it from the repository root:

```sh
bun run integrations
```

This runs `scripts/integrations-cli.ts` for validating and testing YAML integrations and SDK-based integrations without a running backend; see [Integration Testing CLI](Integration-Testing-CLI.md). The compiled SDK bundles are executed by the Go backend's embedded JS runtime (`apps/backend/internal/jsruntime`), while YAML-based integrations are evaluated by the Go YAML runtime (`apps/backend/internal/yamlruntime`).

## Verification

Checks to run before opening or merging changes:

```sh
bun run test              # Bun tests across workspaces (includes backend TS tests)
bun run typecheck         # TypeScript type checks across workspaces
bun --cwd apps/backend run lint
go vet ./...              # from apps/backend; `go build ./...` as a compile check
```

For full workspace builds where package build scripts exist:

```sh
bun run build
```

`bun run check` combines lint, typecheck, and a generated-artifact diff check. `bun run test:contract` runs the contract smoke script.

When API routes or schemas change, make sure generated OpenAPI/API SDK output is refreshed by running the web build or:

```sh
bun run generate:openapi
bun run generate:api-sdk
```
