# Integrations

This document explains how Dashwise integrations work, how page config resolves integration consumers, and how runtime data is produced and consumed.

## Overview

Integrations are reusable data adapters that expose widgets and glanceables through YAML-backed definitions.

- Widgets and glanceables are defined by integration metadata stored in PocketBase.
- Each consumer is identified by:
  - integration type: `widget` or `glanceable`
  - consumer key
  - instance properties / input
- Integration runtime data is computed from integration environment variables, endpoint calls, and computed fields.
- The frontend receives a resolved blueprint for each consumer and uses that blueprint to render widget/glanceable UI.

## Integration YAML syntax

Dashwise integration YAML supports embedded template strings and fallback values inside most configuration fields.

- `${VAR}` expressions are replaced with values from environment variables, runtime input, or computed fields.
- `primary ??? fallback` attempts the primary expression first and uses the fallback only when the primary results in an empty string or still contains unresolved `${...}` tokens.
- If the final interpolated string begins with `{` or `[`, it is parsed as JSON automatically.
- Environment variable lookup is case-insensitive: exact name first, then uppercased, then lowercased.

The template engine resolves values in:
- `configuration.environment_variables`
- `endpoints` definitions (`url`, `body`, `custom_headers`, `auth`)
- `response_mapping` and `computed` fields
- widget `properties` and `search_items`

Common patterns:
- `title: "${name} ??? Untitled"`
- `icon: "${icon} ??? /icons/png/default.png"`
- `action: "url:${URL}/item/${id}"`
- `value: "${computed.metrics.cpu.avg_load}% ??? 0%"`

References can use runtime paths such as:
- `this.endpoints.<id>.mappedResponse.<path>`
- `computed.<id>.<field>`
- `lookup_tables.<table>.<key>`

## Key files

- `apps/backend/src/controllers/pageConfig.controller.ts`
- `apps/backend/src/controllers/integrations.controller.ts`
- `packages/integrationskit/data/resolveProperties.tsx`
- `apps/web/src/components/widgets/Widget.tsx`
- `apps/web/src/lib/pageIntegrationDataCache.ts`

## Page config integration flow

The route `POST /api/v1/pageConfig/integrationData` is responsible for resolving integration data for a user page.

### Request input

The endpoint accepts:

- `pageConfig?: PageConfig` — optional config object from the frontend
- `pageName?: string` — optional page name

If `pageConfig` is not provided, the backend loads the saved page config for the user and page.

### Consumer extraction

The backend scans the page config using `collectPageConsumers(...)`:

- `columns` items are treated as widget consumers, except frontend-only widgets such as:
  - `placeholder`
  - `main-clock`
  - `glanceable-clock`
  - `search-bar`
  - `link-view`
- `main-clock` is special: its nested glanceables are extracted as glanceable consumers.
- `glanceables` entries are treated as glanceable consumers.
- Each consumer is deduplicated by `consumer:key:properties`.

### Runtime reuse

The endpoint builds a single `sharedRuntimeCache` for the request.

- This cache is keyed by `integrationId` plus resolved input/env for the consumer.
- If multiple consumers share the same integration and environment, runtime data is resolved once and reused.
- This is the user/env-level reuse layer for page config integration resolution.

## Consumer resolution

The resolver flow is:

1. [`resolveConsumerDataForRequest(...)`](apps/backend/src/controllers/integrations.controller.ts)
2. [`resolveConsumerData(...)`](apps/backend/src/controllers/integrations.controller.ts)
3. [`resolveWidgetConsumer(...)`](apps/backend/src/controllers/integrations.controller.ts) or [`resolveGlanceableConsumer(...)`](apps/backend/src/controllers/integrations.controller.ts)

### Loading integration payload

The backend loads the integration payload from PocketBase using:

- `getIntegrationWithWidget(...)`
- `getIntegrationWithGlanceable(...)`

The payload includes:

- integration metadata
- environment definitions
- local integration state
- widget or glanceable YAML definition

### Environment resolution

The resolver builds the effective integration environment by:

- converting integration environment variables into a map
- resolving stateful hidden vars with [`resolveStatefulEnvironmentVariables(...)`](apps/backend/src/controllers/integrations.controller.ts)
- injecting user-specific values into environment variables via [`resolveUserInjectedEnv(...)`](apps/backend/src/controllers/integrations.controller.ts)
- applying the resolved environment into the integration definition using [`applyIntegrationEnv(...)`](apps/backend/src/controllers/integrations.controller.ts)

### Input merging

- Widget input is merged using [`mergeWidgetInput(...)`](apps/backend/src/controllers/integrations.controller.ts)
- Glanceable input is merged using [`mergeGlanceableInput(...)`](apps/backend/src/controllers/integrations.controller.ts)
- Glanceable config is merged via [`mergeGlanceableJSON(...)`](apps/backend/src/controllers/integrations.controller.ts)

### Runtime data resolution

The integration runtime data is computed by the integrations kit using:

- [`resolveWidgetRuntimeData(...)`](packages/integrationskit/data/resolveProperties.tsx)
- [`resolveGlanceableRuntimeData(...)`](packages/integrationskit/data/resolveProperties.tsx)

This performs:

- endpoint resolution through the integration configuration
- computed field evaluation
- environment flattening

### Request-level runtime cache

The integration controller can reuse resolved runtime data across multiple consumers in a single request.

- The cache key is built with [`createIntegrationRuntimeCacheKey(integrationId, mergedInput)`](apps/backend/src/controllers/integrations.controller.ts).
- When a second consumer matches the same integration and merged input, its runtime data is reused instead of resolving endpoints again.

## Blueprints and frontend rendering

Each resolved consumer returns a payload containing:

- `consumer`
- `key`
- `input`
- `env`
- `data`
- `blueprint`
- `cache` metadata

The blueprint includes:

- for widgets:
  - `template`
  - `widgetJSON`
  - `resolved` widget properties
- for glanceables:
  - `text`
  - `icon`
  - `glanceableJSON`

The frontend loads page integration data and primes a client-side cache with [`primePageIntegrationConsumerCache(...)`](apps/web/src/lib/pageIntegrationDataCache.ts).

Widgets read that cached payload with [`readPageIntegrationConsumer(...)`](apps/web/src/lib/pageIntegrationDataCache.ts) and render using `@dashwise/integrationskit/Widget`.

## Cache behavior

The backend tracks integration cache behavior using:

- `cache.policy` (`strict` or `cache-first`)
- `cache.retentionSeconds`
- `cache.stateKey`
- `cache.fromCache`
- `cache.staleReturned`

Runtime snapshots are persisted and may be served from cache when the integration configuration allows it.

## Summary

Integration resolution is a two-stage process:

1. Resolve integration runtime data once per user/integration/env combination.
2. Fill widget or glanceable configuration using the resolved runtime data and render blueprint.

That separation keeps integration endpoint/computed data resolution distinct from widget/glanceable template rendering and page config orchestration.
