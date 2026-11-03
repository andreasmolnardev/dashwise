// Package views stores user-owned, reusable resource queries and presentation
// settings. Views are evaluated through the resource store at request time.
package views

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

var ErrNotFound = errors.New("view not found")

type Definition struct {
	Query        json.RawMessage `json:"query"`
	Presentation map[string]any  `json:"presentation,omitempty"`
}

type View struct {
	ID         string     `json:"id"`
	OwnerID    string     `json:"ownerId"`
	Name       string     `json:"name"`
	Definition Definition `json:"definition"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

type Store struct{ db *foundation.DB }

func NewStore(db *foundation.DB) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("view store requires an open database")
	}
	return &Store{db: db}, nil
}

func (s *Store) Create(ctx context.Context, ownerID, name string, definition Definition) (View, error) {
	name = strings.TrimSpace(name)
	if ownerID == "" || name == "" || len(name) > 120 {
		return View{}, errors.New("owner and a view name between 1 and 120 characters are required")
	}
	if !json.Valid(definition.Query) || len(definition.Query) > 1<<20 {
		return View{}, errors.New("view query must be valid JSON under 1 MB")
	}
	encoded, err := json.Marshal(definition)
	if err != nil || len(encoded) > 1<<20 {
		return View{}, errors.New("view definition is invalid or too large")
	}
	id, err := newID()
	if err != nil {
		return View{}, err
	}
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)
	_, err = s.db.SQL().ExecContext(ctx, `INSERT INTO saved_views(id,owner_id,name,definition_json,created_at,updated_at) VALUES(?,?,?,?,?,?)`, id, ownerID, name, string(encoded), stamp, stamp)
	if err != nil {
		return View{}, fmt.Errorf("create view: %w", err)
	}
	return View{ID: id, OwnerID: ownerID, Name: name, Definition: definition, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Store) Get(ctx context.Context, ownerID, id string) (View, error) {
	var view View
	var definitionJSON, createdAt, updatedAt string
	err := s.db.SQL().QueryRowContext(ctx, `SELECT id,owner_id,name,definition_json,created_at,updated_at FROM saved_views WHERE owner_id=? AND id=?`, ownerID, id).Scan(&view.ID, &view.OwnerID, &view.Name, &definitionJSON, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return View{}, ErrNotFound
	}
	if err != nil {
		return View{}, fmt.Errorf("get view: %w", err)
	}
	if err := json.Unmarshal([]byte(definitionJSON), &view.Definition); err != nil {
		return View{}, fmt.Errorf("decode view definition: %w", err)
	}
	if view.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
		return View{}, err
	}
	if view.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt); err != nil {
		return View{}, err
	}
	return view, nil
}

func (s *Store) List(ctx context.Context, ownerID string) ([]View, error) {
	rows, err := s.db.SQL().QueryContext(ctx, `SELECT id,owner_id,name,definition_json,created_at,updated_at FROM saved_views WHERE owner_id=? ORDER BY name,id`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list views: %w", err)
	}
	defer rows.Close()
	items := make([]View, 0)
	for rows.Next() {
		var view View
		var definitionJSON, createdAt, updatedAt string
		if err := rows.Scan(&view.ID, &view.OwnerID, &view.Name, &definitionJSON, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(definitionJSON), &view.Definition); err != nil {
			return nil, fmt.Errorf("decode view definition: %w", err)
		}
		if view.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
			return nil, err
		}
		if view.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt); err != nil {
			return nil, err
		}
		items = append(items, view)
	}
	return items, rows.Err()
}

func (s *Store) Update(ctx context.Context, ownerID, id, name string, definition Definition) (View, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 120 {
		return View{}, errors.New("view name must be between 1 and 120 characters")
	}
	if !json.Valid(definition.Query) || len(definition.Query) > 1<<20 {
		return View{}, errors.New("view query must be valid JSON under 1 MB")
	}
	encoded, err := json.Marshal(definition)
	if err != nil || len(encoded) > 1<<20 {
		return View{}, errors.New("view definition is invalid or too large")
	}
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.SQL().ExecContext(ctx, `UPDATE saved_views SET name=?,definition_json=?,updated_at=? WHERE owner_id=? AND id=?`, name, string(encoded), stamp, ownerID, id)
	if err != nil {
		return View{}, fmt.Errorf("update view: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return View{}, err
	}
	if count == 0 {
		return View{}, ErrNotFound
	}
	return s.Get(ctx, ownerID, id)
}

func (s *Store) Delete(ctx context.Context, ownerID, id string) error {
	result, err := s.db.SQL().ExecContext(ctx, `DELETE FROM saved_views WHERE owner_id=? AND id=?`, ownerID, id)
	if err != nil {
		return fmt.Errorf("delete view: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate view ID: %w", err)
	}
	return hex.EncodeToString(b), nil
}
