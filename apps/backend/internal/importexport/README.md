# Dashwise PocketBase migration archive

The Go importer consumes JSON with this envelope:

```json
{
  "format": "dashwise-pocketbase-export",
  "version": 1,
  "exportedAt": "2026-11-03T12:00:00Z",
  "source": "dashwise-pocketbase",
  "tables": {
    "links_collections": [],
    "link_items": []
  }
}
```

The export modal in the PocketBase application must map collection records to
the canonical Go table names and field names in `tables`. Values use their
JSON representation; SQLite JSON columns remain JSON strings. It must not
include `auth_users`, password hashes, bearer tokens, sessions, or generated
PocketBase auth records. Every row's exported `owner_id`/`user_id` is ignored
and replaced by the account that is authenticated during import.

Supported canonical tables are `links_collections`, `links_folders`,
`links_tags`, `link_items`, `links_rss_feeds`, all `news_*` domain tables,
`monitors`, `monitor_pings`, `monitoring_hosts`, their stats/history tables,
notification topics/items/tokens/forwarders, `activities`,
`activity_definition_settings`, `integrations`, `page_configs`, `saved_views`,
`resources`, `auth_user_properties`, and `wallpapers`. Activity definition
settings include enabled/config preferences and resource conditions in their
`settings_json` value; the importer reassigns the row to the authenticated
account and checks that condition integration, resource, and notification
topic references belong to that account. These names mirror the Go SQLite
schema. The legacy modal owns
mapping its PocketBase collection names (for example `linksLists`,
`linkItems`, `pageConfig`, and `integrations`) and legacy field names into
those canonical shapes.

Sensitive values are represented as plaintext only inside the user-downloaded
archive: integration `environment_cipher` becomes an `environment` object,
monitor `endpoint_auth` becomes `endpoint_auth_plain`, and System Agent host
`credential` becomes `token`. The Go endpoint re-encrypts these fields with
the new instance key before writing SQLite. Wallpaper rows contain
`contentsBase64` instead of a local `path`. Keep the archive private and delete
it after migration.

Import is a single SQLite transaction with foreign-key ownership checks. It
merges by primary/unique key into the currently authenticated user's account.
It does not replace or create the account itself, and it never imports login
credentials or device sessions. Requests are capped at 100 MB, each wallpaper
at 25 MB, and each archive at 100,000 records.

## Go wiring

Create the store after the domain stores and their migrations have initialized:

```go
transferStore, err := importexport.New(db, secretProtector, filepath.Join(cfg.DataDir, "wallpapers"))
if err != nil { /* return startup error */ }
if err := transferStore.Initialize(ctx); err != nil { /* return startup error */ }
transferHandler, err := importexportapi.New(transferStore, authenticateOwner(authStore))
```

Mount the returned handler at `/api/v1/migration/`. It serves authenticated
`GET /api/v1/migration/export`, `POST /api/v1/migration/validate`, and
`POST /api/v1/migration/import`. Validation applies the full import inside a
database transaction and rolls it back, including removing any wallpaper files
created during the preview. The UI requires a successful validation before it
enables import.
