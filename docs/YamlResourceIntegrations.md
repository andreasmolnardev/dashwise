# YAML resource collections

YAML integrations can materialize REST endpoint results into Dashwise's shared
resource store. Put collection declarations under `configuration.resources`.
Each collection names an endpoint, an identity path, and the fields that views
may filter or search. If the endpoint maps an object that contains the item
array, set `items_path` to that array's path.

```yaml
details:
  name: Example Status
  slug: example-status
configuration:
  endpoints:
    services:
      url: https://status.example.test/api/services
      response:
        type: json
  resources:
    services:
      endpoint: services
      id_path: id
      name_path: name
      capabilities: [list, detail, search]
      fields:
        - name: status
          type: string
          source: status
          filterable: true
        - name: description
          type: text
          source: description
          searchable: true
```

The endpoint's mapped response must be an array of objects, or an object whose
array is selected by `items_path`. `items_path`, `id_path`, `name_path`, and
field `source` values are dot-separated paths, and may start with `$.`; numeric
segments address array elements. Supported field types are
`string`, `text`, `url`, `datetime`, `date`, `number`, `integer`, `boolean`,
`object`, and `array`. Resource types are namespaced as
`integration.<integration-slug>.<collection-slug>`.

The Go resource sync refreshes these collections and endpoint/computed result
resources once per minute. Existing widget renderers still receive their
current payload shape, reconstructed from an owner-scoped resource query.
Failed endpoint runs keep their last successful snapshot. Removed collection
items and deleted YAML integration instances are reconciled from the resource
store.

Collections declaring the `monitoring` capability also appear in Monitoring's
**Integrated systems** view. Their declared resource fields are shown as
attributes, so YAML integrations can add monitoring data without a
provider-specific frontend adapter.

## Resource-backed integration widgets

A widget can declare `resource_query` to opt into the shared resource query
path instead of relying only on its integration's endpoint/computed payload.
The backend applies the authenticated owner's scope and returns the result in
`data.resourceView` as `{ items, total, limit, offset }`. `items` are ordinary
resource records, including their `type`, `data`, and provider metadata. The
query declaration accepts the same `types`, `provider`, `providerInstanceId`,
`capabilities`, `filters`, `search`, `orderBy`, `limit`, and `offset` fields as
the resource API. At least one resource type is required; the owner is always
derived from the authenticated session.

```yaml
widgets:
  - key: recent-services
    name: Recent services
    template: columns
    resource_query:
      types: [integration.example-status.services]
      orderBy: updatedAt
      limit: 20
    data:
      source: resourceView.items
```

Widgets without `resource_query` keep their existing `consumerData` behavior.
The YAML runtime still supplies endpoint/computed data, so a resource-backed
widget may combine `resourceView` with those existing integration values.

## Beszel

The Beszel YAML integration declares its `systems` collection as
`integration.beszel.systems` resources with the `monitoring` capability. The
resource mapping exposes current status, host information, usage, load, and
network fields; integration credentials remain in the encrypted integration
environment.
