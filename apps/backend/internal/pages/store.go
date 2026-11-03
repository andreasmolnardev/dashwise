// Package pages stores per-user Dashwise page and dashboard view definitions.
package pages

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

var ErrInvalid = errors.New("invalid page configuration")

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
}
type Record struct {
	PageName  string         `json:"pageName"`
	Config    map[string]any `json:"config"`
	CreatedAt string         `json:"created"`
	UpdatedAt string         `json:"updated"`
}

func New(db *foundation.DB) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("page store requires an open database")
	}
	return &Store{db: db.SQL(), foundation: db}, nil
}
func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{ID: "0014_pages_domain", Name: "user page definitions", Up: func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS page_configs(owner_id TEXT NOT NULL,page_name TEXT NOT NULL,config_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,page_name))`)
		return err
	}}})
}
func (s *Store) Get(ctx context.Context, owner, page string) (Record, error) {
	var record Record
	var encoded string
	if err := s.db.QueryRowContext(ctx, `SELECT page_name,config_json,created_at,updated_at FROM page_configs WHERE owner_id=? AND page_name=?`, owner, normalize(page)).Scan(&record.PageName, &encoded, &record.CreatedAt, &record.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Record{}, nil
		}
		return Record{}, err
	}
	if err := json.Unmarshal([]byte(encoded), &record.Config); err != nil {
		return Record{}, err
	}
	if record.Config == nil {
		record.Config = map[string]any{}
	}
	return record, nil
}
func (s *Store) List(ctx context.Context, owner string) ([]map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT page_name FROM page_configs WHERE owner_id=? ORDER BY page_name COLLATE NOCASE`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		items = append(items, map[string]string{"pageName": name})
	}
	return items, rows.Err()
}
func (s *Store) Put(ctx context.Context, owner, page string, config map[string]any) (Record, error) {
	page = normalize(page)
	if owner == "" || page == "" || len(page) > 100 || config == nil {
		return Record{}, ErrInvalid
	}
	encoded, err := json.Marshal(config)
	if err != nil || len(encoded) > 1<<20 {
		return Record{}, ErrInvalid
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO page_configs(owner_id,page_name,config_json,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,page_name) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at`, owner, page, string(encoded), now, now)
	if err != nil {
		return Record{}, err
	}
	return s.Get(ctx, owner, page)
}
func normalize(page string) string { return strings.TrimSpace(page) }
