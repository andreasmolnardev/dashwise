# Dashwise Foundation

A small reusable Go module for embedded application persistence. The initial
implementation provides SQLite connection setup, transactions, and versioned
application-owned migrations. It intentionally does not define Dashwise
resources, views, authorization rules, or domain collections.

## Open SQLite

```go
db, err := foundation.OpenSQLite(ctx, foundation.SQLiteOptions{
    Path: "data/app.sqlite",
})
if err != nil {
    return err
}
defer db.Close()

if err := db.ApplyMigrations(ctx, migrations); err != nil {
    return err
}
```

SQLite enables foreign keys, a configurable busy timeout, and WAL mode for
file-backed databases. `:memory:` uses a shared in-memory database.

## Define migrations

```go
var migrations = []foundation.Migration{
    {
        ID:   "001_initial",
        Name: "create initial tables",
        Up: func(ctx context.Context, tx *sql.Tx) error {
            _, err := tx.ExecContext(ctx, `CREATE TABLE example (id TEXT PRIMARY KEY)`)
            return err
        },
        Down: func(ctx context.Context, tx *sql.Tx) error {
            _, err := tx.ExecContext(ctx, `DROP TABLE example`)
            return err
        },
    },
}
```

Each migration runs in its own transaction and is recorded after it succeeds.
The application owns migration definitions and ordering. Rollback is explicit
and only works for migrations that provide a `Down` callback.

The public API is intentionally small while Dashwise proves the data model.
Add higher-level schemas, identity/session primitives, authorization hooks,
resource contracts, or alternative adapters only after their contracts are
validated in the application.
