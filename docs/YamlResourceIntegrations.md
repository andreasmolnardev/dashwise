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

## Beszel

The Beszel YAML integration declares its `systems` collection as
`integration.beszel.systems` resources with the `monitoring` capability. The
Monitoring app shows those systems under **Integrated systems** and displays
their current status, host information, usage, load, and network fields. The
resource mapping only copies those declared fields; integration credentials
remain in the encrypted integration environment.
