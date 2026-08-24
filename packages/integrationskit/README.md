# dashwise-integrationskit

Integrate with APIs, perform computations and mappings based on the responses, and render widgets and glanceables from declarative YAML configuration.

## Overview

`dashwise-integrationskit` is the runtime engine used by Dashwise to turn integration configuration into rendered UI payloads.

It handles:
- endpoint fetching and dependency resolution
- computed field evaluation
- environment variable interpolation
- widget and glanceable template rendering
- preview mode support

## Core concepts

- **Integration JSON**: The parsed config for an integration, including `configuration.endpoints`, `configuration.computed`, `configuration.lookup_tables`, `configuration.environment_variables`, `widgets`, and `glanceables`.
- **Widget**: A tile of UI that uses templates like `columns`, `vertical-list`, or `icon-details-card`.
- **Glanceable**: A single-line label with optional icon support.
- **Runtime data**: The resolved endpoint responses and computed values that feed widget/glanceable rendering.
- **Environment**: A flat set of values computed from integration defaults, widget input, endpoint output, and computed fields.

## Runtime flow

### 1. Resolve integration runtime properties

`resolveIntegrationRuntimeProperties()` is the main entrypoint for integration-backed runtime resolution.

It performs:
- environment initialization from `integrationJSON.configuration.environment_variables`
- endpoint resolution via `resolveEndpointCatalog()`
- computed field evaluation via `resolveComputedFields()`
- output of a runtime state object containing:
  - `endpoints`: resolved endpoint responses
  - `computed`: computed field values
  - `lookup_tables`: lookup values from integration config
  - `env`: final runtime environment values

### 2. Endpoint resolution

Endpoints are defined in `integrationJSON.configuration.endpoints` and support:
- `url`, `method`, `headers`, `body`
- variable interpolation using `${VAR_NAME}` syntax
- `response.data_path` to extract nested data
- `response.data_set_env` to write response values back into the runtime environment
- caching via `EndpointRuntimeCacheAdapter`
- automatic ordering based on dependency analysis of `${...}` references

`resolveEndpointCatalog()` schedules endpoint requests in dependency order and reuses cached responses when available.

### 3. Computed fields

`configuration.computed` values are resolved with `resolveComputedFields()` and support:
- nested interpolation via env values
- `iterate_over` / `prototype` iteration patterns
- conditional logic with `if(...)` expressions
- operations such as `join`, `avg`, `lookup`, `index_lookup`, `expr`, and `human_bytes`
- references to `computed.*`, `endpoints.*`, and current iteration item data

### 4. Build widget and glanceable props

Once runtime data is available, widgets and glanceables are rendered as resolved props:
- `resolveWidgetProperties()` converts widget definitions into `ResolvedWidget` output for templates
- `resolveGlanceableRuntimeData()` resolves glanceable runtime data for inline text rendering

The widget resolver supports templates:
- `columns`
- `vertical-list`
- `icon-details-card`
- `iframe`

It resolves values for:
- `header` and `header.show_if`
- columns, list items, icons, badges, progress bars, stats blocks, thumbnails, titles, and actions
- integration icon references through environment interpolation

Columns support either `progress` or `stats.primary` / `stats.secondary` in each item.

## React component usage

The package exports `Widget` and `Glanceable` client components that can render integration content directly.

- `Widget` resolves runtime data when no precomputed `data` or `resolved` props are supplied.
- `Glanceable` can render either resolved data or legacy glanceable payloads.

Both components support `isPreview` mode to render fallback/example values without live endpoint calls.

## Public exports

The package exposes several runtime helpers and components:
- `Widget` (`Widget.tsx`)
- `Glanceable` (`Glanceable.tsx`)
- `resolveWidgetProperties` (`data/resolveProperties.tsx`)
- `resolveWidgetRuntimeData` (`data/resolveProperties.tsx`)
- `resolveGlanceableRuntimeData` (`data/resolveProperties.tsx`)
- `resolveIntegrationRuntimeProperties` (`data/resolveProperties.tsx`)
- `getRuntimeEnv` (`data/resolveProperties.tsx`)
- `flattenToEnv` (`data/resolveProperties.tsx`)
- `resolveEndpointCatalog` / `getEndpointData` (`data/getEndpointData.tsx`)

## Preview mode

Preview mode is used when `isPreview=true`:
- endpoint execution is skipped
- runtime data is not fetched from live APIs
- widget resolution still runs and can render fallback/example placeholder values

## Why this package exists

`integrationskit` keeps integration rendering logic self-contained and declarative.
It separates the integration config from the UI templates and provides a shared runtime engine that can be used by backend and frontend consumers.
