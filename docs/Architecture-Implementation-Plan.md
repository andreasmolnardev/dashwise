
# Dashwise — Revised Architecture and Migration Plan

## 1. Vision and Goals

Dashwise remains a self-hosted homelab dashboard and central hub for self-hosted services.

Its primary purpose is to provide a unified, customizable interface for accessing, monitoring, organizing, and interacting with the services and information in a user's homelab.

The migration must preserve this identity.

Dashwise should not become a generic data management application or no-code platform. Instead, its existing applications, dashboard widgets, search, integrations, and other features should be powered by a coherent resource-centric architecture.

### Core architectural concept

Dashwise manages structured resources.

Resources originate from native Dashwise functionality, users, and external integrations.

These resources can be:

- Queried and filtered
- Displayed through reusable views
- Used by specialized applications
- Exposed through external APIs and feeds
- Acted upon through registered actions
- Subscribed to for live updates
- Processed by domain services and background jobs

Integrations extend both sides of the system:

1. They can provide resources, resource types, and actions.
2. They can provide consumers, exporters, and compatible presentation capabilities.

The architectural model is:

    Inputs / Providers
            |
            v
    Resource Management Layer
            |
            v
    Resource Queries & Actions
            |
            +----------------------+
            |                      |
            v                      v
      Visual Consumers       Data Consumers
            |                      |
      Dashboard Widgets         RSS Feeds
      Dashwise Apps             JSON APIs
      Search                    MCP
      Frames                    Webhooks
      Glanceables               Other exports

This is an architectural abstraction, not a requirement that every resource be physically copied into the same database.

### Product goals

- Preserve Dashwise as a homelab dashboard.
- Preserve existing applications and their distinct user experiences.
- Replace Hono/PocketBase with a Go backend using SQLite.
- Introduce a shared resource architecture.
- Make data reusable across applications and presentation surfaces.
- Support both input and output integration capabilities.
- Retain YAML and TypeScript SDK integrations.
- Preserve the existing React frontend wherever practical.
- Support safe production migration and rollback.
- Avoid unnecessary infrastructure and overly generic frameworks.
- Keep deployment simple and self-hosting friendly.

### Migration completion target

Full feature parity for retained functionality.

Architectural milestones may implement only individual vertical slices, but the migration is not complete until retained features have been migrated or explicitly replaced.

The following functionality is intentionally retired:

- Built-in SSH client and SSH host management
- Built-in Media Player

Other related capabilities must not be removed implicitly.

---

## 2. Architectural Principles

### 2.1 Dashwise is the product

The resource architecture exists to support Dashwise, not replace its user-facing identity.

Users should continue to experience:

- A customizable home dashboard
- Widgets
- App navigation
- Quick access to self-hosted services
- Global Search
- News
- Monitoring
- Links
- Frames
- Notifications
- Activity information
- Integration configuration

The new resource model should simplify the implementation of these features without requiring users to think in terms of schemas, queries, or resource definitions.

Resource management is primarily an internal architectural concept.

### 2.2 Resources are central

Resources are the canonical entities managed or exposed by Dashwise.

A resource definition describes:

- Identity
- Schema
- Provider
- Ownership
- Permissions
- Capabilities
- Persistence
- State
- Freshness
- Retention
- Lifecycle

Resource types can be registered by native domains or integrations.

### 2.3 Providers and consumers are independent

Providers make data available.

Consumers use or expose that data.

A single resource type may have multiple providers.

A resource query may serve multiple consumers.

Integrations can extend either side independently.

### 2.4 Resource queries are presentation-independent

The central reusable query contract must not contain React-specific or widget-specific concepts.

Resource queries define which data should be retrieved.

Views define how that data is displayed.

Exporters define how that data is serialized and published.

Actions define how that data can be interacted with.

### 2.5 Domain behavior remains specialized

Not everything should become generic resource CRUD.

Examples:

- Feed ingestion
- Article deduplication
- Monitoring history
- Notifications
- Activity tracking
- Integration lifecycle
- Device authentication
- Dashboard layout editing

These remain domain-specific services and workflows.

### 2.6 Simple deployment first

Initial production topology:

- Go backend
- Go-embedded JavaScript runtime for trusted integration bundles
- React frontend
- SQLite
- Filesystem blob storage

No required Redis, message broker, distributed workers, or external database.

---

## 3. Target Architecture

### 3.1 Frontend

React remains the frontend framework.

The frontend retains Dashwise's existing app-based organization.

    Dashboard
    Pages
    Search
    Links
    News
    Monitoring
    Frames
    Notifications
    Activities
    Integrations
    Settings
    Administration

Applications use shared resource and query infrastructure but preserve their own navigation, forms, interactions, and specialized presentation.

### 3.2 Go Application Backend

The Go backend consists of the following major systems:

    Dashwise Backend
      |
      +-- Resource Management
      |    +-- Resource Registry
      |    +-- Provider Registry
      |    +-- Resource Store
      |    +-- Resource Query Engine
      |    +-- Resource Actions
      |    +-- Change Notifications
      |
      +-- Consumer Management
      |    +-- Consumer Registry
      |    +-- View Definitions
      |    +-- Export Definitions
      |    +-- Output Endpoints
      |
      +-- Domain Services
      |    +-- Links
      |    +-- News
      |    +-- Monitoring
      |    +-- Activities
      |    +-- Notifications
      |
      +-- Application Services
      |    +-- Dashboard and Pages
      |    +-- Search
      |    +-- Frames
      |    +-- Integrations
      |    +-- Authentication
      |    +-- Settings
      |    +-- Administration
      |
      +-- Jobs and Operations
      |
      +-- API / WebSocket
      |
      +-- Shared Go Foundation

Resource management and consumer management should be distinct but closely integrated.

---

## 4. Resource Architecture

### 4.1 Resource definitions

A ResourceDefinition describes a type of resource.

Conceptual example:

    ResourceDefinition
      type
      schema
      capabilities
      persistence
      accessPolicy
      freshnessPolicy
      retentionPolicy

Examples of resource types:

- link
- news.article
- monitoring.server
- monitoring.service
- calendar.event
- weather.forecast
- homelab.device

The exact naming convention should be standardized during contract design.

Resource schemas should be versioned.

### 4.2 Resource identity

Every resource has a stable identity.

Identity consists of:

- Resource type
- Provider instance identifier
- Provider-local identifier

Resources should also expose stable, opaque Dashwise identifiers where appropriate.

Provider-local IDs must not collide across separate integration instances.

### 4.3 Persistence modes

Support three modes.

#### Stored

Dashwise owns the durable record.

Examples:

- User-created links
- Manually configured shortcuts

#### Materialized

External data is synchronized into local storage.

Examples:

- News articles
- Discovered servers
- Integration-provided shortcuts

#### On-demand

Data is retrieved from a provider when queried.

Examples:

- Weather conditions
- Remote service status

On-demand resources may optionally use caching.

Consumers should not need to know the underlying persistence implementation.

They may receive freshness and availability metadata when relevant.

### 4.4 Resource capabilities

Use a capability-based model.

Initial capabilities:

- list
- detail
- search
- launch
- actions
- subscribe
- history

Capabilities describe supported operations, not specific frontend components.

A resource may support only a subset.

### 4.5 Resource ownership

Distinguish:

- Provider-owned data
- User-owned data
- Shared/global data
- User-specific metadata

For example:

A News article has provider-owned title and content, while its saved/read state belongs to a user.

A server has integration-owned status and metrics, while a custom display name may belong to the user.

Provider synchronization must not overwrite unrelated user-owned state.

### 4.6 Synchronization

Providers must support explicitly declared synchronization semantics.

Depending on their capabilities:

- Full snapshot
- Incremental updates
- Batch upserts
- Explicit deletion
- Tombstones
- Freshness reporting
- Stale-state reporting

Provider failures must not silently delete existing materialized resources.

The backend owns persistent resource state.

Integration runtimes do not receive unrestricted database access.

### 4.7 Specialized storage

Do not force every resource into one generic JSON table.

Use appropriate storage for each domain.

Examples:

- Links: relational records
- News: materialized article cache
- Monitoring: specialized metric history
- Activities: append-only records
- Notifications: durable stateful records

The resource architecture provides a common interface while preserving suitable internal storage models.

---

## 5. Resource Query Architecture

### 5.1 Shared ResourceQuery contract

ResourceQuery is the central data retrieval interface.

It is independent of the frontend, views, exports, and integrations.

A query can specify:

- Resource source/type
- Filters
- Sorting
- Field selection
- Pagination
- Bounded aggregates
- Provider-specific typed parameters where necessary

Conceptual example:

    {
      "source": "links",
      "filter": {
        "tags": ["homelab"]
      },
      "sort": [
        {
          "field": "createdAt",
          "direction": "desc"
        }
      ],
      "limit": 50
    }

This query may be consumed by a Dashboard widget, Links page, RSS exporter, JSON endpoint, or another authorized consumer.

### 5.2 Query execution

The backend:

1. Validates the query.
2. Resolves the resource provider.
3. Verifies authorization.
4. Checks supported query capabilities.
5. Executes the query.
6. Returns typed results and metadata.

Browser clients must not execute arbitrary SQL.

### 5.3 Registered queries

Some domains require specialized queries.

Examples:

- Monitoring time-series aggregations
- News topic grouping
- Search ranking

Support registered backend query handlers with typed arguments.

Do not implement a universal expression language or unrestricted cross-resource SQL engine.

### 5.4 Reusable query definitions

Allow resource queries to be saved and referenced.

A saved query can be shared by several consumers.

For example:

    Saved Query: recent-homelab-links
      |
      +-- Dashboard widget
      +-- RSS feed
      +-- JSON endpoint

Saved queries are optional.

Consumers may define inline query configurations.

### 5.5 Query authorization

Authorization must be applied whenever a query executes.

A saved query does not grant access to its underlying resources.

Export endpoints must also enforce appropriate access policies.

Publicly accessible exports require explicit sharing configuration.

---

## 6. Consumer Architecture

### 6.1 Purpose

Consumers turn resource data into usable outputs.

A consumer may:

- Display resources
- Export resources
- Publish resources
- Deliver resource changes
- Feed another system

Consumers are not necessarily visual.

### 6.2 Consumer registry

Introduce a consumer registration mechanism.

A consumer definition describes:

- Consumer type
- Supported resource/query input
- Configuration schema
- Output format or behavior
- Execution mechanism
- Access requirements

The registry supports native consumers and compatible integration-provided consumers.

### 6.3 Visual consumers

Visual consumers render resource query results.

Examples:

- Dashboard widgets
- News article lists
- Monitoring charts
- Search result presentations
- Frames
- Glanceables

Visual consumers use ViewDefinitions.

### 6.4 Export consumers

Export consumers transform resource query results into external representations.

Examples:

- RSS
- Atom
- JSON
- CSV
- Webhooks

Only implement output formats when a concrete feature requires them.

Do not build a general-purpose transformation language initially.

### 6.5 Export definitions

An ExportDefinition contains:

- Identifier
- Resource query or saved query reference
- Exporter type
- Format-specific configuration
- Access policy
- Output endpoint configuration
- Cache/freshness policy where relevant

Exports should be managed through backend APIs.

### 6.6 RSS example

Links supports RSS feeds for selected lists or tags.

Example:

    Links Provider
          |
          v
      Link Resources
          |
          v
      ResourceQuery
          |
          +-- Links App View
          |
          +-- Dashboard Widget
          |
          +-- RSS Exporter
                  |
                  v
             /feeds/links/...

The RSS exporter maps compatible link resources to feed entries.

The exporter owns RSS-specific serialization.

The Links domain owns link creation and change semantics.

A suitable feed configuration should define whether newly added links, updates, or both produce entries.

Public and private feeds must have explicit access policies.

RSS clients may need bearer-free access via a scoped secret feed URL or another compatible authentication mechanism.

Such URLs must be revocable.

### 6.7 Consumer execution boundaries

Consumers should not all run through the same execution mechanism.

Visual consumers execute primarily in React.

Server-side exporters execute in Go or through the integration host.

Webhook delivery uses backend jobs.

MCP adapters expose authorized query and action APIs.

Share query contracts, not necessarily execution runtimes.

---

## 7. View Architecture

### 7.1 ViewDefinition

A ViewDefinition describes a visual representation of resource data.

It contains:

- Query or saved query reference
- Renderer type
- Renderer configuration
- Optional action bindings
- View ownership and permissions

Views must be versioned and serializable.

### 7.2 Initial renderers

Support a small set of reusable renderers:

- List
- Table
- Cards
- Detail
- Metric
- Chart
- Article list
- Specialized domain renderers

Do not build a universal declarative UI language.

### 7.3 Dashboard widgets

Widgets remain a primary Dashwise feature.

A widget uses:

- View definition
- Resource query
- Widget configuration
- Layout configuration

A dashboard page is a composition of widgets and other supported layout elements.

The dashboard editor continues to manage:

- Widget addition/removal
- Positioning
- Resizing
- Configuration
- Page organization

The resource architecture must not remove the existing homelab-dashboard experience.

### 7.4 Application views

Applications may use common view renderers without becoming generic view-only interfaces.

Examples:

News retains:

- Sidebar
- Subscriptions
- Feed navigation
- Article actions

Monitoring retains:

- Host overview
- Metric history
- Alerts
- Specialized charts

Links retains:

- Lists
- Tags
- Editing
- Sharing
- RSS feed configuration

Search retains:

- Keyboard navigation
- Ranking
- Shortcuts
- Actions

### 7.5 Frames

Frames render configured views in kiosk/big-screen layouts.

They retain:

- Layout configuration
- Device management
- Authentication
- Frame Companion compatibility
- Live updates

Frames should reuse resource queries and view renderers rather than introducing a separate data model.

### 7.6 Renderer security

Integrations may declare compatible renderer types and supply configuration.

Do not execute arbitrary frontend code received from resource records.

Third-party executable renderers, if supported later, require a separate trust and isolation model.

---

## 8. Actions and Operations

### 8.1 Actions

Actions provide typed operations on resources or domains.

Examples:

- Open link
- Toggle Home Assistant light
- Refresh integration
- Save article
- Acknowledge monitoring alert

Each action defines:

- Name
- Arguments
- Authorization
- Execution handler
- Result schema

Actions may be provided by native domains or integrations.

### 8.2 Resource state

Resources may expose state suitable for interactive consumers.

Examples:

- On/off
- Online/offline
- Active/inactive
- Current value
- Progress

State should be maintained through provider synchronization or resource mutations.

Search may display state and offer actions when supported.

### 8.3 Long-running operations

Introduce an operations service for tasks such as:

- Integration installation
- Data import
- Remote commands
- Background synchronization
- Future CLI companion operations

Operations have:

- Stable identity
- Owner
- Status
- Progress
- Optional logs
- Cancellation
- Completion result

Activities and Notifications may consume operation lifecycle events.

The operations service must not be confused with the resource store or generic query executor.

---

## 9. Integration Architecture

### 9.1 Integration extension points

Integrations may register:

- Resource types
- Resource providers
- Actions
- Consumers/exporters
- Compatible presentation definitions
- Background jobs

An integration does not need to implement every extension point.

### 9.2 YAML integrations

YAML remains a first-class integration authoring format.

Use it for:

- REST fetching
- Polling
- Simple field mappings
- Basic resource contribution
- Lightweight configuration

YAML definitions should declare resource output using the shared provider contract.

Avoid requiring TypeScript for straightforward integrations.

### 9.3 TypeScript SDK integrations

TypeScript SDK integrations support:

- Complex protocol clients
- Persistent connections
- WebSockets
- Stateful integrations
- Complex transformations
- Actions
- Provider lifecycle
- Specialized export behavior

Integration authors write these integrations in TypeScript. The build bundles them into trusted JavaScript artifacts, which the Go backend runs in its embedded JavaScript runtime. There is no separate integration process or local host protocol in the initial deployment.

### 9.4 Integration host

Initial design:

- The Go backend owns integration lifecycle and persistent configuration.
- The embedded JavaScript runtime loads the trusted bundles packaged with the server.
- Multiple configured instances run through the Go-owned lifecycle manager.
- SDK host APIs bridge integration calls to Go-owned resources, storage, secrets, and actions.
- TypeScript compilation and bundling happen during development and image builds.

The runtime is intended for trusted, installed bundles. It is not a process or operating-system security boundary. Remote or untrusted integration execution remains future work.

The host supports:

- Handshake
- Version negotiation
- Instance lifecycle
- Provider registration
- Resource queries
- Resource synchronization
- Action invocation
- Export invocation where applicable
- Events
- Cancellation
- Health reporting

### 9.5 Integration permissions

The Go backend must enforce integration permissions.

Integrations should only access:

- Their permitted configuration
- Their permitted secrets
- Their owned resources
- Explicitly authorized cross-resource queries
- Approved actions and consumer operations

Do not expose the database directly to integration code.

### 9.6 Failure handling

Support:

- Host restarts
- Instance failures
- Timeouts
- Rate limits
- Invalid data
- Partial synchronization
- Stale resource state
- Backend restarts

Integration errors must not corrupt persistent resource state.

---

## 10. Authentication and Authorization

### 10.1 Auth model

Use a session-based authentication model with optional external identity providers.

The initial architecture must support future multi-user administration.

Define:

- Users
- Sessions
- Roles
- Resource ownership
- Resource grants
- View permissions
- Export permissions
- Action permissions
- Device credentials

### 10.2 Multi-user support

Plan for:

- User-specific dashboards
- Shared resources
- Shared views
- Admin-managed dashboards
- Read-only users
- Customizable user dashboards
- Restricted application access

Not all administration UI must be implemented during the earliest migration phase.

However, resource ownership and authorization must be designed accordingly.

### 10.3 Device-code authentication

Support device-code authentication for companion devices and additional sessions.

Requirements:

- Short-lived codes
- Explicit approval
- Expiration
- Attempt limits
- Connection limits
- Scoped device credentials
- Revocation

Device-code authentication must not bypass normal authorization.

### 10.4 External access

MCP servers, CLI companions, browser extensions, and desktop companions should eventually use the same authenticated query/action API.

Provide scoped permissions rather than unrestricted administrator access.

---

## 11. Search

Search remains a central Dashwise feature.

It discovers resource types that opt into search.

Search provides:

- Global resource discovery
- Shortcuts
- State display
- Registered actions
- Keyboard navigation
- Ranking
- Navigation targets

### Search implementation

- Frontend owns search interaction and presentation.
- Backend owns search routes and ranking logic.
- Resource layer provides searchable data.
- SQLite FTS provides the initial index.

Search results must be permission-filtered.

Favorites, hidden shortcuts, and other user preferences should be supported without duplicating resource records.

---

## 12. Domain Applications

### 12.1 Links

Links are native resources.

Retain:

- Lists
- Tags
- Groups
- Editing
- Search participation
- Shortcuts
- Favorites
- Icons
- Organization

Add RSS export support through the consumer architecture.

Relevant issues:

- #309 Shortcuts options popover
- #310 Add shortcuts in Home Links
- #358 Shared shortcut icons
- #375 RSS feeds for link lists/tags

### 12.2 News

News manages feeds and articles.

Resources:

- Feed subscriptions where appropriate
- News articles
- Relevant provider metadata

Domain behavior:

- Feed ingestion
- Deduplication
- Topic grouping
- Proxy-feed support
- Read/saved state
- Cache retention

News remains a dedicated app.

Relevant issues:

- #370 Subscribe modal behavior
- #373 Proxy feeds
- #366 Topic grouping

### 12.3 Monitoring

Monitoring consumes resources exposing monitoring capabilities.

Examples:

- Beszel servers
- Proxmox hosts
- Host monitoring agents
- Services
- Docker containers

Retain:

- Current status
- History
- Charts
- Alerts
- Live updates
- Monitoring dashboard

Use specialized metric storage where appropriate.

Relevant issues:

- #229 Host and Docker monitoring
- #161 Proxmox widget
- #81 Monitoring notifications

Retire only the built-in SSH client/host-management feature.

### 12.4 Activities

Activities represent meaningful events.

Support:

- User activities
- Integration activities
- Operation progress
- Activity history
- Custom CLI companion activities

Activities must remain distinct from internal resource-change notifications.

Relevant issue:

- #352 Custom activities

### 12.5 Notifications

Notifications have a separate lifecycle.

Support:

- Creation
- Delivery
- Read state
- Dismissal
- Expiration
- Delivery errors
- Existing notification channels

Notifications may react to resource changes, monitoring events, and operation completion.

### 12.6 Weather

Weather integrations expose weather resources.

Dashboard widgets and relevant views consume those resources.

Support existing weather functionality.

Relevant issues:

- #340 Multiple default locations
- #348 Precipitation summary

### 12.7 Other existing features

Inventory and migrate all retained features.

Do not silently remove features simply because they do not fit a generic resource CRUD model.

---

## 13. Live Updates

### 13.1 Shared event transport

Use a shared WebSocket transport for relevant application events.

Support:

- Resource invalidation
- Resource changes where appropriate
- Operation progress
- Activity events
- Notifications
- Integration status
- Device/session events

These events should have explicit types.

### 13.2 Query subscriptions

Consumers may subscribe to query or resource changes.

Prefer invalidation and refetch as the default mechanism.

Support:

- Reconnection
- Resubscription
- Snapshot refresh
- Authorization changes
- Resource deletion
- Provider failure

### 13.3 Durable delivery

Only require durable event delivery where needed.

Examples:

- Notification delivery
- Important operation completion
- Other explicitly durable workflows

Do not implement a universal replayable event system unless a concrete requirement justifies it.

### 13.4 Device-specific communication

File transfer, snippet sharing, and cross-device media control require separate protocols or services.

Do not treat binary file transport as ordinary resource synchronization.

Relevant issues:

- #334 File sharing
- #367 Snippet sharing
- #295 Media protocol

These are deferred unless explicitly included in the migration scope.

---

## 14. Reusable Go Foundation

### 14.1 Scope

Build a small reusable Go foundation.

Include:

- SQLite storage
- Transactions
- Schema registration
- Migrations
- Persistence primitives
- Identity/session primitives
- Authorization hooks
- Resource identity and generic registry interfaces where justified
- Change recording and event delivery
- Storage lifecycle and backups

### 14.2 Resource infrastructure extraction

Resource identity, schema contracts, provider interfaces, and query contracts may be reusable beyond Dashwise.

However, do not make a standalone platform release a prerequisite.

Prove the resource architecture in Dashwise first.

Extract stable generic components after validation.

### 14.3 Slopstack evaluation

Investigate reuse of existing Slopstack/PocketBase-related primitives.

Avoid duplicate infrastructure for:

- Auth
- Persistence
- Migrations
- Generic collection operations

Reuse should not introduce unwanted dependencies or compromise the target architecture.

### 14.4 Exclusions

Do not initially build:

- Universal application framework
- Generic form builder
- Arbitrary user-defined functions
- General-purpose workflow engine
- Multiple SQL database drivers
- Distributed resource execution
- Advanced query expression language
- Publicly stable platform API

---

## 15. Repository Structure

Target layout:

    apps/
      backend/
        cmd/dashwise/
        internal/
          app/
          api/
          auth/
          resources/
            registry/
            providers/
            queries/
            actions/
            sync/
          consumers/
            registry/
            views/
            exports/
          domains/
            links/
            news/
            monitoring/
            activities/
            notifications/
          search/
          dashboards/
          frames/
          integrations/
          jobs/
          operations/

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

Avoid excessive Go module fragmentation.

Use one Go application module and an independently reusable foundation module only where justified.

---

## 16. Migration Implementation Phases

### Phase 0 — Inventory and Architecture Decisions

Inventory:

- Existing PocketBase collections
- Hono routes
- Authentication
- Sessions
- Integrations
- Widgets
- Dashboard layouts
- Application routes
- Jobs
- Events
- Frames
- Notifications
- Settings
- Deployment behavior
- Backups
- Open GitHub issues

Classify all existing capabilities.

For each issue, record:

- Target domain
- Architectural dependencies
- Migration phase
- Preserve / implement / defer / supersede / retire

Preserve existing development work.

Create `go-migration` from a committed or safely isolated `sdk-integrations` baseline.

Use separate worktrees for parallel implementation.

Exit:

- Feature-parity matrix
- Issue disposition matrix
- Data ownership map
- Confirmed initial architecture

### Phase 1 — Resource and Consumer Vertical Slice

Build the smallest end-to-end proof of the architecture.

Use Links as the initial domain.

Implement:

1. Minimal Go backend.
2. SQLite persistence.
3. Link resource definition.
4. Native Links provider.
5. Resource registry.
6. ResourceQuery v1.
7. Authorized resource actions.
8. React list view.
9. Dashboard widget consuming the same resources.
10. RSS exporter consuming the same query.
11. Export endpoint.
12. Basic update invalidation.

Also add one simple TypeScript integration provider to validate the integration boundary.

The demonstration must prove:

    One resource model
          |
          +-- Links app
          +-- Dashboard widget
          +-- RSS feed
          +-- Integration access

Exit:

The same link data can be created, queried, displayed in multiple places, and exported without duplicating the domain data model.

### Phase 2 — Foundation and Contract Stabilization

After the vertical slice:

- Evaluate reusable primitives.
- Extract the minimal Go foundation.
- Stabilize ResourceDefinition.
- Stabilize ResourceQuery.
- Stabilize action contracts.
- Stabilize ViewDefinition.
- Stabilize ExportDefinition.
- Stabilize provider protocol.
- Generate API clients.
- Add contract tests.
- Define authentication and permission hooks.

Do not expand implementation broadly before contracts are stable.

Exit:

Core contracts are versioned and validated by end-to-end tests.

### Phase 3 — Integration Host and SDK

Implement:

- Go-embedded JavaScript runtime
- Instance lifecycle
- Provider registration
- Resource synchronization
- Action execution
- Consumer/export registration
- YAML compatibility
- TypeScript SDK compatibility
- Error recovery
- Secret handling

Port one simple and one complex integration.

Exit:

Both YAML and TypeScript integrations can provide resources through the same architecture.

Integration-provided output capabilities work through explicit consumer contracts.

### Phase 4 — News Migration

Implement:

- Feed subscriptions
- Feed ingestion
- Materialized article resources
- Deduplication
- Read/saved state
- Retention
- Topic grouping
- News views
- Search participation
- Existing News workflows

Exit:

News reaches functional parity with the existing implementation.

### Phase 5 — Monitoring and Live Data

Implement:

- Monitoring resource definitions
- Beszel provider migration
- Current status
- Historical metrics
- Time-series queries
- Monitoring charts
- Alerts
- Live subscriptions
- Monitoring Dashboard widgets
- Additional monitoring providers as required

Exit:

Monitoring reaches functional parity without sacrificing historical query performance.

### Phase 6 — Application and Dashboard Integration

Complete:

- Dashboard
- Pages
- Search
- Frames
- Frame Companion
- Activities
- Notifications
- Settings
- Administration
- Onboarding
- Remaining widgets
- Remaining integrations

Preserve Dashwise's existing visual design and app-centric navigation.

Replace legacy data paths incrementally.

Implement relevant outstanding issues where they naturally belong.

Exit:

All retained frontend functionality uses the new Go backend.

### Phase 7 — External APIs and Advanced Consumers

Implement or finalize supported external consumption paths.

Priorities:

1. JSON API over registered resource queries.
2. RSS export capabilities.
3. Scoped API credentials.
4. MCP adapter where required.
5. External client compatibility.

Potential later features:

- Webhooks
- Browser extension
- Desktop companion
- CLI integrations
- Additional feed/export formats

Do not require all future exporters to be implemented before migration completion.

Exit:

The consumer architecture supports both visual presentation and at least one production-ready external export format.

### Phase 8 — Production Migration

Implement:

- Versioned export from existing Dashwise
- Versioned import into Go Dashwise
- Dry-run validation
- Data transformation
- Reference remapping
- Secret handling
- Account migration
- Dashboard layout migration
- Integration configuration migration
- Backup/restore
- Rollback

Cutover:

1. Back up old deployment.
2. Validate export.
3. Enter read-only mode.
4. Perform final export.
5. Import into new backend.
6. Validate data and accounts.
7. Verify integrations and device flows.
8. Switch deployment.
9. Keep old installation available for rollback.

Avoid indefinite dual-write.

Exit:

Production data is safely migrated and PocketBase is no longer a source of truth.

### Phase 9 — Optional Platform Improvements

After migration:

- Publish the reusable foundation independently.
- Add additional database adapters if needed.
- Add Redis if required by scale.
- Add remote integration execution.
- Extend export formats.
- Add richer consumer types.
- Improve integration isolation.
- Add advanced cross-resource queries where justified.

These are optional future capabilities.

---

## 17. Testing

### Contract tests

Cover:

- Resource schemas
- Query validation
- Provider registration
- Consumer registration
- Actions
- View definitions
- Export definitions
- API versioning

### Security tests

Cover:

- Resource access
- Shared view permissions
- Export permissions
- Public feed access
- Scoped API credentials
- Provider ownership
- Integration secret access
- Subscription authorization

### Integration tests

Cover:

- Integration startup
- Host restart
- Provider synchronization
- Batch upserts
- Deletion
- Provider errors
- Timeouts
- Action execution
- Export invocation
- Invalid data

### End-to-end tests

Cover:

- Dashboard widget rendering
- Links editing
- RSS publishing
- News workflows
- Monitoring history
- Search
- Frames
- Notifications
- Authentication
- Integration configuration
- Production import/export

### Performance tests

Measure:

- SQLite concurrency
- Resource query latency
- Provider synchronization
- News collection size
- Monitoring history performance
- Search indexing
- Subscription overhead
- Export generation
- Startup and recovery

---

## 18. Parallel Agent Strategy

### Sequential foundation work

Complete:

1. Inventory
2. Architecture contracts
3. Links resource/view/export slice
4. Contract review
5. Foundation extraction

Then begin broad parallel development.

### Parallel workstreams

Backend/resource agent:

- Resource registry
- Queries
- Actions
- Synchronization

Consumer/frontend agent:

- View renderers
- Dashboard integration
- View configuration
- Export management UI

Integration agent:

- Go JavaScript runtime and host bridge
- YAML
- TypeScript SDK
- Protocol

Domain agents:

- Links
- News
- Monitoring
- Activities and Notifications

Infrastructure agent:

- Auth
- Database
- Migration
- Backups
- Deployment
- Testing

Each workstream uses an isolated worktree.

Assign explicit package ownership.

Keep one integration owner responsible for compatibility, merging, and overall architectural consistency.

Do not allow agents to independently invent incompatible resource or consumer contracts.

---

## 19. Architectural Decisions to Finalize

Before broad implementation, record the following decisions:

1. Resources are the core managed entities.
2. Dashwise remains a homelab dashboard.
3. Providers supply and maintain resources.
4. Consumers present or export resources.
5. ResourceQuery is presentation-independent.
6. ViewDefinition is a visual consumer configuration.
7. ExportDefinition is a data-output consumer configuration.
8. Actions are explicit typed operations.
9. Domains retain specialized workflows.
10. Resource storage may be stored, materialized, or on-demand.
11. Go owns persistent state and authorization.
12. TypeScript SDK integrations are bundled during builds and execute as trusted bundles in the Go backend's embedded JavaScript runtime.
13. YAML integrations remain supported.
14. SQLite is the initial durable backend.
15. Live resource invalidation uses shared WebSocket infrastructure.
16. Public exports require explicit access configuration.
17. Multi-user authorization is considered in foundational contracts.
18. Existing dashboard UX is preserved.
19. Reusable foundation components are extracted after validation.
20. Full retained feature parity is required for final cutover.

---

## 20. Definition of Done

The migration is complete when:

- Dashwise runs on Go and SQLite.
- The existing homelab dashboard experience is preserved.
- Retained apps and widgets function correctly.
- Resources have stable identities, schemas, and ownership.
- Native domains and integrations can provide resources.
- Resources can be queried through common contracts.
- Views can consume and display resources.
- Exporters can consume and publish resources.
- Links support RSS publishing.
- Actions work consistently across apps and integrations.
- Search is backed by resource discovery.
- News retains its ingestion and management workflows.
- Monitoring retains current and historical data.
- Frames continue to function.
- YAML and TypeScript integrations remain supported.
- Authentication and authorization are secure.
- Production data can be migrated and restored.
- Old PocketBase/Hono dependencies are retired.
- No retained capability has been silently removed.
- The architecture remains understandable and maintainable.

---

## 21. Final Architectural Principle

Dashwise remains a self-hosted homelab dashboard and application hub.

Its underlying architecture revolves around structured resources.

Providers bring resources into Dashwise.

The resource layer manages identity, state, queries, permissions, and lifecycle.

Consumers use those resources through views, widgets, applications, feeds, APIs, or other supported output formats.

Actions allow users and integrations to interact with resources.

Integrations extend the system by contributing providers, actions, and consumers.

**The resource architecture powers Dashwise; it does not replace Dashwise's product identity.**
