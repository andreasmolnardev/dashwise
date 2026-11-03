// Package foundation provides small, reusable persistence primitives for
// self-hosted Go applications. It deliberately does not define application
// resources, authorization policy, or query semantics.
package foundation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const sqliteDriverName = "sqlite"

// SQLiteOptions configures an embedded SQLite database.
type SQLiteOptions struct {
	// Path is the SQLite database file. Use ":memory:" for an in-memory database.
	Path string

	// BusyTimeout bounds how long SQLite waits for a lock before returning an
	// error. It defaults to five seconds.
	BusyTimeout time.Duration

	// MaxOpenConnections configures database/sql's connection pool. It defaults
	// to four. SQLite still serializes writes; readers may run concurrently.
	MaxOpenConnections int
}

// DB owns the connection pool and the migration history for one database.
// The underlying database/sql handle is available for application-specific
// repositories and queries.
type DB struct {
	sql *sql.DB
}

// OpenSQLite opens or creates a SQLite database and configures connection
// pragmas for foreign keys, a busy timeout, and write-ahead logging.
func OpenSQLite(ctx context.Context, options SQLiteOptions) (*DB, error) {
	path := strings.TrimSpace(options.Path)
	if path == "" {
		return nil, errors.New("sqlite path is required")
	}
	if options.BusyTimeout <= 0 {
		options.BusyTimeout = 5 * time.Second
	}
	if options.MaxOpenConnections <= 0 {
		options.MaxOpenConnections = 4
	}

	dsn, err := sqliteDSN(path, options.BusyTimeout)
	if err != nil {
		return nil, err
	}

	pool, err := sql.Open(sqliteDriverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}
	pool.SetMaxOpenConns(options.MaxOpenConnections)
	pool.SetMaxIdleConns(options.MaxOpenConnections)

	if err := pool.PingContext(ctx); err != nil {
		_ = pool.Close()
		return nil, fmt.Errorf("connect to sqlite database: %w", err)
	}
	return &DB{sql: pool}, nil
}

func sqliteDSN(path string, busyTimeout time.Duration) (string, error) {
	if path == ":memory:" {
		// A shared in-memory database keeps the configured connection pool on
		// one database instead of creating one database per connection.
		path = "file:dashwise-foundation-memory?mode=memory&cache=shared"
	} else {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return "", fmt.Errorf("resolve sqlite path: %w", err)
		}
		if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
			return "", fmt.Errorf("create sqlite directory: %w", err)
		}
		path = (&url.URL{Scheme: "file", Path: absolute}).String()
	}

	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	pragmas := []string{
		"_pragma=foreign_keys(1)",
		"_pragma=busy_timeout(" + strconv.FormatInt(busyTimeout.Milliseconds(), 10) + ")",
	}
	if path != ":memory:" && !strings.Contains(path, "mode=memory") {
		pragmas = append(pragmas, "_pragma=journal_mode(WAL)")
	}
	return path + separator + strings.Join(pragmas, "&"), nil
}

// SQL returns the database/sql handle for application-owned repositories.
func (db *DB) SQL() *sql.DB {
	if db == nil {
		return nil
	}
	return db.sql
}

// Close closes the database connection pool.
func (db *DB) Close() error {
	if db == nil || db.sql == nil {
		return nil
	}
	return db.sql.Close()
}

// Transaction runs fn in a transaction and commits only when fn succeeds.
// The transaction is rolled back if fn returns an error or the context is
// cancelled before the callback completes.
func (db *DB) Transaction(ctx context.Context, options *sql.TxOptions, fn func(*sql.Tx) error) error {
	if db == nil || db.sql == nil {
		return errors.New("database is not open")
	}
	if fn == nil {
		return errors.New("transaction callback is required")
	}

	tx, err := db.sql.BeginTx(ctx, options)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}
