
# Dashwise Resource and View Architecture — Revised Migration Plan

## 1. Goal

Migrate Dashwise to a Go backend and a unified resource-driven application architecture.

Applications and integrations expose typed resources. Views provide reusable ways to query and present these resources across Dashboard, Pages, Search, News, Monitoring, Frames, and other application surfaces.

The migration should:

- Preserve all existing functionality unless explicitly retired.
- Replace the current Hono/PocketBase backend with Go and SQLite.
- Establish a unified resource, query, action, and view architecture.
- Support both YAML and TypeScript SDK integrations.
- Reuse existing React frontend components wherever practical.
- Extract a small reusable Go foundation without building an unnecessarily broad application framework.
- Maintain simple single-node deployment as the primary target.
- Support safe migration of existing production data and accounts.
- Allow the architecture to evolve without requiring a rewrite of unrelated applications.

The goal is a resource-driven Dashwise application built on reusable infrastructure, not a general-purpose application platform that happens to contain Dashwise.

The migration target remains full feature parity. Early implementation milestones are architectural validation steps, not reductions to the eventual product scope.

---

## 2. Architectural Principles

### 2.1 Separation of responsibilities

The architecture distinguishes four primary concepts.

#### Resources

Resources are typed entities exposed by Dashwise domains or integrations.

A resource definition declares:

- Stable identity
- Schema
- Ownership
- Access policy
- Capabilities
- Persistence mode
- Freshness requirements
- Retention behavior
- Supported query operations

Resources provide the common discovery and data-access abstraction.

They do not require every resource type to use the same persistence model.

#### Views

Views describe how resources are queried, transformed, and presented.

A view combines:

- Resource source
- Query parameters
- Presentation type
- Presentation configuration
- Optional actions
- Display-specific preferences

Views can be embedded within multiple application surfaces.

Examples:

- A News article list on the News app page
- A compact article list on the Dashboard
- A monitoring chart inside a Frame
- A link collection inside Search

Views must not become a universal application framework.

Application navigation, complex workflows, settings, and domain-specific editing interfaces remain frontend application responsibilities.

#### Actions

Actions represent explicit operations against resources or domain services.

Examples:

- Open a shortcut
- Mark an article as read
- Save an article
- Trigger an integration operation
- Acknowledge an alert
- Refresh a resource

Actions have:

- Stable names
- Typed arguments
- Authorization requirements
- Execution handlers
- Typed results
- Error semantics

Actions execute on the backend or through an authorized integration provider.

#### Services and Jobs

Domain services handle workflows and lifecycle operations that should not be represented as views or generic resources.

Examples:

- RSS subscription management
- Feed fetching and deduplication
- Monitoring metric collection
- Notification delivery
- Activity recording
- Integration lifecycle management
- Background cleanup

Services may produce or update resources but retain their own domain logic.

### 2.2 Resources unify access, not storage

The resource model must not become an unrestricted JSON document store.

Domain-specific storage remains appropriate.

Examples:

- Links: relational records
- News articles: materialized cached records
- Monitoring metrics: specialized time-series tables
- Activities: append-only event records
- Notifications: durable records with delivery and read state
- Weather: potentially on-demand resources

All resource types participate in the same registry and capability system where appropriate.

### 2.3 Single-node architecture first

The initial deployment should consist of:

- One Go backend
- One Bun integration host
- One SQLite database
- Filesystem-backed blob storage
- React frontend assets

Additional infrastructure must be justified by a demonstrated requirement.

Do not introduce Redis, a message broker, distributed workers, or multiple database engines as initial dependencies.

### 2.4 Contract-driven implementation

Stable contracts should exist between:

- Frontend and backend
- Resource providers and Dashwise
- Bun integration host and Go backend
- Saved views and renderers
- Dashwise and the reusable Go foundation

Use OpenAPI and JSON Schema for portable contracts.

Generate TypeScript clients and Go types or validators where practical.

Avoid manually maintaining duplicate API models.

---

## 3. Target Architecture

### 3.1 Frontend — React

The React frontend retains the existing product structure:

- Dashboard
- Pages
- Search
- News
- Links
- Monitoring
- Notifications
- Activities
- Frames
- Settings
- Administration

Frontend responsibilities:

- Navigation and application shells
- View composition
- View rendering
- User interactions
- Forms and dialogs
- Domain-specific workflows
- Optimistic updates where appropriate
- Subscription lifecycle management

Existing frontend components should be reused where practical.

The migration should primarily replace data-access mechanisms rather than unnecessarily redesigning the UI.

### 3.2 Dashwise application backend — Go

The Go backend owns Dashwise-specific concepts.

#### Resource Registry

Responsible for:

- Resource type registration
- Provider registration
- Capability discovery
- Schema lookup
- Resource identity
- Provider ownership
- Resource access policy
- Provider-specific query routing

#### Query Service

Responsible for:

- Validating declarative queries
- Resolving resource sources
- Applying authorization
- Filtering and sorting
- Field projection
- Pagination
- Query execution
- Coordinating on-demand and persisted resources
- Returning standardized query results

Queries must be constrained and typed.

Browser clients must not submit arbitrary SQL or executable code.

Complex queries can be implemented through registered Go query handlers.

Do not implement a general-purpose SQL-like query language initially.

#### View Service

Responsible for:

- Saved view definitions
- View configuration validation
- View ownership and sharing
- Query resolution
- Renderer metadata
- View-specific parameters

The backend handles data and authorization.

The frontend handles presentation.

#### Action Service

Responsible for:

- Action registration
- Input validation
- Permission checks
- Dispatch to native or integration providers
- Result handling
- Error reporting

#### Domain Services

Retain explicit domain implementations for:

- Links
- News
- Monitoring
- Activities
- Notifications
- Other retained product capabilities

Domain services may expose resource types and actions without being reduced to generic resource CRUD.

#### Integration Manager

Responsible for:

- Integration installation and registration
- Integration instances
- Configuration
- Secret management
- Instance lifecycle
- Health reporting
- Provider registration
- Integration-host communication

#### Search

Search remains a Dashwise application capability.

It should use generic resource indexing interfaces where appropriate.

Responsibilities:

- Resource participation
- Permission-aware result filtering
- Full-text search
- Ranking
- Shortcut discovery
- Search-specific actions
- Navigation targets

SQLite FTS is the initial indexing implementation.

#### Jobs

Manage:

- Scheduled ingestion
- Resource synchronization
- Cache expiration
- Cleanup
- Index rebuilding
- Notification processing
- Background maintenance

Jobs should use explicit lifecycle and cancellation mechanisms.

---

## 4. Reusable Go Foundation

Create a small reusable Go module that provides application infrastructure.

Do not include Dashwise product concepts in this module.

### 4.1 Initial responsibilities

The foundation provides:

- SQLite connection and transaction management
- Declarative schema registration
- Versioned migrations
- Typed persistence primitives
- Basic identity and session primitives
- Authorization hooks
- Storage interfaces
- Durable change recording where required
- Event delivery primitives
- Backup-safe database lifecycle

The foundation should remain useful to another small Go application without importing Dashwise packages.

### 4.2 Explicit exclusions

The first version should not implement:

- Dashwise Resource Registry
- ViewSpec execution
- Dashwise presentation definitions
- Integration capability models
- Generic workflow automation
- Arbitrary user-defined functions
- General-purpose expression execution
- Complex cross-collection joins
- Distributed query execution
- Multiple database drivers
- Redis infrastructure
- A complete replacement for every PocketBase feature

### 4.3 Reuse existing primitives

Before implementing the foundation, investigate whether existing Slopstack or PocketBase-based components already provide appropriate persistence, migration, authentication, or authorization primitives.

Avoid maintaining two independently developed libraries with nearly identical responsibilities.

Do not assume existing packages satisfy Dashwise requirements without verifying their APIs and capabilities.

Choose between:

1. Reusing existing foundation components.
2. Extracting shared primitives into a small common package.
3. Implementing only missing Dashwise requirements.

The first vertical slice should inform this decision.

Do not block the prototype on publishing or stabilizing the foundation.

---

## 5. Resource Model

### 5.1 Resource identity

Every resource must have a stable, unambiguous identity.

Identity consists conceptually of:

- Resource type
- Provider instance
- Provider-local identifier

This prevents collisions between multiple instances of the same integration.

Resource identifiers must remain stable across synchronization cycles.

Provider ownership must be enforced during updates and deletion.

### 5.2 Resource persistence modes

Support three resource acquisition modes.

#### Stored

Resources primarily owned and persisted by Dashwise.

Examples:

- User-created links
- User-managed shortcut definitions

Support standard read/write operations subject to access policy.

#### Materialized

Resources synchronized from external providers into local storage.

Examples:

- RSS articles
- Beszel server records
- Integration-discovered devices

Support:

- Incremental synchronization
- Batch upserts
- Deletions or tombstones
- Freshness tracking
- Provider ownership
- Retention policies
- Stale-data handling

Provider synchronization must not overwrite unrelated user-owned state.

#### On-demand

Resources retrieved when requested.

Examples:

- Current weather
- Remote service state
- Other lightweight external queries

Support:

- Fetch timeout
- Cancellation
- Optional caching
- Freshness metadata
- Provider failure reporting

On-demand resources do not require a persisted copy unless explicitly configured.

### 5.3 Resource capabilities

Define an extensible capability system.

Initial capabilities:

- list
- detail
- search
- launch
- actions
- subscribe
- history

Capabilities describe resource behavior, not UI components.

A resource may expose multiple capabilities.

Examples:

A link resource:

- list
- detail
- search
- launch
- actions

A monitoring server resource:

- list
- detail
- subscribe
- history
- actions

A weather resource:

- detail
- subscribe, if supported

The frontend uses capability discovery to determine available interactions.

### 5.4 Ownership and synchronization

Specify ownership at both resource and field level where necessary.

Examples:

- Integration owns server CPU usage.
- User owns the server's custom display name.
- News provider owns article content.
- User owns saved/read article state.

Provider synchronization must not overwrite user-owned fields.

The resource synchronization contract must distinguish:

- Full snapshots
- Incremental updates
- Explicit deletes
- Missing resources
- Provider failure
- Stale provider data
- Provider removal

A failed synchronization must not automatically delete previously known resources.

---

## 6. Query Architecture

### 6.1 Declarative queries

Expose a constrained query specification supporting:

- Registered resource source/type
- Typed filters
- Sort order
- Field selection
- Bounded pagination
- Limited aggregates
- Optional query parameters

Use backend schema validation.

Enforce per-query limits.

### 6.2 Registered queries

Support registered Go query handlers for domain-specific requirements that cannot be represented cleanly with declarative filters.

Examples:

- Monitoring history aggregation
- Specialized News queries
- Complex search ranking

Registered queries must:

- Declare typed arguments
- Apply authorization
- Return typed results
- Support cancellation
- Respect execution limits

### 6.3 Provider query capabilities

Providers may not support every query operation.

The resource registry must declare supported operations.

The backend should not pretend that all resource providers support identical filtering, sorting, or aggregation behavior.

Unsupported operations should produce explicit errors or use a documented bounded fallback.

Avoid unrestricted in-memory scanning of external resources.

### 6.4 Query result contract

Standardize:

- Records
- Schema or type reference
- Pagination cursor
- Freshness information
- Revision or invalidation identifier
- Provider error/stale status where relevant

Do not require every query to expose identical freshness or revision semantics when the provider cannot support them.

---

## 7. View Architecture

### 7.1 View definition

A saved view contains:

- Stable identifier
- Resource/query source
- Query configuration
- Presentation type
- Presentation options
- Optional action bindings
- Owner and access policy

Query definitions and presentation definitions remain conceptually separate.

A view definition should be serializable and versioned.

### 7.2 Initial presentation types

Start with:

- List
- Table
- Cards
- Detail
- Metric
- Chart
- Article list
- Domain-specific renderers where justified

Avoid a universal declarative UI framework.

### 7.3 View reuse

A saved view may be rendered in:

- Dashboard
- Pages
- Apps
- Frames
- Other embedded surfaces

Widgets are compact view configurations.

Different containers may provide presentation overrides without changing the underlying data source.

### 7.4 App-specific interfaces

Do not require complete applications to be expressed as view specifications.

Examples:

News retains:

- Sidebar
- Feed navigation
- Subscription management
- Saved/read workflows

Monitoring retains:

- Specialized metric visualizations
- Alert workflows
- Historical exploration

Search retains:

- Keyboard navigation
- Ranking
- Suggestions
- Command execution

Frames retain:

- Kiosk layout
- Display configuration
- Device pairing and access

These application shells consume the shared query/view infrastructure.

### 7.5 Renderer safety

Renderers are frontend-owned, registered implementations.

Integrations may select declared presentation types and provide validated configuration.

Do not execute arbitrary frontend code supplied through resource data or remote view definitions.

The initial renderer registry should use a small, versioned contract.

---

## 8. Integration Architecture

### 8.1 Authoring models

Retain two first-class integration authoring approaches.

#### YAML integrations

Best suited to:

- Simple REST APIs
- Polling
- Field mapping
- Basic resource contributions
- Straightforward transformations

YAML remains a supported authoring format, not a temporary compatibility layer.

#### TypeScript SDK integrations

Best suited to:

- Stateful protocol clients
- Persistent connections
- WebSocket integrations
- Complex transformations
- Lifecycle management
- Non-trivial actions
- Rich provider behavior

Both authoring approaches produce resources through the same provider contract.

### 8.2 Integration execution

Use a separate Bun integration-host process.

The Go backend must not embed a JavaScript runtime as a core dependency.

Initial topology:

- One Go backend process
- One Bun host process
- Local communication
- Multiple integration instances inside the host

Use a versioned local protocol.

A Unix domain socket is preferred on supported deployments; localhost TCP is an acceptable alternative.

### 8.3 Integration-host protocol

The protocol should support:

- Handshake and protocol version negotiation
- Integration registration
- Instance initialization
- Start/stop/restart
- Configuration updates
- Resource-type registration
- Resource synchronization
- Resource queries where supported
- Action invocation
- Integration events
- Health and error reporting
- Cancellation
- Graceful shutdown

Every request must have explicit correlation and timeout semantics.

Include bounded message sizes and backpressure.

Prefer batched synchronization to excessive per-resource messages.

### 8.4 Persistence ownership

The Go backend owns:

- Persistent resource state
- Integration configurations
- Integration secrets
- Permissions
- Resource indexing
- View definitions

The Bun host owns:

- Protocol clients
- Integration execution
- Polling implementations
- Transformation logic
- Persistent external connections

The host must not receive unrestricted SQLite access.

Provider operations must be authorized according to instance identity and declared capabilities.

### 8.5 Secrets

The integration host should request access to necessary secrets through a scoped mechanism.

Avoid including secrets in resource data, logs, events, exports, or frontend API responses.

Define secret rotation and removal behavior.

### 8.6 Failure behavior

Handle:

- Bun host crashes
- Integration instance crashes
- External API failures
- Rate limiting
- Timeouts
- Invalid provider data
- Partial synchronization
- Backend restarts

A host restart should recover integration instances from backend-owned configuration.

Do not introduce remote execution or distributed integration scheduling in the initial architecture.

---

## 9. Domain Migration

### 9.1 Links and Shortcuts

Use Links as the first native domain slice.

Implement:

- User-managed links
- Provider-owned shortcuts
- Stable identity
- Launch capabilities
- Search participation
- CRUD and domain actions
- List/detail views
- Dashboard embedding

Shortcuts are resources with declared launch capabilities.

Avoid maintaining an unnecessary parallel shortcut data model.

### 9.2 News

News serves as the first complex data lifecycle test.

Implement:

- Subscription management
- Feed ingestion
- Deduplication
- Materialized article resources
- Expiring article cache
- Stale cache behavior
- Saved/read article state
- Feed filtering
- Article list views
- Search participation where appropriate

Keep user-owned read/saved state separate from provider-owned article content.

The News app is an application shell consuming article views.

### 9.3 Monitoring

Monitoring tests integration resources, live data, and specialized historical storage.

Implement:

- Monitoring resource capabilities
- Beszel provider mapping
- Server discovery
- Current status
- Historical metrics
- Specialized aggregations
- Live updates
- Alerts and related actions
- Monitoring app views
- Dashboard widgets

Do not store high-frequency metric history as generic resource snapshots unless performance and retention testing justify it.

Retire Dashwise's built-in SSH client/host-management capability.

Do not retire the Monitoring app itself.

### 9.4 Activities

Maintain a separate append-only activity model.

Activities represent meaningful system/user events.

Do not confuse activity history with internal resource-change notifications.

Implement:

- Event ownership
- Structured payloads
- Retention
- Querying
- Activity views

### 9.5 Notifications

Maintain a specialized notification lifecycle.

Implement:

- Notification generation
- Delivery
- Read/unread state
- Expiration
- Dismissal
- Delivery failures
- Notification views
- Existing notification channels

Notifications should not be reduced to generic resource updates.

### 9.6 Remaining application surfaces

Complete the retained functionality in:

- Dashboard
- Pages
- Search
- Frames
- Frame Companion
- Settings
- Administration
- Onboarding
- Integration management

Retire the Media Player as an explicit product decision.

Inventory other media-related functionality independently before removing anything else.

---

## 10. Search Architecture

Search is a cross-resource Dashwise capability.

### 10.1 Indexing

Use SQLite FTS initially.

Index only resource types that explicitly opt into search.

The indexing process should support:

- Full index rebuilding
- Incremental updates
- Resource deletion
- Provider removal
- Searchable field declarations

### 10.2 Authorization

Search results must respect resource permissions.

Do not rely exclusively on the frontend to filter private results.

Protect both result metadata and record contents.

### 10.3 Search experience

Retain specialized frontend behavior:

- Keyboard-first navigation
- Resource results
- Shortcuts
- Search result ranking
- Navigation and launch actions
- Relevant application routes

Search may internally use shared resource queries but does not need to be represented entirely as a generic saved view.

---

## 11. Live Updates and Subscriptions

### 11.1 Initial approach

Use a shared live-update channel over WebSocket.

Prefer versioned resource/query invalidation notifications and refetching over implementing a universal durable event replay engine.

Clients should support:

- Connection recovery
- Resubscription
- Query invalidation
- Snapshot refresh
- Authorization changes
- Removal events

### 11.2 Delivery guarantees

Different events require different guarantees.

Resource invalidations:

- May be best effort
- Must support recovery through refetching

Durable domain events:

- Use transactional persistence where required
- May use an outbox for reliable delivery

Activities:

- Remain domain-level records
- Are not automatically identical to storage change events

### 11.3 Subscription security

Subscriptions must be scoped to authenticated principals.

Revalidate authorization when permissions change.

Avoid exposing unauthorized resource identifiers or metadata through subscription channels.

---

## 12. Frames

Frames are specialized frontend display surfaces over saved views.

Implement:

- View composition
- Layout management
- Device access
- Display configuration
- Frame Companion compatibility
- Live updates
- Device authentication

The backend persists Frame configuration and enforces access.

Frames do not require a separate generic data platform.

Non-interactive display tokens must be scoped, revocable, and limited to the resources/views required by the display.

Do not expose unrestricted user sessions to kiosk devices.

---

## 13. Repository Structure

Target:

    apps/
      backend/
        cmd/dashwise/
        internal/
          app/
          api/
          auth/
          resources/
          views/
          actions/
          integrations/
          domains/
            links/
            news/
            monitoring/
            activities/
            notifications/
          search/
          jobs/

      web/
        src/
          apps/
          features/
            resources/
            views/
            search/
            integrations/
          components/

      integration-host/

    packages/
      foundation/
      contracts/
      api-client/
      integrations-sdk/
      integrations/
      view-renderers/
      ui/

    migration/
      exporters/
      importers/
      validation/

Use one Go module for the application backend.

Use a separate Go module for the foundation only if genuine independent reuse justifies it.

Do not create separate Go modules for individual domains.

The repository structure can be reached incrementally.

---

## 14. Migration Phases

### Phase 0 — Inventory and Preparation

Objectives:

- Understand existing functionality.
- Establish migration constraints.
- Preserve current development work.

Tasks:

1. Inventory PocketBase collections and relationships.
2. Inventory existing Hono routes.
3. Inventory authentication/session behavior.
4. Inventory scheduled jobs.
5. Inventory websocket events.
6. Inventory integrations and their lifecycle.
7. Inventory current React application surfaces.
8. Inventory configuration, settings, and secrets.
9. Inventory Frames and companion/device flows.
10. Inventory deployment and backup mechanisms.
11. Record data ownership and retention requirements.
12. Identify existing modules that can be reused.

Create a feature-parity matrix.

Every existing capability must be classified as:

- Retained and migrated
- Retained with redesign
- Replaced by equivalent functionality
- Explicitly retired

Branching:

- Preserve the existing `sdk-integrations` working tree.
- Commit or otherwise safely isolate relevant uncommitted work.
- Create `go-migration` from a known baseline.
- Use isolated worktrees for parallel workstreams.

Exit criteria:

- Feature-parity inventory exists.
- Data ownership map exists.
- Compatibility constraints are documented.
- Migration baseline is preserved.

### Phase 1 — Contracts and Vertical Prototype

Build a minimal end-to-end implementation.

Required functionality:

1. Minimal Go API server.
2. SQLite persistence.
3. Resource registry.
4. One native resource type.
5. One TypeScript integration provider.
6. Bun host communication.
7. Resource synchronization.
8. Basic query execution.
9. One saved view.
10. One React view renderer.
11. One authorized action.
12. Basic live invalidation.

Prefer Links plus a simple integration-provided resource.

Do not build the full generic foundation first.

Use the prototype to validate:

- Resource identity
- Provider ownership
- Serialization
- Query contracts
- Integration protocol
- View configuration
- Action execution
- Frontend data flow

Exit criteria:

A resource can be exposed by an integration, synchronized or queried through Go, displayed by React, updated, and invalidated without a domain-specific frontend data path.

The architecture is reviewed before expansion.

### Phase 2 — Extract Foundation and Stabilize Contracts

Tasks:

1. Identify reusable infrastructure from the prototype.
2. Evaluate Slopstack/PocketBase primitive reuse.
3. Extract the minimal Go foundation.
4. Implement migrations and schema management.
5. Establish session/auth interfaces.
6. Stabilize resource and provider contracts.
7. Stabilize ViewSpec v1.
8. Add generated API clients.
9. Add contract tests.
10. Add basic backup/restore mechanisms.

Avoid broad parallel implementation until foundational contracts stabilize.

Exit criteria:

- The Go foundation has no Dashwise domain imports.
- Contracts are versioned.
- Another minimal Go application can use the foundation.
- The vertical prototype continues to pass its tests.

### Phase 3 — Links and News

Implement complete vertical slices.

Links:

- CRUD
- Shortcut capabilities
- Search
- Actions
- Dashboard views

News:

- Feed subscriptions
- Scheduled ingestion
- Article resources
- Deduplication
- Cache retention
- Saved/read state
- Filtering
- Article presentation

Validate both native and integration-managed resource lifecycles.

Exit criteria:

Links and News work end-to-end with the Go backend, including persistence, frontend behavior, access control, and relevant background jobs.

### Phase 4 — Monitoring and Real-Time Infrastructure

Tasks:

1. Implement monitoring resource capabilities.
2. Port Beszel integration.
3. Implement current-state queries.
4. Implement metric history queries.
5. Support historical aggregation.
6. Implement live invalidation/subscriptions.
7. Migrate monitoring frontend.
8. Preserve alert functionality.
9. Validate provider disconnection behavior.
10. Test resource freshness and stale-state handling.

Exit criteria:

Monitoring has functional parity, including historical and live data, without forcing metric history into an unsuitable generic schema.

### Phase 5 — Remaining Application Migration

Migrate:

- Dashboard
- Pages
- Search
- Frames
- Frame Companion
- Activities
- Notifications
- Settings
- Onboarding
- Administration
- Remaining integrations

Migrate existing frontend data access to generated API clients and shared view/query hooks.

Reuse existing UI components.

Preserve routes or provide redirects where practical.

Complete the feature-parity matrix.

Exit criteria:

Every retained product capability works through the Go backend.

All intentionally retired functionality is documented.

### Phase 6 — Production Data Migration

Production data transfer should occur only after the target model is stable.

Develop two separate deliverables:

- Exporter in the current `dashwise-fat` application.
- Importer in `godashwise`.

The transfer must support:

- Versioned export bundles
- Schema-version conversion
- Reference mapping
- ID remapping where necessary
- Validation
- Dry-run reporting
- Conflict handling
- Media/blob transfer
- User preferences
- Integration configurations
- Saved views and layouts

Sensitive data requires a separate policy.

Handle:

- Password hashes
- OIDC identities
- TOTP
- Integration secrets
- API tokens
- Device credentials

Do not import active sessions by default.

Prefer reauthentication after cutover.

Secret export must be encrypted or require credential re-entry.

Do not place plaintext credentials in ordinary export bundles.

Cutover procedure:

1. Back up the current installation.
2. Validate export completeness.
3. Run importer dry-run.
4. Resolve conflicts.
5. Put the old installation into read-only mode.
6. Perform final export.
7. Import into the new backend.
8. Validate record counts and references.
9. Verify sign-in and integrations.
10. Switch traffic to the new installation.
11. Retain the old installation for rollback.

Avoid indefinite dual-write synchronization.

Rollback must be tested before production migration.

Exit criteria:

- Production data is validated in Go/SQLite.
- Users can authenticate.
- Integrations function.
- Frame/device flows are verified.
- Backup and restore are tested.
- PocketBase is no longer a source of truth.

### Phase 7 — Optional Platform Hardening

Only implement based on concrete requirements.

Candidates:

- Independent public foundation releases
- Additional database drivers
- Redis-backed cache/fan-out
- Remote integration execution
- Advanced resource queries
- Additional renderer capabilities
- Stronger integration isolation
- More general application framework primitives

These are not prerequisites for completing Dashwise.

---

## 15. Testing and Acceptance Requirements

### 15.1 Contract tests

Test:

- Resource identity
- Schema validation
- Query compatibility
- Action arguments/results
- Provider protocol versions
- ViewSpec versioning
- Generated client compatibility

### 15.2 Authorization tests

Test:

- Cross-user resource access
- Provider ownership enforcement
- Saved view sharing
- Search result filtering
- Subscription authorization
- Action permissions
- Frame token restrictions

### 15.3 Integration tests

Test:

- Host startup/restart
- Instance lifecycle
- Provider synchronization
- Partial updates
- Deletion handling
- Provider failures
- Timeouts
- Rate limits
- Secret access
- Invalid resource data
- Recovery after crashes

### 15.4 Data integrity tests

Test:

- Schema migrations
- Transaction rollback
- Concurrent updates
- Backup/restore
- Export/import round trips
- Reference preservation
- Retention cleanup
- Cache rebuilding

### 15.5 End-to-end tests

Cover complete user flows for:

- Links
- News
- Monitoring
- Search
- Dashboard editing
- Frames
- Notifications
- Settings
- Integration installation
- User authentication

### 15.6 Performance validation

Test representative workloads for:

- Resource query latency
- Integration synchronization
- Search indexing
- Monitoring history queries
- Large News collections
- Live update fan-out
- Startup and shutdown
- SQLite write contention

Establish performance baselines before replacing the existing implementation.

Avoid speculative performance infrastructure before measuring actual bottlenecks.

---

## 16. Parallel Agent Implementation Strategy

Keep one integration owner responsible for overall architecture and final wiring.

Do not delegate every package simultaneously.

### Initial sequential work

Complete:

1. Inventory
2. Contracts
3. Vertical prototype
4. Contract review
5. Foundation extraction

This reduces conflicting assumptions.

### Parallel work after contract stabilization

Independent workstreams:

**Backend/domain agent**

- Domain migrations
- Query handlers
- Actions
- Jobs

**Frontend agent**

- View renderers
- Shared hooks
- Application migration
- Frame integration

**Integration agent**

- Bun host
- SDK adaptations
- YAML support
- Provider protocol

**Infrastructure agent**

- Migrations
- Authentication primitives
- Backup/restore
- Operations
- Testing

Assign explicit package/file ownership.

Each workstream must:

- Use an isolated worktree
- Follow published contracts
- Add relevant tests
- Avoid unauthorized API changes
- Document compatibility implications

Merge incrementally into `go-migration`.

Do not defer all integration work until the end.

---

## 17. Decisions to Lock Before Broad Implementation

The following decisions should be made and recorded as architecture decision records.

1. **Resource identity:** composite type/provider-instance/local ID model.
2. **Persistence:** stored, materialized, and on-demand modes.
3. **Ownership:** provider-owned versus user-owned fields.
4. **Queries:** constrained declarative queries plus registered Go handlers.
5. **Views:** reusable data presentations, not complete application definitions.
6. **Actions:** explicit typed command contract.
7. **Integration runtime:** one Bun host using a versioned local protocol.
8. **Storage:** SQLite and filesystem as initial sources of truth.
9. **Search:** permission-aware SQLite FTS.
10. **Subscriptions:** invalidation/refetch by default, durable delivery only where required.
11. **Foundation:** minimal reusable infrastructure; defer unrelated platform features.
12. **Frontend:** incremental reuse rather than wholesale redesign.
13. **Migration:** export/import with read-only cutover, not indefinite dual-write.
14. **Release scope:** vertical prototype, complete migration, optional platform expansion.

Production credential-transfer details can be finalized later, before implementing the exporter/importer, but the security requirements must be established early.

---

## 18. Non-Goals

The migration must not expand into:

- A universal no-code application builder
- A general-purpose serverless execution platform
- A distributed integration orchestration system
- A database-agnostic abstraction framework
- A universal declarative frontend language
- A general workflow automation engine
- A replacement for all PocketBase functionality
- A complete frontend redesign
- A publicly stabilized framework API before internal validation

These can be explored as separate future projects.

---

## 19. Definition of Done

The migration is complete when:

1. Dashwise runs on its Go backend.
2. SQLite is the durable primary store.
3. The retained product functionality has parity.
4. Resources have stable identity and explicit ownership.
5. Applications and integrations expose data through the common resource/query model where appropriate.
6. Views can be reused across application surfaces.
7. Domain-specific workflows remain functional.
8. YAML and TypeScript SDK integrations work.
9. Search is permission-aware and resource-driven.
10. Monitoring retains live and historical capabilities.
11. Frames and companion devices function correctly.
12. Existing production data can be imported safely.
13. Authentication and credential migration are handled securely.
14. Backup and restore are verified.
15. Legacy PocketBase and Hono runtime dependencies are retired.
16. The shared Go foundation remains independent of Dashwise-specific models.
17. No retained capability has been silently removed.

Independent publication of the foundation is not required to complete the migration.

---

## 20. Guiding Principle

Dashwise should become a coherent resource-driven application with reusable views, shared query capabilities, and flexible integrations.

The architecture should make it easy to introduce a new resource provider and expose its data across multiple existing application surfaces without writing parallel data-access implementations.

At the same time, it must preserve room for domain-specific behavior and avoid imposing unnecessary abstractions.

**Build and validate the Dashwise architecture first. Extract reusable platform infrastructure where it genuinely reduces duplication. Do not turn the migration into a general-purpose application framework project.**
