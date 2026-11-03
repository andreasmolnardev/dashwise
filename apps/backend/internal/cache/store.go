// Package cache provides a small SQLite-backed cache with per-entry expiry.
package cache

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
}

func NewStore(db *foundation.DB) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("cache store requires an open database")
	}
	return &Store{db: db.SQL(), foundation: db}, nil
}

func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{
		ID: "0020_expiring_cache", Name: "SQLite expiring cache entries",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			for _, statement := range []string{
				`CREATE TABLE IF NOT EXISTS cache_entries(namespace TEXT NOT NULL, cache_key TEXT NOT NULL, value_json BLOB NOT NULL, expires_at_ns INTEGER NOT NULL, PRIMARY KEY(namespace,cache_key))`,
				`CREATE INDEX IF NOT EXISTS cache_entries_by_expiry ON cache_entries(expires_at_ns)`,
			} {
				if _, err := tx.ExecContext(ctx, statement); err != nil {
					return fmt.Errorf("initialize cache table: %w", err)
				}
			}
			return nil
		},
	}})
}

func (s *Store) Get(ctx context.Context, namespace, key string) ([]byte, bool, error) {
	var value []byte
	var expiresAt int64
	err := s.db.QueryRowContext(ctx, `SELECT value_json,expires_at_ns FROM cache_entries WHERE namespace=? AND cache_key=?`, namespace, key).Scan(&value, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read cache entry: %w", err)
	}
	if expiresAt <= time.Now().UTC().UnixNano() {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM cache_entries WHERE namespace=? AND cache_key=?`, namespace, key)
		return nil, false, nil
	}
	return value, true, nil
}

func (s *Store) Set(ctx context.Context, namespace, key string, value []byte, ttl time.Duration) error {
	if namespace == "" || key == "" || ttl <= 0 {
		return errors.New("cache namespace, key, and positive expiry are required")
	}
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO cache_entries(namespace,cache_key,value_json,expires_at_ns) VALUES(?,?,?,?)
		ON CONFLICT(namespace,cache_key) DO UPDATE SET value_json=excluded.value_json,expires_at_ns=excluded.expires_at_ns
	`, namespace, key, value, now.Add(ttl).UnixNano())
	if err != nil {
		return fmt.Errorf("write cache entry: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM cache_entries WHERE expires_at_ns <= ?`, now.UnixNano())
	return nil
}
