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

Widget and Glanceable `configSchema` values can use `IntegrationConfigSchema`,
a typed property-field map separate from JSON Schema action inputs. Existing
JSON Schema contribution configs remain accepted for compatibility; use typed
property fields when declaring resource selectors. `defineIntegration`
preserves nested contribution settings and binding keys when inferring the
definition. Use a
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

SDK contributions carry the existing IntegrationsKit presentation payloads.
Widgets can select `columns`, `vertical-list`, `icon-details-card`, `iframe`,
or `image` through `template`, and provide JSON-safe `properties` and optional
`exampleProps`. Glanceables accept JSON-safe `properties`, `icon`, `text`,
`columns`, and optional `exampleProps`. These map to the existing IntegrationsKit
Widget and Glanceable JSON formats and renderers; SDK integrations do not provide
executable frontend components or custom renderer functions.

Use `resourceBindings` on a Widget or Glanceable to declare the resolved data
it consumes. Each output key references a `shortcut-select` setting by
`configKey`:

```ts
{
  id: "entity-list",
  name: "Entity list",
  configSchema: {
    selectedEntities: { type: "shortcut-select", multiple: true },
  },
  resourceBindings: {
    entities: { type: "shortcut-select", configKey: "selectedEntities" },
  },
}
```

The runtime verifies that each binding points to a `shortcut-select` field,
resolves its configured resource IDs, and subscribes to those resource
identities. It supplies the current `ResourceRecord` under the declared output
key (`ResourceRecord | undefined` for a single selection and a readonly record
array for a multiple selection); resource changes update that bound data without
requiring integrations to make direct API calls from Dashboard, Search, or
Frame clients. App and collection filtering is configured on the referenced
`shortcut-select` field and is validated during resolution. The runtime injects
those values into the existing `data` object passed to IntegrationsKit so the
standard template/property resolution path consumes the live resource data.

Lifecycle hooks receive `integrations` with validated config, secret lookup,
typed resources, serializable instance storage, action dispatch, activities,
scoped events, managed HTTP/WebSocket/MCP clients, scheduler, logger, and
`onDispose` cleanup registration. Runtime implementations own cancellation and
release managed capabilities on stop.

[`examples/rest-status.ts`](./examples/rest-status.ts) is a REST-only example.
Home Assistant uses the same public contracts for persistent WebSockets,
dynamic entities, actions, Apps, Widgets, Glanceables, and Activities.

## Runtime lifecycle and instance recovery

An integration definition is code; an integration instance is one user's
configured connection to that code. Each instance has its own configuration,
secret values, storage, resource namespace, and lifecycle. The settings page
installs a trusted catalog entry, validates its configuration, and creates or
updates an instance. The backend supervisor starts enabled instances after
PocketBase is ready and stops them when they are disabled, removed, or the
backend shuts down.

Use `setup` to reject unusable configuration before connecting, `start` to
establish clients and synchronize initial state, `stop` to stop accepting work,
and `dispose` or `onDispose` to release local resources. Scheduled jobs receive
an `AbortSignal`. On stop, the runtime cancels scheduled work, aborts managed
HTTP requests, closes managed WebSockets, and runs registered cleanup handlers.
Keep remote client objects and callbacks in the integration's closure; persist
only JSON values through `integrations.storage`.

Persistent resource collections are restored from the owning instance's stored
snapshot after a restart. Restored rows are marked stale until the integration
successfully synchronizes with its service. If discovery fails, preserve the
last known rows and report the failure; only a successful complete snapshot may
remove resources that were not returned. Resources from different instances
remain isolated even when their upstream IDs match.

## Apps, Shortcuts, and Actions

An App is a named view in Dashwise Search. Give each Shortcut resource at least
one declared App ID, either on the collection or on the resource. A resource
may belong to several Apps; it remains one resource with one composite identity
and appears in each matching App. The backend adapts each exposed resource to
Dashwise's existing Shortcut representation, so Search and App clients do not
need an upstream-service client.

Declare an Action with an ID, a name, an optional JSON Schema `inputSchema`,
and an `execute(integrations, resource, input)` handler. Put the Action IDs a
resource supports in its `actions` list. Dashwise presents those Actions from
the Shortcut's More Actions menu and sends the selected resource identity and
input to the backend. The backend checks that the authenticated user owns the
instance, that the resource advertises the Action, that it is available, and
that the input passes the declared schema before dispatching the handler.
Validate service-specific limits in the handler too. Treat the handler result
as an acknowledgement; synchronize the resource again to report confirmed
upstream state. Handlers receive an optional `AbortSignal` as their fourth
parameter and have a 30 second deadline. The runtime rejects overlapping
Actions for one resource with a conflict response so concurrent commands do
not race against the same upstream state.

## Widgets and Glanceables

SDK contributions use JSON data with the existing IntegrationsKit templates and
formats. A Widget can choose `columns`, `vertical-list`, `icon-details-card`,
`iframe`, or `image`; its properties describe the content consumed by that
template. A Glanceable declares its icon, text, columns, and properties using
the established Glanceable format. Do not put executable code in a contribution
or expect the browser to load the integration package.

Declare `shortcut-select` fields in `configSchema` for resources users can pick
in Widget and Glanceable settings. `resourceBindings` maps each selected field
to a named data value. The backend validates that selected IDs belong to the
same instance and satisfy the field's App and collection filters. On each
resolution it supplies the current resource record or records under the binding
key; the existing IntegrationsKit renderer resolves those values in the
contribution properties. `exampleProps` supplies preview data before a live
instance binding is available.

## Resource subscriptions and the Activity Layer

Use resource subscriptions for frequent state changes that should refresh open
clients. They are transient events, not durable Activity records. The backend
publishes an update containing the integration instance ID, collection ID,
resource ID, monotonically increasing instance-local revision, and `upsert` or
`remove` operation. A client first obtains authorized current data through the
SDK resource or contribution API, then subscribes only to the identities it
needs on the existing authenticated Activity Layer WebSocket. It unsubscribes
when the view no longer needs those resources. On reconnect it replays active
subscriptions and resolves a fresh snapshot; clients should ignore revisions
that are not newer than the last one they applied.

The Activity Layer does not connect to Home Assistant or perform upstream
synchronization. It distributes changes already accepted by the backend runtime
to authorized Dashwise clients. Keep resource subscriptions scoped to the
instance, collection, and resource identity, and never use them as a substitute
for the persisted global Activity history.

## Transports and external clients

Integrations can use ordinary JavaScript or TypeScript dependencies already
available to the trusted package. For simple HTTP services, prefer
`integrations.http.fetch`; it applies lifecycle cancellation and a bounded
request timeout. For long-lived upstream protocols, use a client library that
implements that protocol and provide the runtime-managed WebSocket connection
where it fits. Authentication formats, message types, reconnection policy, and
protocol-specific commands belong to the integration's client adapter. The
runtime owns cancellation and cleanup when an instance stops.

The managed HTTP helper combines caller cancellation with instance lifecycle
cancellation and applies a 15 second request timeout. The managed WebSocket
helper bounds connection setup to 10 seconds and closes the socket when the
instance stops. Scheduler tasks also receive an `AbortSignal` and are cancelled
on stop.

The runtime also exposes a scheduler for polling, an event bus for messages
between runtime code, and an MCP capability that calls tools registered by the
host. `integrations.mcp.call` is not an automatic bridge from arbitrary MCP
tools to users: expose an operation through a declared, authorized Action and
validate its input. An integration may use a protocol's npm client directly
when the runtime helper does not expose the feature it needs. Keep credentials
in `secret` config fields and pass them only to the client operation that needs
them.

## Configuration, secrets, and trust boundary

The install form is generated from the catalog definition's `config` schema.
Configuration is validated when an instance is created or updated. Values
declared as `secret` are stored encrypted by the backend, omitted from ordinary
instance responses and `integrations.config`, and read through
`integrations.secrets.get()`. A blank secret on edit means keep the saved
secret. Do not log credentials or copy them into resource attributes, Action
results, Activity metadata, or contribution data.

The catalog contains trusted, statically bundled integration definitions.
Installing an entry creates an instance; it does not download or evaluate
user-supplied code. Integration packages run in the backend process and can
make network requests as that process. Review package code and dependency
changes as backend code. Use configured service URLs, validate response data,
bound response sizes and polling rates, and avoid constructing request
destinations from untrusted resource values. This trust boundary permits local
and private homelab service addresses; it is not a sandbox for arbitrary code.
The runtime rejects cloud metadata hostnames and addresses, and allows private
or special-use IP ranges only when the matching host and port appear in a
declared URL configuration field for that instance. It checks DNS answers and
refuses cross-origin HTTP redirects. DNS is checked before the transport
connects, but the transport may resolve the hostname again; DNS rebinding is
not fully prevented by this preflight check.

Instance ownership is checked by the backend for resource reads, contribution
resolution, Action execution, and subscriptions. Never treat an instance ID or
resource ID supplied by a browser as proof of authorization. The backend must
resolve the composite identity against the authenticated user's owned instance
before returning data or invoking integration code.

## YAML integration compatibility

YAML integrations continue through the existing integration resolver and
IntegrationsKit rendering path. They do not need to implement `defineIntegration`
or migrate their configuration to SDK resources. Keep existing YAML IDs,
endpoint keys, persisted page configuration, Widget keys, Glanceable formats,
and shortcut behavior compatible. SDK integrations are selected from the
trusted SDK catalog and use their separate instance/resource APIs; do not route
them through the YAML resolver. A future migration can be designed separately
if an installed YAML integration needs an SDK-only capability.

## Testing an integration

Run the workspace checks from the repository root:

```sh
bun install
bun run typecheck
bun run lint
bun test
bun run build
```

For a package, add unit tests beside its implementation and run them with
`bun test packages/<integration>/test`. Mock the upstream client at the package
boundary so tests can control successful discovery, malformed responses,
connection loss, reconnect, entity removal, service-call errors, and shutdown.
Check both resource contents and whether synchronization used `complete` or
`partial` semantics. A failed request must retain known resources instead of
being treated as an authoritative empty snapshot.

Also validate the integration through the actual Dashwise path: install and
configure it in Settings, verify its App and dynamic Shortcuts in Search, execute
an Action, and confirm the next resource synchronization reflects the result.
Configure a Widget and Glanceable with selected resources, change one resource,
and confirm only clients subscribed to that identity refresh. Restart the
backend and verify the saved configuration and stale resource snapshot recover
without reinstalling the instance. Exercise authenticated ownership checks,
secret redaction, invalid Action input, unauthorized subscriptions, and
instance deletion while a client is connected.

## Home Assistant reference integration

[`packages/integrations/homeassistant`](../integrations/homeassistant) is the
full reference implementation. It exports a `defineIntegration` definition
with URL and secret token configuration, an `entities` collection for discovered
Home Assistant entities, a persistent `status` collection, declared Apps,
resource-backed Actions, two Widgets, and three Glanceables. It owns the
Home Assistant protocol client in the integration package; no Dashboard,
Search, or Frame client talks to Home Assistant directly.

On startup, the package opens an authenticated Home Assistant WebSocket,
requests an initial state and registry snapshot, maps entities into SDK
resources, and subscribes to entity and registry updates. Registry refresh
failure retains the last valid entity snapshot. Resource synchronization powers
the existing Search Apps and any Widget or Glanceable bound to the selected
entity. The Actions call the appropriate Home Assistant service and rely on the
subsequent state event to confirm a change. Connection loss/recovery and
Home Assistant start/stop lifecycle events publish durable Activities through
`integrations.activities.publish()`.

The integration package tests mapping, snapshot validation, WebSocket client
behavior, Actions, contribution definitions, and lifecycle behavior with a
mock client. [`packages/integration-example-rest`](../integration-example-rest)
is the smaller second example: it uses the same public SDK for configured HTTP
polling and a persistent service-status Shortcut, without a long-lived socket.
Together the examples show that the SDK supports both a synchronized service
and a small REST integration without adding Home Assistant-specific behavior to
the runtime.
