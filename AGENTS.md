# Agent Guidance for dashwise-next

This repository is a Bun-based monorepo for `dashwise`, a self-hosted homelab dashboard and workspace app.

## What this project is

- A self-hosted dashboard app for managing links, widgets, notifications, integrations, and workspace data.
- Built as a monorepo with multiple packages, frontend and backend apps, and a PocketBase-backed data store.
- The project is still under active development and uses modern Bun tooling rather than Node.js package managers.

## Key technologies

- `bun` for package management, runtime, and task scripts.
- `React` for the frontend UI in `apps/web`.
- `Hono` for the backend API layer in `apps/backend`.
- `PocketBase` for the backend database, auth, and persistence in `pocketbase/`.
- `TypeScript` throughout the repo.
- `Vite` for frontend bundling in the web app.

## Repository layout

- `apps/web` — React/Vite frontend app.
- `apps/backend` — Bun/Hono backend API app.
- `packages` — shared libraries and SDK code.
- `pocketbase` — PocketBase schema, migrations, and initialization logic.

## What agents should know

- Use `bun` commands for install and dev flows: `bun install`, `bun run dev`, etc.
- Treat this as a Bun monorepo, not a Node.js/npm project.
- Keep API work in `apps/backend` and frontend work in `apps/web` unless a cross-cutting change is needed.
- Avoid introducing new package managers or build systems.
- Prefer modifying existing shared packages in `packages/` when changes affect both apps.
- Preserve PocketBase migration structure in `pocketbase/migrations` when updating schema or collection configuration.
- Use design.md standars for designing uis.

## Useful commands

- `bun install`
- `bun run dev`
- `bun run build` (for app-specific build scripts)

## Notes for automated tooling

- The app is not Next.js; it is a Bun-powered React SPA with a separate Bun/Hono backend.
- Backend routes and request handling are implemented with Hono.
