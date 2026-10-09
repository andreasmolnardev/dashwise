# Activity layer

## Architecture assessment

Dashwise is a Bun monorepo. The Hono API and PocketBase data access live in `apps/backend`; the React dashboard lives in `apps/web`; shared contracts live in `packages/types`; PocketBase collections are managed by migrations in `pocketbase/migrations`.

The backend resolves user sessions with `requireAuth` and uses its privileged PocketBase client for private collections. Notifications have their own records, APIs, read state, and forwarding. The authenticated `/api/v1/activity` WebSocket currently sends notification and calendar snapshots and routes shortcut results. The dashboard's existing `latest-activities` glanceable summarizes unread notifications and calendar events. Neither component is a persistent activity history.

Integration definitions are stored YAML and resolved by the backend. They do not run an extension context today. A typed publisher client can provide the integration capability while the backend verifies the caller's session and integration ownership.

No file-sharing or snippets prototypes were found on `experimental`. No existing activity collection or persistent event service was found.

## Shared contract and boundaries

`packages/types/activity.ts` defines the shared activity record, publish input, filters, and paginated response. Producers submit event details. The backend assigns the owner and source from the authenticated user and integration or trusted internal producer.

Activities and notifications remain separate. Activities store events for history; notifications keep their current attention and read-state behavior. Realtime activity changes reuse the authenticated WebSocket, with a dedicated change signal that lets the frontend refresh activity queries. Existing notification, calendar, and shortcut socket messages remain in place.

The PocketBase activity collection is private to the backend. User routes authenticate before querying and always filter by the authenticated owner. Integration publishing verifies that the integration belongs to that user. Metadata is bounded JSON, and navigation actions are limited to safe in-app targets.

## Activity producers

Internal producers call the shared backend service and handle publishing failures without interrupting their primary work. External integration producers use the typed integrationskit publisher and an integration-scoped API route. Producers should publish meaningful state changes and use event identifiers or idempotency keys where available.

File sharing and snippets remain outside production scope. If those prototypes are introduced later, they can publish metadata about an event through the same service without copying file or snippet contents into activity records.
