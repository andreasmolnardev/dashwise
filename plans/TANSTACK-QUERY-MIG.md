# TanStack Query migration plan

## Goal

Move every frontend request to the backend API behind TanStack Query.

- Use `useQuery` for cacheable reads.
- Use `useMutation` for user-triggered writes.
- Use `QueryClient` for invalidation, optimistic updates, and cache updates.
- Keep WebSocket and SSE connections lifecycle-managed, but write received server state into the query cache.
- Do not use `useEffect` plus local state solely to load backend data.

Static assets and third-party public resources (for example, local font manifests and Iconify metadata) are outside this migration unless they represent application server state.

## Shared conventions

### Provider and defaults

- Keep one `QueryClientProvider` at the web application root.
- Scope authenticated query keys by the active session token or user ID. This prevents a user switch from briefly rendering cached data from the previous session.
- Do not retry 4xx responses. Retry transient network and 5xx failures at most twice.
- Use a non-zero `staleTime` for normal application reads. Override it only for live status data.

### Query keys

- Define stable, feature-owned keys in `apps/web/src/lib/queryClient.ts` (or feature-local key modules as the list grows).
- Keys must include all request inputs that affect the result: authenticated session, route ID, filters, pagination, and search terms.
- Mutations must invalidate or update every affected key in `onSuccess`.

### Hooks

- Prefer feature-specific hooks with useful names, such as `useLinksCollections`, `useMonitor`, and `useNewsFeed`.
- Use `apps/web/src/hooks/useApiQuery.ts` for simple authenticated reads.
- Use `apps/web/src/hooks/useApiMutation.ts` for authenticated writes.
- Keep request payload construction in a component or a focused feature hook; do not create generic stringly typed API dispatchers.

## Current progress

Completed:

- [x] Install `@tanstack/react-query`.
- [x] Add the root `QueryClientProvider`.
- [x] Configure retry, stale-time, and session-scoped key conventions.
- [x] Migrate page-configuration reads in `usePageConfig`.
- [x] Migrate News sidebar reads and saved-list deletion.
- [x] Migrate authenticated token validation in `AuthWrapper`.
- [x] Add reusable authenticated query and mutation hooks.

## Feature migration checklist

### 1. Authentication and app bootstrap

- [ ] Migrate app-config reads in login, signup, and welcome screens.
- [ ] Convert login, signup, password change, account deletion, and user-property updates to mutations.
- [ ] Replace wallpaper API blob loading with a query when the source is an authenticated API URL.
- [ ] Clear or remove session-scoped cached data on logout.

### 2. Dashboard and widgets

- [ ] Migrate page integration data and app-info reads.
- [ ] Migrate home links, link groups, search items, and widget consumer-data reads.
- [ ] Convert dashboard configuration and link-order updates to mutations with targeted cache updates.
- [ ] Treat polling/status widgets as `useQuery` with `refetchInterval`, not bespoke effect timers.
- [ ] Ensure widget preview requests use unique preview-input query keys.

### 3. Links

- [ ] Migrate collections, folders, tags, and link-item reads.
- [ ] Migrate list and tag detail routes with route-parameter query keys.
- [ ] Convert create, update, delete, reorder, and folder-icon actions to mutations.
- [ ] Invalidate affected collection, folder, tag, and home-link keys after writes.

### 4. Monitoring

- [ ] Migrate monitor lists, monitor detail, status, history, and host reads.
- [ ] Migrate SSH host and session reads while preserving stream/session cleanup.
- [ ] Convert monitor, host, SSH-host, notification-topic, and status updates to mutations.
- [ ] Replace manually scheduled status/history reloads with query polling where appropriate.

### 5. News

- [ ] Migrate `NewsDashboard` feed, subscription JSON, saved article, and metadata reads.
- [ ] Convert feed/subscription CRUD, refresh, save, delete, and read-state writes to mutations.
- [ ] Reuse the existing News sidebar keys instead of duplicating caches.

### 6. Notifications

- [ ] Migrate topics, topic tokens, forwarders, and notification-item reads.
- [ ] Convert topic, token, forwarder, and mark-read operations to mutations.
- [ ] Have activity WebSocket events update or invalidate notification query keys.

### 7. Settings and integrations

- [ ] Migrate widgets, glanceables, locations, integrations, and integration-debug reads.
- [ ] Convert integration CRUD, upload wallpaper, run icon pull, page updates, and preference changes to mutations.
- [ ] Move endpoint test/debug execution to mutations; avoid caching secret-bearing request payloads.

## Streaming and external requests

- [ ] Keep WebSocket/SSE connection ownership in providers/hooks, not in query functions.
- [ ] On stream snapshots or events, use `queryClient.setQueryData` or targeted invalidation.
- [ ] Review each direct `fetch()` call. Backend API calls must migrate; public static assets and intentional third-party requests must be documented in code.

## Verification and exit criteria

- [ ] `rg` finds no direct backend API `fetch()` calls outside the shared API transport.
- [ ] Every `apiClient` action caller is either a query function, a mutation function, or an intentional stream adapter.
- [ ] `rg` finds no effect that only fetches backend data and stores it in local state.
- [ ] Each mutation has cache-update or invalidation coverage.
- [ ] Auth/session changes cannot expose another user's cached data.
- [ ] Focused lint passes for each migrated feature.
- [ ] Production Vite build passes.
- [ ] Add targeted tests for query-key construction, mutation invalidation, and session cache separation where the project test setup supports them.
