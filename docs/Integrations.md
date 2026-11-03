# Integrations

Dashwise runs its API and integration runtimes in the Go server. Integration
instances, credentials, YAML execution, resource snapshots, and SDK lifecycle
state are stored or resolved by the Go backend. The React frontend keeps the
current integration settings and widget rendering experience.

## Integration types

- YAML integrations describe REST endpoints, response mappings, computed
  values, and optional resource collections. The Go YAML runtime executes
  them. Endpoint and computed results are materialized as `yaml` provider
  resources; explicit collections become typed resources with searchable and
  filterable fields.
- TypeScript SDK integrations are bundled from `packages/integrations` and run
  in the Go JavaScript runtime. The SDK exposes lifecycle hooks, resource
  collections, actions, activities, and notifications through a scoped host
  API.
- Built-in Dashwise domains such as Links, News, Monitoring, and Calendar keep
  their workflow-specific APIs while synchronizing queryable data into the
  common resource store.

## Data flow

Resources are the shared data layer. Providers own their records; the resource
store validates registered resource definitions, scopes queries by owner, and
supports declared search and filter fields. Views are saved resource queries
with presentation metadata. Dashboard widgets and app screens can also issue
ephemeral resource queries through the same contract.

The current widget UI still receives its established YAML widget blueprint and
data payload. For regular page loads, the Go compatibility adapter reconstructs
that payload from an owner-scoped query of materialized integration resources.
Preview requests with unsaved environment overrides execute the YAML definition
directly so the settings editor can preview pending changes.

## Resource collections in YAML

See [YAML resource collections](YamlResourceIntegrations.md) for the collection
declaration format. A collection binds a REST endpoint response to a resource
type, provider identity, schema, and capabilities. Use `searchable` and
`filterable` only for fields that should participate in resource queries.

## Code locations

- API server and workers: [`apps/backend/internal/app`](../apps/backend/internal/app)
- YAML integration API and storage: [`apps/backend/internal/integrationsapi`](../apps/backend/internal/integrationsapi), [`apps/backend/internal/integrations`](../apps/backend/internal/integrations)
- YAML execution: [`apps/backend/internal/yamlruntime`](../apps/backend/internal/yamlruntime)
- Resources and provider synchronization: [`apps/backend/internal/resources`](../apps/backend/internal/resources), [`apps/backend/internal/resourcesync`](../apps/backend/internal/resourcesync)
- SDK runtime and manager: [`apps/backend/internal/jsruntime`](../apps/backend/internal/jsruntime), [`apps/backend/internal/sdkmanager`](../apps/backend/internal/sdkmanager)
- SDK contracts and provider packages: [`packages/integrations-sdk`](../packages/integrations-sdk), [`packages/integrations`](../packages/integrations)
- Retained frontend: [`apps/web/src/components/widgets`](../apps/web/src/components/widgets)
- API contract and generated clients: [`apps/backend/openapi.yaml`](../apps/backend/openapi.yaml), [`apps/web/src/lib/api`](../apps/web/src/lib/api)
