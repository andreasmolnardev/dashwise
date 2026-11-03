# Dashwise resource and view architecture: implementation plan

## Goal

Migrate the full capabilities of Dashwise to a reusable, embeddable application data platform. Applications and integrations provide data; everything that displays or consumes it is a view. The platform supplies schema-as-code, migrations, identity and authorization context, typed queries and mutations, and live subscriptions. The migration target is feature parity across the current app, integrations, settings, clients, and operational flows; vertical slices validate the architecture and do not reduce that target.

This plan assumes a Go backend, a React frontend, and a separately packaged Go data platform. It does not assume a new storage engine: SQLite is the initial durable backend. The TypeScript integration SDK remains supported through a defined runtime boundary. Production account/data transfer from the current `dashwise-fat` app to `godashwise` is intentionally a late phase, after the new application model and import target have settled.

## Agreed architecture

- **Data platform:** a standalone Go module with generic schemas, migrations, storage interfaces, auth context, registered functions, query execution, and subscriptions. It has no Dashwise-specific resource types.
- **Storage:** SQLite is the embedded source of truth. SQLite-backed cache tables support rebuildable/expiring data such as News articles. Redis remains optional for shared cache or fan-out needs. Filesystem storage holds blobs.
- **Dashwise domain:** Links, Monitoring, News, Activities, and Notifications retain their own domain models and lifecycle. Resources, activities, and notifications are separate concepts.
- **Resources:** provider-owned, schema-defined records with identity, access policy, freshness, retention, and declared capabilities.
- **Shortcuts:** shortcuts are resources, not a parallel data model. A resource may declare shortcut/launch capabilities and actions; Search and named Apps are views over eligible shortcut resources.
- **Views:** every consumer of data is a view. Dashboard pages compose views; widgets are compact views; Search, Frames, and app pages are views. The News app is a view over News feed-item resources; its sidebar supplies typed query parameters/filters. Feed fetching, subscription management, and saved-article state remain backend domain services/data, separate from the News presentation.
- **Monitoring:** keep the Monitoring app as views over resources that declare the monitoring capability and provide the fields needed by the shared Monitoring presentations. Integrations such as Beszel configure and expose their servers as those resources. Remove Dashwise's built-in SSH client/host-management feature; do not remove the rest of Monitoring.
- **Query contract:** a versioned JSON view/query specification, validated and executed by the backend. HTTP/OpenAPI is the portable API contract; generate the TypeScript client and Go types/validators from shared schemas.
- **Search:** frontend UI in the web app; Dashwise resource participation and routes in the backend; generic query/index APIs in the data platform; SQLite FTS as the initial derived index.
- **Frames:** a frontend big-screen display mode over saved views. Backend persists configuration and enforces access; Frames do not get a separate data model.
- **Integrations:** YAML remains a first-class lightweight option for straightforward REST integrations. TypeScript SDK integrations are the preferred path for richer integrations that need protocol clients, persistent connections, lifecycle management, actions, or non-trivial transformation. Both authoring paths feed the same resource/provider contract and shared views; YAML is not merely a temporary compatibility format. Use a versioned local protocol if the Go backend hosts TypeScript integrations separately.

## Target repository shape

```text
apps/
  backend/                    # Go · Dashwise API and domain registration
    cmd/dashwise/main.go
    internal/
      app/                     # wiring, config, startup and shutdown
      domains/{links,monitoring,news,activities,notifications}/
      integrations/            # Dashwise provider registry and instances
      views/                   # saved Dashwise view definitions
      search/                  # Dashwise search participation and routes
      jobs/                    # polling, ingestion, cleanup, indexing
    go.mod
  web/                         # React · app surfaces, views, Frames, Search
  integration-host/            # Bun · optional host for TS integration SDK

packages/
  data-platform/               # standalone Go module
    schema/ auth/ functions/ query/ subscriptions/ storage/
    drivers/sqlite/ cache/redis/ transport/
    go.mod
  contracts/                   # OpenAPI and JSON Schemas, language-neutral
  api-client/                  # generated TypeScript client
  view-renderers/              # shared safe renderers for views and widgets
  ui/                          # only components shared beyond apps/web
  integrations-sdk/            # TypeScript SDK authoring API
  integrations/                # first-party TypeScript integrations

pocketbase/                    # migration bridge, removed at migration end
```

Keep one Go module for `packages/data-platform` and one for `apps/backend`; do not create a Go module per internal package. The target layout can be reached incrementally.

## Phased implementation

### Branching and parallel work strategy

- Create `go-migration` from the committed `sdk-integrations` baseline. The current checkout is on `sdk-integrations`, but it has substantial uncommitted SDK/app work; decide which of that work belongs in the baseline, then commit or otherwise preserve it before creating the branch. Do not let unrelated in-progress changes silently become part of the migration branch.
- Keep `go-migration` as the integration branch. Give each substantial parallel workstream an isolated worktree/branch based on that migration branch, then merge reviewed results back through the integration owner.
- Start implementation at the bottom of the dependency chain: data-platform storage contract and SQLite driver, then schema/migrations and the higher-level platform services. Do not start every consumer against a moving database API.
- Freeze the first usable storage, auth-context, ViewSpec, and provider-protocol contracts before broad delegation. Build a small end-to-end vertical slice to prove them.
- After the contracts and vertical slice are accepted, parallelize independent work: frontend view shell/renderers, individual domain adapters, integrations-host protocol implementation, and docs/operations. Assign file/package ownership to avoid multiple workers editing the same integration points.
- Keep one integrator responsible for API compatibility, migration sequencing, final wiring, and conflict resolution. Merge each workstream incrementally and reconcile with the integration branch before expanding its scope.
- Do production export/import and account transfer late, once the target data model is stable; implement the exporter in `dashwise-fat` and importer in `godashwise` as separate deliverables.

### 0. Inventory current behavior and migration constraints

- Map current PocketBase collections, auth/session behavior, API routes, scheduled jobs, integrations, websocket events, backups, and media storage to the target domains.
- Record which data is user-owned, integration-owned, derived/cache-only, append-only, or expiring.
- Document compatibility requirements for current frontend clients, YAML integrations, SDK integrations, and Frame Companion.
- Define the initial deployment boundary: single-node, embedded SQLite, one Dashwise backend process, while retaining the full current capability set as the migration target.
- Build a feature-parity inventory covering every current app surface, user flow, integration capability, API/client, scheduled job, notification path, backup/restore flow, and admin operation. Track each as migrated, intentionally redesigned with equivalent capability, or explicitly retired with a product decision.

**Exit:** a full feature-parity inventory and data ownership/retention map exist; no records are assigned to a generic resource store by default, and no current capability is silently dropped.

### 1. Freeze portable contracts

- Add shared schemas for resource identity, collection declarations, ViewSpec/query requests, paginated responses, actions, and the integration-host protocol.
- Define a limited query language: registered source/type, typed filters, sort, field projection, bounded pagination, and only a few necessary aggregates.
- Define user/principal context and access policy hooks. Do not allow browser clients to submit SQL or arbitrary code.
- Define live-update semantics: initial snapshot revision/cursor, updates/removals, reconnect behavior, and authorization scope.
- Generate Go and TypeScript API contracts from OpenAPI/JSON Schema instead of maintaining handwritten duplicates.

**Exit:** a frontend can resolve a saved view and receive a typed, authorized, paginated response using the published contract.

### 2. Build the reusable Go data platform on SQLite

- Create `packages/data-platform` as an independently buildable module.
- Implement the storage API and SQLite driver: transactions, schema versioning, migrations, typed collections/documents, indexes, and backup-safe startup/shutdown.
- Add declarative schema registration and versioned Go migration functions. Keep JavaScript migration support out of the first release unless cross-language migration authoring becomes a firm requirement.
- Add identity/session interfaces and a built-in auth implementation sufficient for the first app, with configurable identity providers and application-defined authorization policies.
- Add registered query/mutation/action functions, argument validation, request-scoped auth context, and the ViewSpec query executor.
- Add a durable change/outbox mechanism and subscriptions. Keep live delivery separate from append-only Activities.
- Add generic full-text index interfaces and a SQLite FTS implementation. Indexes are derived and rebuildable.
- Add expiry metadata and cleanup for cache collections. Implement Redis only behind cache/fan-out interfaces if a concrete deployment need is confirmed.

**Exit:** a small example application can use the library without importing Dashwise packages, configure its schema in code, apply migrations, authenticate, read/write, and subscribe to changes.

### 3. Stand up the Go Dashwise backend alongside the current backend

- Create the Go API process and register the data platform, Dashwise auth adapter, domain functions, providers, routes, and jobs.
- Keep PocketBase behind a temporary compatibility adapter for the existing installation. Use development/test identities while building the new backend; do not make production account or session migration a prerequisite for the core architecture work.
- Define the local protocol for the Bun integration host: instance lifecycle, resource sync, actions, events, secret access, cancellation, and failure reporting.
- Add import/export and backup/restore paths before migrating production data.

**Exit:** Go backend can run locally, serve one migrated vertical slice, and coexist without conflicting with the current service.

### 4. Prove the model with vertical slices

Migrate domains in increasing complexity, keeping existing URLs or redirects where practical:

1. **Links and Shortcuts:** user-managed link resources and provider-owned shortcut resources, relationships, launch/action capabilities, Search, App/list/detail views.
2. **News:** subscription provider jobs, deduplicated News feed-item resources, expiring SQLite cache tables, and stale-cache behavior after fetch failures. Implement the News app as a view whose sidebar selections become typed query filters over those resources; keep subscription management and saved-article state in their domain services.
3. **Monitoring:** shared Monitoring views over native or integration-provided monitoring resources, including Beszel servers mapped to the required resource properties; current state, high-volume metric history, live subscriptions, and alert actions remain in scope. Keep time-series storage separate if resource snapshots do not meet query/retention needs. Retire Dashwise's built-in SSH host/client feature and record its removal in the parity inventory.
4. **Notifications and Activities:** implement separate lifecycle and storage contracts; verify expiry/read/delivery behavior for notifications and append-only behavior for Activities.

These are implementation slices, not a reduced MVP scope. Continue through every retained item in the feature-parity inventory, including onboarding, all settings, all integration surfaces and lifecycles, Frame Companion/device flows, backups, administration, and deployment behavior. The Media Player is an explicit retirement; any unrelated media handling must be inventoried separately. Each slice should be usable end-to-end from the new frontend client before its old path is retired; do not declare the migration complete until all retained capabilities are covered or a capability has an explicit replacement/retirement decision.

### 5. Convert the frontend to views

- Add `packages/api-client` and generated view/query types from shared contracts.
- Build shared view hooks for resolving definitions, pagination, loading/error states, and live subscriptions.
- Generalize current IntegrationsKit renderers into `packages/view-renderers`; keep rendering declarative and data-only.
- Convert dashboard pages into saved view compositions and widgets into compact view configurations.
- Implement Search UI as a view over opted-in resource types.
- Implement Frames as frontend kiosk/big-screen layouts over saved views, with backend-managed access for any non-interactive display token.
- Migrate Links, News, and Monitoring screens to use the same view/query path; retain app-specific editing forms and domain actions.

**Exit:** every data-consuming frontend surface uses the view API, with no app-specific direct query path remaining for migrated domains.

### 6. Migrate integrations and retire legacy paths

- Implement native providers through the same resource API used by SDK providers.
- Keep YAML as the low-friction declarative path for simple REST fetching, mapping, and resource contributions; adapt its existing definitions to the shared provider/resource contract and retain a compatibility renderer during transition.
- Keep TypeScript SDK integrations as the preferred path for protocols and integrations that need managed clients, persistent connections, lifecycle behavior, richer actions, or substantial transformation. Run them through the local integration-host protocol if needed.
- Ensure YAML and TypeScript integrations can both contribute to the same resource types and views without creating separate frontend data paths.
- Migrate SDK resource persistence, Search participation, and live updates to the shared platform.
- Migrate remaining settings and user preferences through the same domain import/export contract.
- Build the production transfer path as a separate late-stage deliverable: a versioned export flow/modal in current `dashwise-fat` and an import flow in `godashwise` (with a CLI option for recovery/automation if useful).
- Include a dry-run/report phase, schema-version conversion, ID/reference remapping, validation, and explicit conflict handling before writing imported records.
- Treat passwords, TOTP secrets, integration secrets, session tokens, and device sessions as a separate sensitive credential-transfer policy. Do not import active sessions by default; require re-authentication in `godashwise`. Support encrypted secret export or re-entry rather than placing plaintext secrets in a normal export file.
- Keep the old installation available for rollback until import validation and user sign-in are confirmed; then retire PocketBase collections and old Hono routes.

**Exit:** production data is on the new store, current integrations work through the provider contract, and PocketBase is no longer a source of truth.

### 7. Package and release the data platform independently

- Publish versioned Go module releases and document supported storage capabilities, migration guarantees, auth extension points, and backup format.
- Add an example application and compatibility policy for schemas and client contracts.
- Add optional adapters only against demonstrated needs: Redis for multi-process fan-out/cache, alternative storage engines, or external identity providers.

**Exit:** another small Go application can adopt the platform without adopting Dashwise routes, UI, resource types, or integration packages.

## Decisions to finalize before implementation

The architecture is specific enough to start discovery and contract work. These decisions can be settled before the phases that depend on them:

1. **Auth transfer policy (late-stage):** whether local password hashes are portable, how OIDC subjects map, whether TOTP and integration secrets are encrypted in the export or re-entered, and which scoped tokens must be recreated. Active sessions should expire at cutover.
2. **Query boundary:** whether v1 allows only declarative ViewSpec queries or also registered Go query functions. Recommended: both, with browser clients limited to registered functions/ViewSpecs.
3. **Integration execution:** separate Bun host versus retaining a temporary TypeScript backend runtime. Recommended: local versioned protocol, so Go never embeds a second language runtime as a core dependency. Preserve YAML as the simpler REST authoring mode alongside the TypeScript SDK.
4. **Data migration and rollback (late-stage):** export bundle format, downtime window, and whether dual-write is required. Recommended: versioned export/import with dry-run validation and a bounded read-only cutover rather than indefinite dual-write.
5. **Migration order:** which capability slices are implemented first for dependency and risk reasons. Recommended order is Links, News, Monitoring, then Activities and Notifications, while keeping full feature parity as the completion bar.
6. **Platform release promise:** internal reusable module first, or public stable API immediately. Recommended: prove it in Dashwise before promising long-term compatibility to external users.

## Main risks and controls

- **Too much scope at once:** separate the data-platform prototype from the full Dashwise port; migrate one vertical slice at a time.
- **Resource becomes a generic JSON bucket:** require collection schemas, ownership, permissions, retention, and update semantics.
- **Database abstraction leaks:** keep SQLite as the first durable implementation and expose capabilities rather than pretending every backend supports identical features.
- **Search or subscriptions leak private data:** apply authorization inside the platform query/index path and scope subscriptions to the authenticated principal.
- **TypeScript integrations stall the Go port:** define the provider protocol before moving integration execution.
- **Migration threatens user data:** make backup, export/import, migration history, and rollback an early milestone.
