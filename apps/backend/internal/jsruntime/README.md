# Embedded SDK provider runtime

`jsruntime` loads installed integration bundles compiled to CommonJS JavaScript
from `@dashwise/integrations-sdk`. It evaluates a definition exported through
`module.exports` or `module.exports.default`, exposes its JSON-safe manifest,
and supports setup/start/stop/dispose, named provider calls, and SDK actions.

The runtime does not expose `process`, `require` for host modules, filesystem,
or global `fetch`. `require` is restricted to the SDK identity helpers
(`defineIntegration`, `defineAction`, and `resourceCollection`). Provider code
uses the `IntegrationsRuntime` facade; calls cross the `Host.Call` capability
boundary as a dot-separated operation and JSON-like arguments. The host must
scope every call to the supplied integration instance and owning account.
Synchronous host operations execute on the VM goroutine and are wrapped in
resolved Promises. WebSocket connection setup is bounded and asynchronous;
messages and close/error events are marshalled back to the VM through the
instance dispatcher. Scheduler callbacks and `setTimeout` callbacks use the
same serialized queue, so only the VM-owning goroutine executes JavaScript.

## Host contract

`NewStoreHost` implements the persistent resource and storage operations. It
registers collection resource types from the manifest schema and scopes all
reads, writes, sync deletion and storage keys to the authenticated owner and
integration instance. Its constructor takes the open foundation database,
resource registry/store, owner ID, instance ID, and manifest. A runtime can use
it directly as `Options.Host`.

The store host currently supports:

- `resources.<collection>.get`, `.upsert`, `.update`, `.remove`, and `.sync`
- `storage.get`, `.set`, and `.delete`

Resource records are limited to 256 KB each, sync batches to 1,000 records
and 4 MB total, and storage values to 256 KB. Only `complete` sync removes
records missing from that sync; `partial` sync leaves them in place.

Additional `jsruntime.Host` implementations can dispatch operations such as:

- `resources.<collection>.get`, `.upsert`, `.update`, `.remove`, `.sync`
- `storage.get`, `.set`, `.delete`
- `secrets.get`, `actions.execute`, `activities.publish`, `.upsert`, `.clear`
- `http.fetch`, `websocket.connect`, `mcp.call`, and logger methods

`http.fetch` should return an object with `status`, optional `statusText`,
`headers`, and `body`; the JS facade exposes `ok`, `headers.get()`, `json()`,
`text()`, and `arrayBuffer()`. The host owns URL validation, credentials,
response-size limits, and network policy. Resource `get()` is synchronous, as in
the SDK; mutations return Promises.

## Execution boundary

Only trusted, installed bundles should be loaded. The Goja VM has no ambient
network or filesystem access, bridge operations receive a context, source size
is bounded, and each hook has a CPU/context deadline. A Goja VM is not a hard
memory or privilege sandbox, so loading user-supplied arbitrary JavaScript is
not supported. Keep the VM confined to the application process and validate
all inputs/outputs in the host.

Each provider instance owns a bounded serialized dispatch queue. The runtime
services queued callbacks while idle and while waiting for a supported
asynchronous lifecycle operation to settle. Queue overflow drops timer work
and closes a WebSocket whose events cannot be queued; callback failures are
logged without running Goja from transport goroutines. Lifecycle stop/dispose
cancels timers and closes sockets. The runtime is process-local and intended
for trusted installed bundles; it is not a hard memory or privilege sandbox.
