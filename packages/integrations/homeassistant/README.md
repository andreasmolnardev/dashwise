# Home Assistant reference integration

This package is the Home Assistant reference integration for
`@dashwise/integrations-sdk`. It owns the Home Assistant API client, entity
mapping, actions, Apps, Widgets, Glanceables, and lifecycle activities. It does
not import Dashwise backend or frontend code.

## Configuration

- **Home Assistant URL**: the HTTP(S) base URL, including an optional reverse
  proxy path.
- **Long-lived access token**: create a Home Assistant long-lived access token
  and save it as the integration secret. The token is only read through
  `integrations.secrets`; it is never logged or copied into resources.

The package uses Home Assistant's maintained
[`home-assistant-js-websocket`](https://github.com/home-assistant/home-assistant-js-websocket)
client. It uses the client's long-lived-token authentication, authenticated
connection lifecycle, event subscriptions, reconnect behavior, and service
calls. The protocol's registry commands provide entity, device, and area
metadata. The SDK receives JSON resource records and owns persistence and Dashwise
client transport.

## Discovery and resources

Entity states are exposed in the persistent `entities` resource collection.
Entity IDs are resource IDs; Home Assistant registry `unique_id` values are
retained as upstream IDs so entity renames can be reconciled. Each resource is
assigned to the Entities App and any matching domain or device App. The same
resource identity is reused across Apps.

An initial entity callback is required before the integration can start. The
client waits up to 30 seconds for the first entity-state snapshot. Invalid or
failed state discovery rejects startup and never calls an empty complete sync. A
successful empty state snapshot is valid and removes stale resources. Registry
metadata enriches the snapshot; failed registry requests retain last-known
metadata and do not turn successful state discovery into an empty snapshot.
The maintained client reconnects its subscriptions after a connection loss;
the SDK's complete sync semantics reconcile restored resources after an
authoritative snapshot.

## Actions

The resource's action list is derived from the HA domain and reported entity
capabilities. It includes entity details, light toggle/on/off/brightness/color,
automation enable/disable/trigger, script and scene activation, helper value
operations, and common cover, lock, timer, counter, and climate controls. Action
handlers call Home Assistant services with the canonical entity ID as target.
The successful service response is reported as command acceptance only; the
resource's later subscribed state is the confirmation of the resulting state.

## Contributions

The package declares Entities, Lights, Automations, Helpers, Sensors, Scenes,
Scripts, and Devices Apps. It also contributes an entity list Widget, a sensor
overview Widget, connection status and lights-on count Glanceables, and a
selected sensor value Glanceable. The entity list binds selected entity
Shortcuts to its `entities` data key; the sensor overview and sensor Glanceable
bind selected sensor Shortcuts; and the lights-on-count Glanceable binds the
selected lights. Each binding resolves current entity records and follows those
resource identities through the generic SDK contract, without Home
Assistant-specific Dashboard code.

Meaningful Home Assistant stop/start events are published as Activities. A
connection outage must last 30 seconds before an unreachable Activity is
published; recovery is published only if the outage was already reported.
Entity state changes remain resource updates and do not create Activities.
