# Backing up Dashwise

The Go server stores account data in the SQLite database configured by
`DATABASE_PATH` (default `/data/dashwise.sqlite`). Wallpaper files live under
`DATA_DIR/wallpapers` (default `/data/wallpapers`), and the encryption key is
stored at `DATA_DIR/secret.key`. Back up the database, wallpaper directory, and
key file together. Without the key file, encrypted integration credentials and
monitoring endpoint credentials cannot be decrypted after restore.

## Docker Compose backup

The repository scripts create and restore an offline snapshot of the default
Compose deployment. They stop the `dashwise` service before archiving the
entire data directory, so the SQLite database, wallpaper files, and encryption
key come from one consistent point in time. The backup includes all users and
other files stored in `dashwise-data`; it can contain private data and secrets,
so store it securely.

```sh
scripts/backup.sh ./backups/dashwise-$(date -u +%Y%m%d).tar.gz
```

The script restarts Dashwise after creating the archive. It leaves the archive
outside `dashwise-data` and restricts its file permissions to the current user.
For a host data directory other than `./dashwise-data`, set `DATA_DIR_HOST` to
that directory when running either script. These scripts expect the default
Compose database filename `dashwise.sqlite` inside the data directory.

To restore, first preserve the backup archive outside the data directory, then
run:

```sh
scripts/restore.sh ./backups/dashwise-20261104.tar.gz
```

Restore stops Dashwise, extracts the snapshot, replaces the data directory,
and starts the service. The previous data directory is retained beside it with
a `.before-restore-<timestamp>` suffix. Confirm that Dashwise starts and that
the expected accounts, integrations, and wallpapers are present before
removing that previous directory. If startup fails, move the restored data
directory aside, rename the retained previous directory back to `dashwise-data`,
and run `docker compose start dashwise`.

Do not copy only `dashwise.sqlite` while Dashwise is running: SQLite uses WAL
files, and a filesystem copy of the main database alone may be incomplete. For
an online snapshot, use SQLite's backup API or `sqlite3`'s `.backup` command,
then copy the wallpapers and `secret.key` from the same deployment snapshot.

The Migrate page creates an account export archive for moving data from the
older PocketBase-based Dashwise installation. That archive is a migration aid,
not a full instance backup: it does not include runtime configuration, other
users' data, or the wallpaper directory. The Compose scripts archive the data
directory only; they do not back up `.env` files, Compose overrides, or other
deployment configuration kept elsewhere.
