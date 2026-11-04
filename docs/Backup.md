# Backing up Dashwise

The Go server stores account data in the SQLite database configured by
`DATABASE_PATH` (default `/data/dashwise.sqlite`). Wallpaper files live under
`DATA_DIR/wallpapers` (default `/data/wallpapers`), and the encryption key is
stored at `DATA_DIR/secret.key`. Back up the database, wallpaper directory, and
key file together. Without the key file, encrypted integration credentials and
monitoring endpoint credentials cannot be decrypted after restore.

For a consistent filesystem backup, stop Dashwise before copying the database,
wallpaper directory, and key file. If Dashwise must stay online, use SQLite's
backup API or `sqlite3`'s `.backup` command instead of copying only the main
database file; SQLite may also have active WAL files. Keep the key and files
from the same backup set.

The Migrate page creates an account export archive for moving data from the
older PocketBase-based Dashwise installation. That archive is a migration aid,
not a full instance backup: it does not include runtime configuration, other
users' data, or the wallpaper directory.
