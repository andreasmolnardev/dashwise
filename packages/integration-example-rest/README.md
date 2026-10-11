# REST status example integration

This workspace package is the small REST reference integration for
`@dashwise/integrations-sdk`. It checks one configured health endpoint, stores
its latest status as a persistent `endpoint` resource, and exposes that
resource as a Shortcut in the `services` App. A scheduled request keeps the
resource current; failed requests update availability without reconciling the
collection as empty.

The instance configuration is:

- `endpoint`: absolute URL for the health check.
- `serviceName`: label shown for the resource.
- `apiKey`: optional bearer token, stored as a secret and read through
  `integrations.secrets.get()`.
- `pollIntervalSeconds`: refresh interval from 10 seconds to one hour.

The integration uses only the public SDK definition, resource, configuration,
secret, HTTP, and scheduler interfaces. It has no Dashwise backend imports and
does not require a Home Assistant dependency or persistent upstream socket.
