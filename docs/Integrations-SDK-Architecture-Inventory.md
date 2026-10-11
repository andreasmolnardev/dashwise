# Integrations SDK v2 architecture inventory

This inventory records the current implementation before SDK v2 changes.

## Existing systems

- `@dashwise/integrationskit` is a workspace package for rendering existing
  integration Widgets and Glanceables, resolving YAML-defined endpoint data,
  and adapting configured YAML Shortcuts. It is not currently an executable
  integration SDK or a lifecycle-managed runtime.
- Integration instances are stored in PocketBase's `integrations` collection.
  Backend data helpers map records to an owner, source, config, environment,
  and `localData`; the authenticated integration routes provide CRUD, endpoint
  testing, runtime property resolution, and routed Shortcut execution.
- Existing integrations are YAML definitions shipped through `@dashwise/assets`
  or entered through the Integrations settings UI. The UI has curated and
  manual flows with environment overrides and endpoint testing.
- Shortcuts retain the existing representation used by the Search indexer and
  frontend. The indexer materializes records from configured integrations;
  routed actions are resolved by the backend. SDK resources must adapt to this
  representation rather than adding a parallel Shortcut model.
- Widgets and Glanceables use existing JSON definitions, resolvers, and
  templates in `@dashwise/integrationskit`. They are configured and persisted
  by existing dashboard records and rendered by Dashboard and Frame clients.
- Activities already have shared types, an `@dashwise/integrationskit`
  authenticated publisher, PocketBase persistence, ownership checks, and a
  backend broadcast path. Resource state updates need a separate transient
  subscription protocol and must not become Activities.
- Live backend data exists for specific systems such as System Agent metrics.
  The repository does not currently expose a generic integration resource
  registry, lifecycle supervisor, or authenticated topic subscription API.
- PocketBase schema changes use timestamped JavaScript migrations; API source
  contracts and generated frontend clients are maintained through the existing
  OpenAPI generation scripts.

## Compatibility and implementation direction

- Keep YAML integrations on their current execution and rendering path. The SDK
  runtime should coexist with them and adapt SDK contributions into existing
  Apps, Shortcuts, Actions, Widgets, Glanceables, and Activities.
- Keep integration instance ownership and authentication server-resolved.
  Persist only validated configuration, encrypted secrets, and serializable
  resource snapshots; never serialize live clients or callbacks.
- Put common lifecycle, resource, action, event, transport, storage, and
  contribution contracts in a public SDK package. Keep the backend runtime
  responsible for loading trusted integration packages, instance isolation,
  persistence, authorization, and delivery to connected clients.
- The Home Assistant package and the small REST example must consume only the
  public SDK. Their capabilities should not be wired through Home Assistant-
  specific branches in the backend or generic SDK.

## Primary code locations

- SDK-adjacent package: `packages/integrationskit/`
- Integration persistence and resolution: `apps/backend/src/lib/data/integrations.ts`
- Integration API: `apps/backend/src/routes/integrations.route.ts`
- Shortcut model and action routing: `apps/backend/src/lib/data/shortcuts.ts`
- Activity persistence and broadcast: `apps/backend/src/lib/data/activities.ts`,
  `apps/backend/src/lib/activity.ts`, and `packages/integrationskit/activities.ts`
- Existing integration settings UI: `apps/web/src/app/(authenticated)/settings/integrations/`
  and `apps/web/src/components/settings/integrations/`
- PocketBase migrations: `pocketbase/migrations/`
- API contracts and generation: `apps/backend/openapi.yaml` and root `generate` scripts
