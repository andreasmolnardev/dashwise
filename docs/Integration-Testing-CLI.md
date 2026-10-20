# Integration testing CLI

The standalone Bun CLI exercises integrations without starting the Dashwise web app, backend server, or PocketBase. YAML definitions use the same `@dashwise/integrationskit` resolver as Dashwise. SDK definitions run locally against an in-memory host for resources, storage, activities, events, and scheduled jobs.

Run commands from the repository root:

```sh
bun run integrations validate yaml packages/assets/integrations/jellyfin.yaml
bun run integrations test yaml packages/assets/integrations/jellyfin.yaml --env-file .env.integration
bun run integrations test yaml packages/assets/integrations/jellyfin.yaml --env URL=http://jellyfin:8096 --fixture ./fixtures/jellyfin-items.json --widget jellyfin-recently-added
bun run integrations inspect sdk packages/integrations/homeassistant
bun run integrations test sdk packages/integrations/homeassistant --config ./homeassistant.test.json --duration 3
```

YAML tests show endpoint request details, raw and mapped responses, computed values, and resolved widget data. Add `--shortcuts` to resolve Search shortcut definitions. `--fixture` accepts a JSON object keyed by endpoint ID, with values either raw response JSON or `{ "status": 200, "headers": {}, "body": ... }`. A `default` fixture key can supply the same body to each endpoint. Fixture mode makes no network calls. Output is pretty-printed by default; `--json` emits compact JSON for scripts.

SDK tests import the trusted package's default integration definition, validate its config, run `setup` and `start`, and report in-memory resource snapshots, contributions, logs, activities, events, and scheduled jobs. Add `--run-scheduled` to invoke each captured scheduler task once. `--duration` keeps the host open to collect event-driven updates. `--action ID --resource collection/id --input '{"key":"value"}'` explicitly executes an action against the live service; actions may change upstream state. The host closes integrations on exit.

Supply connection settings with `--env-file`, repeated `--env KEY=VALUE`, or SDK `--config` JSON. Keep local credential files out of version control. The CLI redacts values for token, password, secret, authorization, and API-key fields from displayed results and errors. Live tests make direct requests to the configured upstream service; they require the service to be reachable but do not require a running Dashwise instance. HTTP requests have a 15-second timeout. TLS verification remains enabled unless `--allow-insecure-tls` is explicitly passed for a YAML test.
