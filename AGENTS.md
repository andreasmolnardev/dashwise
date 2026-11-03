# Agent Guidance for dashwise-next

This is a Bun monorepo with a React/Vite frontend and a Go backend. The Go server is the source of truth for API behavior and persistence.

## Project layout

- `apps/web` — the retained React SPA and Vite build.
- `apps/backend/cmd/dashwise` — Go server entry point.
- `apps/backend/internal` — Go API, domain, runtime, storage, and background job packages.
- `apps/backend/openapi.yaml` — API contract used to generate client types.
- `packages` — shared frontend and integration SDK packages, Go assets, and shared types.
- `pocketbase` — legacy migration material; do not add new PocketBase-backed behavior.

## Working guidance

- Use Bun for monorepo dependency and frontend workflows. Go work belongs in `apps/backend` and Go modules under `packages`.
- Implement new API and persistence behavior in Go. Do not add new routes or features to the retired TypeScript/Hono backend under `apps/backend/src`.
- Keep the current user-facing frontend in `apps/web`; use shared packages when a change serves both the app and integration authors.
- Update `apps/backend/openapi.yaml` and generated client artifacts when API contracts change.
- SDK integrations are TypeScript packages in `packages/integrations`; their trusted bundles run in the Go JavaScript runtime. YAML integrations use the Go YAML runtime.
- Treat resources as the common data layer. Views, widgets, search, and app screens should query resources where that preserves the product behavior.
- New persistent data uses the Go SQLite database and its migrations. Do not add PocketBase migrations for new features.
- Follow `design.md` for frontend UI work.
- When working with OpenClaw, also follow [.agents/openclaw/INSTRUCTIONS.md](.agents/openclaw/INSTRUCTIONS.md).

## Useful commands

- `bun install`
- `bun run dev`
- `bun run build`
- `go build ./...` from `apps/backend`
- `go vet ./...` from `apps/backend`
