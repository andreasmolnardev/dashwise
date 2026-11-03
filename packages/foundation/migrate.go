package foundation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const migrationsTable = "_foundation_migrations"

// Migration is a versioned, application-authored schema or data change.
// IDs are opaque and migrations run in the order supplied to ApplyMigrations.
type Migration struct {
	ID   string
	Name string
	Up   func(context.Context, *sql.Tx) error
	Down func(context.Context, *sql.Tx) error
}

// ApplyMigrations applies each unapplied migration in its own transaction.
// Successful versions are recorded in the database, so subsequent calls are
// safe and only execute new migrations.
func (db *DB) ApplyMigrations(ctx context.Context, migrations []Migration) error {
	if db == nil || db.sql == nil {
		return errors.New("database is not open")
	}
	if err := validateMigrations(migrations); err != nil {
		return err
	}
	if _, err := db.sql.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS `+migrationsTable+` (
			id TEXT PRIMARY KEY NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			applied_at TEXT NOT NULL
		)
	`); err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	for _, migration := range migrations {
		var exists int
		err := db.sql.QueryRowContext(ctx,
			"SELECT 1 FROM "+migrationsTable+" WHERE id = ?", migration.ID,
		).Scan(&exists)
		if err == nil {
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check migration %q: %w", migration.ID, err)
		}

		err = db.Transaction(ctx, nil, func(tx *sql.Tx) error {
			if err := migration.Up(ctx, tx); err != nil {
				return fmt.Errorf("apply migration %q: %w", migration.ID, err)
			}
			_, err := tx.ExecContext(ctx,
				"INSERT INTO "+migrationsTable+" (id, name, applied_at) VALUES (?, ?, ?)",
				migration.ID, migration.Name, time.Now().UTC().Format(time.RFC3339Nano),
			)
			if err != nil {
				return fmt.Errorf("record migration %q: %w", migration.ID, err)
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// RollbackMigrations rolls back the most recently applied migrations for
// which a Down callback is present. It follows the order in migrations and
// leaves all state unchanged if a callback fails.
func (db *DB) RollbackMigrations(ctx context.Context, migrations []Migration, count int) error {
	if db == nil || db.sql == nil {
		return errors.New("database is not open")
	}
	if count < 0 {
		return errors.New("rollback count cannot be negative")
	}
	if err := validateMigrations(migrations); err != nil {
		return err
	}
	if count == 0 {
		return nil
	}
	if _, err := db.sql.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS `+migrationsTable+` (
			id TEXT PRIMARY KEY NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			applied_at TEXT NOT NULL
		)
	`); err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	byID := make(map[string]Migration, len(migrations))
	for _, migration := range migrations {
		byID[migration.ID] = migration
	}

	rows, err := db.sql.QueryContext(ctx, "SELECT id FROM "+migrationsTable+" ORDER BY applied_at DESC, rowid DESC LIMIT ?", count)
	if err != nil {
		return fmt.Errorf("list applied migrations: %w", err)
	}
	var applied []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return fmt.Errorf("read applied migration: %w", err)
		}
		applied = append(applied, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate applied migrations: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close applied migrations: %w", err)
	}

	for _, id := range applied {
		migration, ok := byID[id]
		if !ok {
			return fmt.Errorf("migration %q is applied but not registered", id)
		}
		if migration.Down == nil {
			return fmt.Errorf("migration %q has no rollback callback", id)
		}
		if err := db.Transaction(ctx, nil, func(tx *sql.Tx) error {
			if err := migration.Down(ctx, tx); err != nil {
				return fmt.Errorf("rollback migration %q: %w", id, err)
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM "+migrationsTable+" WHERE id = ?", id); err != nil {
				return fmt.Errorf("remove migration record %q: %w", id, err)
			}
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}

func validateMigrations(migrations []Migration) error {
	seen := make(map[string]struct{}, len(migrations))
	for _, migration := range migrations {
		id := strings.TrimSpace(migration.ID)
		if id == "" {
			return errors.New("migration ID is required")
		}
		if migration.Up == nil {
			return fmt.Errorf("migration %q has no up callback", id)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("duplicate migration ID %q", id)
		}
		seen[id] = struct{}{}
	}
	return nil
}

// SortMigrationsByID sorts a migration slice by ID for applications that
// generate timestamped migration identifiers.
func SortMigrationsByID(migrations []Migration) {
	sort.SliceStable(migrations, func(i, j int) bool {
		return migrations[i].ID < migrations[j].ID
	})
}
