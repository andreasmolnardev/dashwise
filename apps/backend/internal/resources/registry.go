package resources

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

// Registry stores resource type definitions and keeps a process-local cache
// for query validation. Construct it after the application migrations have
// created resource_types.
type Registry struct {
	db          *sql.DB
	mu          sync.RWMutex
	definitions map[string]Definition
}

func NewRegistry(db *foundation.DB) (*Registry, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("resource registry requires an open database")
	}
	return &Registry{db: db.SQL(), definitions: make(map[string]Definition)}, nil
}

func (r *Registry) Register(ctx context.Context, definition Definition) error {
	if err := definition.Validate(); err != nil {
		return err
	}
	encoded, err := marshal(definition)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = r.db.ExecContext(ctx, `
		INSERT INTO resource_types(type, version, definition_json, updated_at)
		VALUES(?, ?, ?, ?)
		ON CONFLICT(type) DO UPDATE SET
			version = excluded.version,
			definition_json = excluded.definition_json,
			updated_at = excluded.updated_at
	`, definition.Type, definition.Version, encoded, now)
	if err != nil {
		return fmt.Errorf("register resource type %q: %w", definition.Type, err)
	}
	r.mu.Lock()
	r.definitions[definition.Type] = definition
	r.mu.Unlock()
	return nil
}

func (r *Registry) Get(ctx context.Context, resourceType string) (Definition, error) {
	r.mu.RLock()
	definition, ok := r.definitions[resourceType]
	r.mu.RUnlock()
	if ok {
		return definition, nil
	}
	var encoded string
	if err := r.db.QueryRowContext(ctx, `SELECT definition_json FROM resource_types WHERE type = ?`, resourceType).Scan(&encoded); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Definition{}, ErrTypeNotFound
		}
		return Definition{}, fmt.Errorf("load resource type %q: %w", resourceType, err)
	}
	var loaded Definition
	if err := unmarshal(encoded, &loaded); err != nil {
		return Definition{}, fmt.Errorf("decode resource type %q: %w", resourceType, err)
	}
	if err := loaded.Validate(); err != nil {
		return Definition{}, fmt.Errorf("validate stored resource type %q: %w", resourceType, err)
	}
	r.mu.Lock()
	r.definitions[resourceType] = loaded
	r.mu.Unlock()
	return loaded, nil
}

func (r *Registry) List(ctx context.Context) ([]Definition, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT definition_json FROM resource_types ORDER BY type`)
	if err != nil {
		return nil, fmt.Errorf("list resource types: %w", err)
	}
	defer rows.Close()
	definitions := make([]Definition, 0)
	for rows.Next() {
		var encoded string
		var definition Definition
		if err := rows.Scan(&encoded); err != nil {
			return nil, fmt.Errorf("read resource type: %w", err)
		}
		if err := unmarshal(encoded, &definition); err != nil {
			return nil, fmt.Errorf("decode resource type: %w", err)
		}
		definitions = append(definitions, definition)
		r.mu.Lock()
		r.definitions[definition.Type] = definition
		r.mu.Unlock()
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate resource types: %w", err)
	}
	return definitions, nil
}

var ErrTypeNotFound = errors.New("resource type not found")

func unmarshal(encoded string, destination any) error {
	if err := json.Unmarshal([]byte(encoded), destination); err != nil {
		return err
	}
	return nil
}
