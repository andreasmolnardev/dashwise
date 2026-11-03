// Package integrations owns user-configured YAML/REST and SDK integration instances.
package integrations

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

var (
	ErrNotFound = errors.New("integration not found")
	ErrInvalid  = errors.New("invalid integration")
)

type SecretProtector interface {
	Protect([]byte) ([]byte, error)
	Reveal([]byte) ([]byte, error)
}

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
	secrets    SecretProtector
}

// Integration is an instance owned by one account. Config contains provider
// metadata, while Environment and LocalData belong to this configured instance.
type Integration struct {
	ID          string            `json:"id"`
	Type        string            `json:"type,omitempty"`
	Name        string            `json:"name,omitempty"`
	Source      string            `json:"source,omitempty"`
	UserID      string            `json:"userId"`
	Config      map[string]any    `json:"config"`
	Environment map[string]string `json:"environment"`
	LocalData   map[string]any    `json:"localData"`
	SDKEnabled  bool              `json:"enabled,omitempty"`
	Created     time.Time         `json:"created"`
	Updated     time.Time         `json:"updated"`
}

type Input struct {
	Type        string            `json:"type"`
	Name        string            `json:"name"`
	Source      string            `json:"source"`
	Config      map[string]any    `json:"config"`
	Environment map[string]string `json:"environment"`
	LocalData   map[string]any    `json:"localData"`
	SDKEnabled  *bool             `json:"enabled"`
}

func NewStore(db *foundation.DB, secrets SecretProtector) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("integrations store requires an open database")
	}
	return &Store{db: db.SQL(), foundation: db, secrets: secrets}, nil
}

func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{
		ID: "0013_integrations_domain", Name: "integration instances and configuration",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			for _, query := range []string{
				`CREATE TABLE IF NOT EXISTS integrations(id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'plugin',name TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',config_json TEXT NOT NULL DEFAULT '{}',environment_cipher BLOB NOT NULL,local_data_json TEXT NOT NULL DEFAULT '{}',sdk_enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
				`CREATE INDEX IF NOT EXISTS integrations_by_owner_updated ON integrations(owner_id,updated_at DESC)`,
				`CREATE INDEX IF NOT EXISTS integrations_by_source ON integrations(source,type)`,
			} {
				if _, err := tx.ExecContext(ctx, query); err != nil {
					return fmt.Errorf("initialize integrations schema: %w", err)
				}
			}
			return nil
		},
	}})
}

func (s *Store) List(ctx context.Context, owner string, includeSDK bool) ([]Integration, error) {
	if strings.TrimSpace(owner) == "" {
		return nil, ErrInvalid
	}
	query := `SELECT id,type,name,source,owner_id,config_json,environment_cipher,local_data_json,sdk_enabled,created_at,updated_at FROM integrations WHERE owner_id=?`
	if !includeSDK {
		query += ` AND type!='sdk'`
	}
	query += ` ORDER BY updated_at DESC,id`
	rows, err := s.db.QueryContext(ctx, query, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Integration{}
	for rows.Next() {
		item, err := scanIntegration(rows, s.secrets)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) Get(ctx context.Context, owner, id string) (Integration, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id,type,name,source,owner_id,config_json,environment_cipher,local_data_json,sdk_enabled,created_at,updated_at FROM integrations WHERE owner_id=? AND id=?`, owner, id)
	item, err := scanIntegration(row, s.secrets)
	if errors.Is(err, sql.ErrNoRows) {
		return Integration{}, ErrNotFound
	}
	return item, err
}

func (s *Store) Create(ctx context.Context, owner string, input Input) (Integration, error) {
	if strings.TrimSpace(owner) == "" {
		return Integration{}, ErrInvalid
	}
	input, err := normalizeInput(input, false)
	if err != nil {
		return Integration{}, err
	}
	id, err := newID()
	if err != nil {
		return Integration{}, err
	}
	created := time.Now().UTC()
	configJSON, err := json.Marshal(input.Config)
	if err != nil {
		return Integration{}, ErrInvalid
	}
	localJSON, err := json.Marshal(input.LocalData)
	if err != nil {
		return Integration{}, ErrInvalid
	}
	environment, err := s.protectEnvironment(input.Environment)
	if err != nil {
		return Integration{}, err
	}
	enabled := 1
	if input.SDKEnabled != nil && !*input.SDKEnabled {
		enabled = 0
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO integrations(id,owner_id,type,name,source,config_json,environment_cipher,local_data_json,sdk_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, owner, input.Type, input.Name, input.Source, string(configJSON), environment, string(localJSON), enabled, created.Format(time.RFC3339Nano), created.Format(time.RFC3339Nano))
	if err != nil {
		return Integration{}, err
	}
	return s.Get(ctx, owner, id)
}

func (s *Store) Update(ctx context.Context, owner, id string, input Input) (Integration, error) {
	current, err := s.Get(ctx, owner, id)
	if err != nil {
		return Integration{}, err
	}
	input, err = normalizeInput(input, true)
	if err != nil {
		return Integration{}, err
	}
	if input.Type == "" {
		input.Type = current.Type
	}
	if input.Name == "" {
		input.Name = current.Name
	}
	if input.Source == "" {
		input.Source = current.Source
	}
	if input.Config == nil {
		input.Config = current.Config
	}
	if input.Environment == nil {
		input.Environment = current.Environment
	}
	if input.LocalData == nil {
		input.LocalData = current.LocalData
	}
	if input.SDKEnabled == nil {
		input.SDKEnabled = &current.SDKEnabled
	}
	configJSON, err := json.Marshal(input.Config)
	if err != nil {
		return Integration{}, ErrInvalid
	}
	localJSON, err := json.Marshal(input.LocalData)
	if err != nil {
		return Integration{}, ErrInvalid
	}
	environment, err := s.protectEnvironment(input.Environment)
	if err != nil {
		return Integration{}, err
	}
	updated := time.Now().UTC().Format(time.RFC3339Nano)
	enabled := 0
	if *input.SDKEnabled {
		enabled = 1
	}
	result, err := s.db.ExecContext(ctx, `UPDATE integrations SET type=?,name=?,source=?,config_json=?,environment_cipher=?,local_data_json=?,sdk_enabled=?,updated_at=? WHERE owner_id=? AND id=?`, input.Type, input.Name, input.Source, string(configJSON), environment, string(localJSON), enabled, updated, owner, id)
	if err != nil {
		return Integration{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return Integration{}, err
	}
	if count == 0 {
		return Integration{}, ErrNotFound
	}
	return s.Get(ctx, owner, id)
}

func (s *Store) Delete(ctx context.Context, owner, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM integrations WHERE owner_id=? AND id=?`, owner, id)
	if err != nil {
		return err
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

func normalizeInput(input Input, partial bool) (Input, error) {
	input.Type = strings.TrimSpace(input.Type)
	if input.Type == "" && !partial {
		input.Type = "plugin"
	}
	if input.Type != "" && input.Type != "plugin" && input.Type != "caldav" && input.Type != "sdk" {
		return Input{}, ErrInvalid
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Source = strings.TrimSpace(input.Source)
	if len(input.Name) > 200 || len(input.Source) > 512 {
		return Input{}, ErrInvalid
	}
	if input.Config == nil && !partial {
		input.Config = map[string]any{}
	}
	if input.Environment == nil && !partial {
		input.Environment = map[string]string{}
	}
	if input.LocalData == nil && !partial {
		input.LocalData = map[string]any{}
	}
	for _, value := range []any{input.Config, input.Environment, input.LocalData} {
		if value != nil {
			encoded, err := json.Marshal(value)
			if err != nil || len(encoded) > 1<<20 {
				return Input{}, ErrInvalid
			}
		}
	}
	return input, nil
}

func (s *Store) protectEnvironment(environment map[string]string) ([]byte, error) {
	if s.secrets == nil {
		return nil, errors.New("integration environment encryption is not configured")
	}
	plain, err := json.Marshal(environment)
	if err != nil {
		return nil, ErrInvalid
	}
	return s.secrets.Protect(plain)
}

type scanner interface{ Scan(...any) error }

func scanIntegration(row scanner, protector SecretProtector) (Integration, error) {
	var item Integration
	var configRaw, localRaw string
	var envCipher []byte
	var enabled int
	var created, updated string
	if err := row.Scan(&item.ID, &item.Type, &item.Name, &item.Source, &item.UserID, &configRaw, &envCipher, &localRaw, &enabled, &created, &updated); err != nil {
		return Integration{}, err
	}
	if err := json.Unmarshal([]byte(configRaw), &item.Config); err != nil {
		return Integration{}, err
	}
	if err := json.Unmarshal([]byte(localRaw), &item.LocalData); err != nil {
		return Integration{}, err
	}
	if protector == nil {
		return Integration{}, errors.New("integration environment encryption is not configured")
	}
	plain, err := protector.Reveal(envCipher)
	if err != nil {
		return Integration{}, fmt.Errorf("decrypt integration environment: %w", err)
	}
	if err := json.Unmarshal(plain, &item.Environment); err != nil {
		return Integration{}, err
	}
	item.SDKEnabled = enabled != 0
	item.Created, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return Integration{}, err
	}
	item.Updated, err = time.Parse(time.RFC3339Nano, updated)
	return item, err
}

func newID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", bytes), nil
}
