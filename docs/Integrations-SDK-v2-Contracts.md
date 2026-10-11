# Integrations SDK v2 shared contracts

This is the initial cross-package contract for SDK v2. The SDK owns public
authoring types; the backend runtime owns process/lifecycle management, storage,
ownership, persistence, and transport. The existing YAML integration pipeline
continues to use its current definitions and resolvers.

## Public integration definition

An integration package exports a definition created with
`defineIntegration({ ... })`. Its stable `id`, `name`, `version`, config schema,
resources, actions, Apps, Widgets, and Glanceables are declarative SDK values.
`setup`, `start`, `stop`, and `dispose` receive the named `integrations`
runtime API. No integration package imports backend internals.

The SDK runtime API has these generic capabilities:

- `config`: validated, instance-scoped configuration with secret values
  accessed only through `integrations.secrets`.
- `resources`: typed collections with `get`, `upsert`, partial `update`,
  `remove`, and authoritative `sync`; synchronization failure is distinct from
  an empty successful snapshot.
- `storage`: serializable instance-scoped persistence for cursors and local
  state. Runtime clients, callbacks, and credentials are not persisted here.
- `actions`: execute declared handlers against a resource after input,
  availability, and ownership checks.
- `activities`: publish meaningful durable events through the existing
  Activity model; high-volume resource changes use transient subscriptions.
- `events`, `http`, `websocket`, `mcp`, and `scheduler`: generic managed
  capabilities with cancellation and cleanup.
- `logger` and `onDispose`: scoped observability and cleanup registration.

## Resource and Shortcut adaptation

Each resource has an integration instance ID, collection ID, stable resource
ID, name, optional icon/type/tags/state/attributes, availability, supported
Action IDs, update time, and optional upstream identity. That composite
identity is used for persistence, authorization, subscription, and Shortcut
adaptation. Every exposed resource is assigned to one or more declared App IDs
and becomes a Shortcut in Dashwise's existing model. Apps are filtered views;
they do not own duplicate Shortcut records.

Resource updates advance an instance-local revision only when data changes.
The runtime persists snapshots for configured collections and sends scoped
transient resource events through the Activity Layer. Restored snapshots are
marked stale until an upstream sync succeeds. Partial or failed discovery
never removes previously known resources.

## Action and contribution adaptation

Action definitions have a stable ID, input schema, and an `execute(integrations,
resource, input)` handler. The backend resolves action membership from the
resource, validates ownership and input, then returns a structured result or
error. A command request is not evidence that remote state changed; confirmed
state comes from the integration's resource synchronization.

SDK Apps, Widgets, Glanceables, and Activities map onto existing Dashwise
contribution formats and surfaces. Widget and Glanceable rendering remains in
`@dashwise/integrationskit`; SDK-backed data is resolved by the backend and
subscribed to by authorized Dashboard, Search, and Frame clients through the
Dashwise transport.

## Runtime and installation boundary

The backend runtime maintains a trusted local catalog of SDK definitions and
creates independently owned instances from the existing Integrations UI.
Integration code is not accepted from an arbitrary user-supplied URL or
evaluated from YAML. Existing YAML plugins remain on their established path.
Secrets are stored separately or encrypted at rest and are never included in
catalog, contribution, resource, activity, or client responses.

## Validation examples

The Home Assistant package uses only these public contracts for persistent
WebSocket state, entity resources, actions, Apps, Widgets, Glanceables, and
Activities. A separate REST example uses the same definition/config/resource
contracts with a short request lifecycle, proving that persistent connections
are optional.
