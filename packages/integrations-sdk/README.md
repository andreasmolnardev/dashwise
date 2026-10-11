# `@dashwise/integrations-sdk`

The authoring contract for trusted Dashwise integrations. It provides typed,
declarative definitions and the runtime interfaces passed to lifecycle hooks.
It does not start processes, persist data, or implement Dashwise transport;
those belong to the backend runtime. The legacy `@dashwise/integrationskit`
package continues to render YAML Widgets and Glanceables.

## Create an integration

```ts
import { defineIntegration, resourceCollection, type ResourceRecord } from "@dashwise/integrations-sdk";

type Entity = ResourceRecord & { state: string };
export default defineIntegration({
  id: "example", name: "Example", version: "1.0.0",
  config: {
    endpoint: { type: "url", required: true },
    token: { type: "secret", required: true },
  },
  resources: { entities: resourceCollection<Entity>({ persistent: true, shortcuts: true }) },
  actions: {},
  apps: [{ id: "entities", name: "Entities" }],
  widgets: [], glanceables: [],
  async setup(integrations) {
    integrations.logger.info("Configured", { endpoint: integrations.config.endpoint });
    const token = await integrations.secrets.get("token");
  },
  async start(integrations) {
    await integrations.resources.entities.sync([], { completeness: "complete" });
  },
});
```

`config` is validated per instance. Secret fields are excluded from
`integrations.config` and retrieved only through `integrations.secrets`. A
resource has a stable ID within its collection. A Shortcut can belong to one or
more declared Apps, and Apps are filtered views of shared Shortcut records.
Every exposed Shortcut must have at least one valid App membership; the runtime
adapter validates those IDs.

## Resources and synchronization

Collections expose `get`, `upsert`, partial `update`, `remove`, and `sync`.
Complete snapshots reconcile omitted resources; partial snapshots only update
included records. Failed discovery must not call complete sync, and a rejected
sync must not clear the prior snapshot. Full resource identity includes the
integration instance, collection, and resource IDs. Persisted snapshots restore
as stale until an upstream synchronization succeeds. Only JSON data is stored.

## Actions and contributions

Actions have a stable ID, optional JSON Schema input, and a typed `execute`
handler. The backend validates ownership, membership, availability, and input
before dispatch. A handler result does not prove the upstream state changed;
confirmed state comes from resource synchronization. Widgets and Glanceables
declare contributions for existing Dashwise surfaces. Durable Activities are
published imperatively; high-volume resource changes use transient subscriptions.

Widget and Glanceable `configSchema` values use `IntegrationConfigSchema`, a
property-field map separate from JSON Schema action inputs. Use a
`shortcut-select` field to let users choose resource-backed Shortcuts:

```ts
const widgetConfig = {
  entity: {
    type: "shortcut-select",
    required: true,
    appIds: ["entities", "lights"],
    collectionIds: ["entities"],
  },
  selectedEntities: {
    type: "shortcut-select",
    multiple: true,
    appIds: ["entities"],
    collectionIds: ["entities", "sensors"],
  },
} as const satisfies IntegrationConfigSchema;
```

`multiple` defaults to `false`: a single field stores one resource ID (`string`);
`multiple: true` stores an array of resource IDs (`readonly string[]`). `appIds`
and `collectionIds` optionally filter choices to resources exposed in any listed
App or collection. Omitting either filter leaves that dimension unrestricted.
The runtime validates selected IDs against the owning integration instance and
applicable filters. `IntegrationConfigValues<typeof widgetConfig>` infers the
settings value types. Compile-time coverage lives in
[`contracts/shortcut-select.typecheck.ts`](./contracts/shortcut-select.typecheck.ts).

Lifecycle hooks receive `integrations` with validated config, secret lookup,
typed resources, serializable instance storage, action dispatch, activities,
scoped events, managed HTTP/WebSocket/MCP clients, scheduler, logger, and
`onDispose` cleanup registration. Runtime implementations own cancellation and
release managed capabilities on stop.

[`examples/rest-status.ts`](./examples/rest-status.ts) is a REST-only example.
Home Assistant uses the same public contracts for persistent WebSockets,
dynamic entities, actions, Apps, Widgets, Glanceables, and Activities.
