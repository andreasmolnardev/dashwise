# Dashwise Architecture Revamp

## Purpose

Dashwise is one self-hosted homelab application. It currently combines dashboard pages, monitoring, notifications, links, news, integrations, search, and user page configuration in shared frontend and backend areas.

This plan makes Dashwise easier to extend and reason about by separating native feature ownership from shared infrastructure. It establishes a feature-oriented modular monolith. It does not introduce microservices, independent module deployments, or a fully dynamic plugin platform.

Three extension shapes must remain distinct:

```text
Native modules       Dashwise-owned capabilities and business behavior
Integrations         External-service connections and data adaptation
Page configurations  User-owned composition of dashboards and consumers
```

These shapes collaborate, but none replaces another.

## Current Design Constraints

The migration must preserve these current design decisions:

1. Dashwise is one application and one combined OpenAPI contract.
2. Public API routes remain versioned under `/api/v1/*`.
3. Existing page URLs remain valid. Page configuration currently resolves from the first route segment, such as `/home` or `/news`; migration must not introduce `/apps/*` as a canonical replacement.
4. Page configuration is persisted per user and page. It composes native dashboard content, frontend-native widgets, integration-backed widgets, and glanceables.
5. Integrations are already data-driven. Their definitions and widget/glanceable metadata are stored in PocketBase, runtime data is resolved in the backend, and frontend rendering consumes resolved blueprints.
6. Existing integration widgets and glanceables must remain configurable by users. A native React widget registry cannot replace this model.
7. Background work currently has a jobs runtime/service. Module job registration must target that runtime rather than start jobs from Hono application bootstrap.
8. Current authorization is primarily authenticated-user and record ownership. Feature-level permissions may be declared now, but role-based enforcement must not be assumed until an authorization model exists.

## Goals

1. Make Dashboard, Monitoring, Notifications, Links, and News explicit native modules with clear public boundaries.
2. Move reusable mechanisms into feature-neutral platform services.
3. Keep technical foundations in a lower core infrastructure layer.
4. Replace global feature pathname checks with explicit route metadata.
5. Preserve current URLs, API contracts, page configurations, integration behavior, and generated SDK workflow during migration.
6. Allow modules to be statically omitted from product artifacts or dynamically disabled per instance deployment.
7. Start with module composition, route metadata, routing, navigation, dependency rules, and one isolated migration. Defer additional registries until proven necessary.

## Non-Goals

This plan does not add:

- Microservices, separate module deployments, or per-module databases.
- Runtime JavaScript installation, remote frontend modules, arbitrary code execution, or an extension marketplace.
- Separate OpenAPI documents or generated SDKs per module.
- A generic dependency injection container.
- Event sourcing, CQRS, or mandatory domain-driven-design layers.
- A package for every module.
- A replacement for existing data-driven integration definitions.
- A role-based permission system before its actor, policy, and persistence model are designed.

## Target Model

```text
Products
    -> Native Modules
    -> Platform Services
    -> Core Infrastructure

Integrations -> normalized capability contracts -> Native Modules
Page Configurations -> compose native and integration consumers on surfaces
```

### Product Layer

Products are thin, static compositions. They select modules, define defaults, and define availability policy. Products do not own feature business logic.

Initial product:

```text
Homelab
├── Dashboard
├── Monitoring
├── Notifications
├── Links
└── News
```

Only one product exists today. `Homelab` is therefore an explicit composition boundary, not evidence that Dashwise needs runtime product switching. Product profiles are statically imported and selected at build time.

### Native Module Layer

A module represents a Dashwise-owned capability. It owns native domain behavior, its backend services, and its public API. Modules may contribute only capabilities they need:

- Routes and route metadata.
- Navigation entries.
- Native widgets and dashboard editing affordances.
- Search providers.
- Commands and shortcuts.
- Settings sections.
- Jobs submitted to shared jobs runtime.
- Permission declarations.
- Backend services and API routes.
- Integration adapters and normalized capability contracts close to domain expertise.

Initial module responsibilities:

| Module | Owns |
| --- | --- |
| Dashboard | Dashboard routes, page editing, templates, layout editing, native dashboard widgets, and presentation of persisted page configuration. |
| Monitoring | Monitors, hosts, status and metric meaning, monitoring routes, monitoring jobs, and monitoring-specific integrations. |
| Notifications | Topics, inbox items, topic tokens, delivery/forwarding preferences, routes, and notification jobs. |
| Links | Link lists, folders, tags, saved links, link routes, and link-oriented search. |
| News | Subscriptions, feeds, articles, news routes, feed refresh jobs, and news behavior. |

Dashboard must not absorb monitoring, news, notification, or link domain logic. Conversely, Dashboard is more than a generic widget grid: it remains responsible for dashboard-specific editing and layout behavior.

### Platform Services

Platform services are feature-neutral mechanisms. They expose stable contracts but do not contain monitoring, news, link, notification, or dashboard business behavior.

Candidate platform services:

```text
module composition
routing and route metadata
navigation
page-configuration orchestration
widget consumer rendering
search
commands and shortcuts
events
settings composition
jobs submission and lifecycle integration
integration lifecycle
permission evaluation
```

Only services with at least one current use case are built. Module composition, routing metadata, routing, navigation, and dependency enforcement come first. Widget, search, command, event, settings, and permissions registries remain follow-on work.

### Core Infrastructure

Core provides low-level technical foundations and knows no feature names:

```text
authentication
authorization primitives
configuration
database and PocketBase access
logging
HTTP and WebSocket transport
OpenAPI generation
generated SDK workflow
error handling
process lifecycle
jobs process connectivity
```

Core can define generic identity and authorization primitives. It must not contain `monitoring`, `news`, or another module's policy.

## Declarative Module Definition

Module composition is mainly declarative. The product imports explicit module definitions; no directory scanning occurs. An optional initialization hook exists only for startup work that cannot be represented as data.

```ts
export interface DashwiseModule {
  id: string;
  name: string;
  routes?: readonly ModuleRoute[];
  navigation?: readonly NavigationEntry[];
  nativeWidgets?: readonly NativeWidgetDefinition[];
  searchProviders?: readonly SearchProvider[];
  commands?: readonly CommandDefinition[];
  settings?: readonly SettingsSection[];
  jobs?: readonly JobDefinition[];
  permissions?: readonly PermissionDeclaration[];
  integrationAdapters?: readonly IntegrationAdapterDefinition[];
  setup?(context: ModuleStartupContext): void | Promise<void>;
}
```

`setup` must not become a second, imperative manifest. It is limited to lifecycle work such as attaching an adapter stream or preparing a shared resource. Static contributions belong in fields above so they can be inspected and validated before application startup.

Frontend and backend definitions may align by module identifier but must not share one oversized runtime object. Shared contracts are limited to actual cross-process data shapes.

```ts
export const homelabProduct = {
  id: "homelab",
  modules: [
    dashboardModule,
    monitoringModule,
    notificationsModule,
    linksModule,
    newsModule,
  ],
} satisfies DashwiseProduct;
```

Explicit imports provide deterministic startup, bundling, validation, and build-time omission.

## Availability and Enablement

These states have different meanings:

| State | Meaning |
| --- | --- |
| Available | Module code is included in built artifact through selected product profile. |
| Enabled | Deployment enables module. Routes, jobs, connections, and global contributions can run. |

Build-time omission reduces artifact size and excludes code entirely. Runtime disabling retains code but avoids active CPU work, memory use, connections, polling, and background jobs. Module availability is instance-level; Dashwise does not have per-user module activation.

## Dependency Boundaries

Allowed direction:

```text
products -> modules -> platform -> core
modules -> shared utilities/contracts
platform -> shared utilities/contracts
products -> shared utilities/contracts
```

Disallowed direction:

```text
core -> platform or modules
platform -> modules
shared -> modules
module A -> module B private implementation
```

A module collaborates with another module only through:

1. Feature-neutral platform service.
2. Shared typed contract.
3. Explicit public module API.
4. Typed event for optional, asynchronous side effects.

Required synchronous workflows use explicit APIs or contracts, never events. Events are for invalidation, activity, optional notifications, and asynchronous reactions. They must have named owner, typed payload, and observable registration.

Architecture linting must reject private cross-module imports and reverse dependencies. Initially enforce folder boundaries with ESLint restrictions and CI checks; do not add packages merely to create boundaries.

## Module Public APIs

Each module exposes a narrow public boundary:

```text
modules/monitoring/
├── index.ts          public exports only
├── module.ts         declarative definition
├── public/
│   ├── contracts.ts
│   └── api.ts
└── internal/
    ├── components/
    ├── services/
    └── repositories/
```

Other modules may import from `index.ts` or `public/`. They may not import `internal/`.

No module needs generic repository access to another module's PocketBase collections. Each module owns its data access logic and database records. Shared database connection and PocketBase client setup remain core infrastructure.

## Routing and Navigation

### Route Metadata

Routes are module-owned declarative definitions. Metadata replaces feature-specific pathname recognition in global layouts and hooks.

```ts
export interface ModuleRoute {
  id: string;
  moduleId: string;
  path?: string;
  index?: boolean;
  component: LazyExoticComponent<ComponentType>;
  children?: readonly ModuleRoute[];
  meta: {
    title?: string;
    pageKind: "dashboard" | "application" | "settings" | "system";
    surface?: "dashboard" | "application" | "frame" | "sidebar";
    pageConfig?: {
      mode: "none" | "named" | "pathname-first-segment";
      pageName?: string;
    };
    showSidebar?: boolean;
    showHeader?: boolean;
    requiredPermissions?: readonly string[];
  };
}
```

Existing URL semantics are preserved. For example, dashboard pages continue to use their existing first segment while route metadata tells shared code whether and how page configuration applies. `pageConfig.mode: "pathname-first-segment"` explicitly represents current behavior during migration; it is not a hidden global exclusion list.

Auth, onboarding, error, screensaver, frame, and shell routes remain platform/application routes. Feature routes migrate one module at a time. Existing URLs remain canonical unless product requirements later justify a separately planned URL migration.

### Navigation

Modules declare navigation entries. Platform navigation handles ordering, grouping, active-state calculation, responsive rendering, and policy filtering. Product composition may set ordering or hide entries, but must not implement feature behavior.

```ts
export interface NavigationEntry {
  id: string;
  moduleId: string;
  label: string;
  path: string;
  group?: string;
  order?: number;
  requiredPermissions?: readonly string[];
}
```

Navigation must preserve current sidebar capabilities such as grouped tabs, actions, bottom tabs, and dashboard return behavior. A registry may not reduce navigation to only simple links.

## Page Configuration and Surfaces

Page configuration is neither a native module nor an integration. It is user-owned persisted composition.

It determines which consumers appear on a page and their per-instance configuration. It can compose:

- Dashboard-native widgets such as clock, search, link view, and layout primitives.
- Native widgets contributed by modules.
- Integration-backed widget consumers.
- Integration-backed glanceable consumers.

Platform owns schema compatibility, loading, persistence orchestration, consumer collection, cache priming, and route-to-page resolution. Dashboard owns dashboard editing, templates, layout semantics, and rendering composition. Individual modules own their native widget behavior. Integrations own remote data adaptation and their widget/glanceable definitions.

A surface describes rendering constraints, not a competing product:

```ts
type SurfaceId = "dashboard" | "application" | "frame" | "sidebar";
```

Introduce a surface registry only when current native and integration consumers need shared capability validation. Do not require every current page to migrate to surfaces first.

## Widget Consumers

Widget platform work must support two distinct sources:

```text
Native widget
  Module supplies Dashwise React behavior and configuration contract.

Integration widget or glanceable
  Integration definition supplies data-driven metadata and template blueprint.
  Backend resolves remote data. Frontend renders resolved blueprint.
```

The consumer instance is page-config data. It references consumer type/key, input, layout position, and surface. It must retain enough source information to resolve native and integration consumers without collisions.

Do not use one `component: ReactComponent` contract as universal widget definition. Native components and integration blueprints require separate renderer contracts behind a common consumer boundary.

## Integrations and Capability Contracts

Integrations are distinct from modules.

- A module owns Dashwise-side meaning, domain behavior, routes, jobs, and presentation.
- An integration connects Dashwise to an external service and adapts remote data.
- A capability contract expresses module-relevant normalized data without exposing transport details.

Example:

```text
Monitoring module
    uses HostMetricsSource capability
        implemented by System Agent adapter
            backed by System Agent HTTP and/or WebSocket transport
```

```ts
export interface HostMetricsSource {
  getHostMetrics(hostId: string): Promise<HostMetrics>;
  subscribeHostMetrics?(hostId: string, onData: (metrics: HostMetrics) => void): Unsubscribe;
}
```

Concrete adapter definitions remain close to module that understands their domain data. Platform integration lifecycle provides common credentials handling, connection state, health checks, retries, polling, streaming, WebSocket lifecycle, cleanup, and normalized remote errors.

Existing data-driven integrations remain supported. Their PocketBase-backed configuration, YAML templates, endpoint resolution, runtime caching, and resolved widget/glanceable blueprints are integration-runtime responsibilities. This is not a third-party code-plugin system.

Initial integration runtime work must be driven by one existing adapter with lifecycle needs, then generalized after a second real adapter. System Agent is a suitable candidate only after its current transport and ownership are documented.

## Search, Commands, Settings, Events, Jobs, and Permissions

These are platform mechanisms, not compulsory module features.

### Search

Search providers contribute normalized results. Existing link and integration search behavior must migrate without preserving incidental result labels as architectural types. Integration-specific result kinds are implementation data, not platform contracts.

### Commands and Shortcuts

Commands separate action identity from buttons and key handlers. Commands may later power a command palette, shortcut mapping, context menus, and search actions. Do not build registry until migration has a concrete existing shortcut or action to move.

### Settings

Platform owns settings shell and composition. Modules contribute feature settings. Existing global account, appearance, authentication, general, and security settings remain platform/application-owned.

### Events

Typed events are optional-side-effect contracts. They are not query transport, request validation, or required cross-module orchestration.

### Jobs

Modules declare jobs and job policy; platform connects declarations to existing jobs runtime/service. Platform owns scheduling integration, logging, retry policy, concurrency, timeout, startup registration, and shutdown coordination. Module owns job behavior.

### Permissions

Modules may declare stable capability identifiers such as `monitoring.read` or `news.manage`. The declarations become enforceable only after Dashwise defines roles, grants, evaluation policy, persistence, and migration of existing owner-based checks. Frontend filtering never replaces backend authorization.

## Backend Architecture

Backend modules follow frontend module boundaries where practical, but do not duplicate frontend-only concepts.

```text
apps/backend/src/
├── core/
├── platform/
├── modules/
│   ├── dashboard/
│   ├── monitoring/
│   ├── notifications/
│   ├── links/
│   └── news/
└── index.ts
```

A backend module can contribute versioned Hono routes, OpenAPI schemas, services, data access, job declarations, events, adapters, and public contracts. Its routes remain mounted into one Hono application and one OpenAPI document:

```text
/api/v1/dashboard/*
/api/v1/monitoring/*
/api/v1/notifications/*
/api/v1/links/*
/api/v1/news/*
/api/v1/integrations/*
```

Global APIs remain under existing `/api/v1` namespaces such as auth, configuration, account, and system. OpenAPI generation continues to produce one SDK from combined application routes.

## Recommended Repository Shape

Create these boundaries incrementally. Do not move every file before first migration proves them.

```text
apps/web/src/
├── app/                 application shell, auth, onboarding, errors
├── core/                transport, auth, config, storage, shared primitives
├── platform/            composition mechanisms
├── modules/             native feature modules
├── products/homelab/    static module composition and defaults
└── shared/              feature-neutral UI and utilities

apps/backend/src/
├── core/                PocketBase, auth primitives, config, transport, logging
├── platform/            route mounting, jobs bridge, integration lifecycle
├── modules/             native feature services and routes
└── products/homelab/    static backend composition
```

Keep shared packages focused. Existing integration packages remain integration runtime and rendering dependencies. Add a shared package only where a real frontend/backend contract cannot sensibly live with its owning module.

## Validation and Testing

Validate statically composed modules before boot completes:

- Duplicate module, route, navigation, command, and native-widget identifiers.
- Route parent and page-config metadata validity.
- Duplicate or incompatible consumer renderer keys.
- Enabled-module dependency validity.
- Integration adapter identifier conflicts.
- Job identifier and schedule conflicts.

Test migration compatibility:

- Existing URLs resolve to equivalent routes and page configurations.
- Existing `/api/v1` endpoints and generated SDK remain compatible.
- Existing integration widgets/glanceables resolve and render from saved page configuration.
- Existing jobs remain registered with jobs runtime.
- Existing sidebar groups and actions remain available.

Architecture tests enforce dependency direction and public API boundaries. Module tests cover domain services, routes, declared contributions, and public contracts. Product composition tests boot Homelab with its selected profile.

## Migration Plan

### Phase 0: Baseline

Document current routes, navigation contribution shapes, page-config path resolution, frontend-native widgets, integration consumers, public `/api/v1` endpoints, jobs runtime registration, current cross-feature imports, and generated SDK process. Add compatibility tests before moving code.

### Phase 1: Boundaries and Composition

Create core, platform, modules, and `products/homelab` boundaries in frontend and backend. Add dependency lint rules. Add declarative module types and explicit Homelab module list. Do not move feature implementation yet.

### Phase 2: Route Metadata and Navigation

Introduce route definitions and metadata. Preserve current URLs and explicit page-config resolution modes. Move feature navigation definitions from shell composition into declarative module contributions while preserving all current sidebar capabilities.

### Phase 3: Migrate One Isolated Module

Migrate News first if baseline confirms it has least cross-feature coupling. Move its routes, navigation, backend routes, feed services, and feed job declaration behind public boundary. Keep `/api/v1` endpoints and existing page URL behavior. Do not introduce widgets, commands, events, or permissions registry merely because module type allows them.

### Phase 4: Migrate Remaining Native Modules

Migrate Links, Monitoring, Notifications, and Dashboard one at a time. Preserve current page-config model throughout. Resolve direct cross-module imports through public contracts or platform mechanisms only where real dependency exists.

### Phase 5: Extract Proven Platform Primitives

After at least two modules need same mechanism, introduce surface/widget consumers, search, commands, typed events, settings composition, permissions evaluation, or integration lifecycle services. Each extraction must support native and integration extension shapes where applicable.

### Phase 6: Integration Lifecycle

Document System Agent and another existing integration. Define capability contracts from their real requirements. Move shared connection health, retries, polling, streaming, WebSockets, credentials, and normalized errors into platform only after duplication is demonstrated. Preserve existing YAML-backed integrations throughout.

## First Implementation Scope

First increment contains only:

```text
explicit Homelab module composition
declarative module definitions
route metadata
module-owned route composition
module-owned navigation declarations
dependency lint rules
current-URL and page-config compatibility tests
News module migration
```

This creates enforceable native feature boundaries without prematurely rebuilding widget, integration, search, command, event, settings, permissions, or jobs systems.

## Success Criteria

Architecture succeeds when:

- Adding native feature starts with explicit module definition and product composition.
- Adding feature route or navigation entry does not require editing global router or sidebar implementation.
- Global code uses route metadata rather than growing pathname exclusion lists.
- Native modules own their business logic and do not import other modules' private internals.
- Integrations remain data-driven external-service adapters, not native modules.
- Saved page configurations can compose native and integration-backed consumers without migration loss.
- Existing URLs and `/api/v1` contracts remain stable throughout migration.
- One Hono application, one OpenAPI document, one generated SDK workflow, and existing jobs runtime remain intact.
- Product profiles can omit modules at build time; enabled and active state are explicit at runtime.
- Platform and core remain feature-neutral.
- New platform abstractions are introduced only after concrete module requirements prove them.
