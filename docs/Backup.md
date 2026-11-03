# Backing up Dashwise

The Go server stores account data in the SQLite database configured by
`DATABASE_PATH` (default `/data/dashwise.sqlite`). Wallpaper files live under
`DATA_DIR/wallpapers` (default `/data/wallpapers`). Back up both locations.

For a consistent filesystem backup, stop Dashwise before copying the database
and wallpaper directory. If Dashwise must stay online, use SQLite's backup API
or `sqlite3`'s `.backup` command instead of copying only the main database file;
SQLite may also have active WAL files.

The Migrate page creates an account export archive for moving data from the
older PocketBase-based Dashwise installation. That archive is a migration aid,
not a full instance backup: it does not include runtime configuration, other
users' data, or the wallpaper directory.
