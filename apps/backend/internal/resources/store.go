package resources

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

var ErrNotFound = errors.New("resource not found")

// Resource is a normalized record with provider-owned JSON payload.
type Resource struct {
	ID                 string         `json:"id"`
	Type               string         `json:"type"`
	Provider           string         `json:"provider"`
	ProviderInstanceID string         `json:"providerInstanceId,omitempty"`
	ProviderResourceID string         `json:"providerResourceId"`
	OwnerID            string         `json:"ownerId,omitempty"`
	Data               map[string]any `json:"data"`
	Capabilities       []string       `json:"capabilities,omitempty"`
	State              string         `json:"state"`
	CreatedAt          time.Time      `json:"createdAt"`
	UpdatedAt          time.Time      `json:"updatedAt"`
}

type Store struct {
	db       *sql.DB
	registry *Registry
}

func NewStore(db *foundation.DB, registry *Registry) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("resource store requires an open database")
	}
	if registry == nil {
		return nil, errors.New("resource store requires a resource registry")
	}
	return &Store{db: db.SQL(), registry: registry}, nil
}

// Upsert replaces a provider's materialized resource payload while retaining
// the stable Dashwise ID and original creation time for an existing identity.
func (s *Store) Upsert(ctx context.Context, resource Resource) (Resource, error) {
	definition, err := s.registry.Get(ctx, resource.Type)
	if err != nil {
		return Resource{}, err
	}
	if !identifierPattern.MatchString(resource.Provider) {
		return Resource{}, errors.New("resource provider must be a lowercase identifier")
	}
	if strings.TrimSpace(resource.ProviderResourceID) == "" {
		return Resource{}, errors.New("provider resource ID is required")
	}
	if resource.State == "" {
		resource.State = "current"
	}
	if resource.State != "current" && resource.State != "stale" && resource.State != "error" {
		return Resource{}, errors.New("resource state must be current, stale, or error")
	}
	if resource.Data == nil {
		resource.Data = map[string]any{}
	}
	for _, capability := range resource.Capabilities {
		if !identifierPattern.MatchString(capability) {
			return Resource{}, fmt.Errorf("invalid resource capability %q", capability)
		}
	}
	for _, field := range definition.Fields {
		if _, exists := resource.Data[field.Name]; !exists {
			continue
		}
		if err := validateFieldValue(field, resource.Data[field.Name]); err != nil {
			return Resource{}, err
		}
	}
	dataJSON, err := marshal(resource.Data)
	if err != nil {
		return Resource{}, err
	}
	capabilitiesJSON, err := marshal(normalizeCapabilities(resource.Capabilities, definition.Capabilities))
	if err != nil {
		return Resource{}, err
	}
	now := time.Now().UTC()
	if resource.ID == "" {
		resource.ID, err = newID()
		if err != nil {
			return Resource{}, err
		}
	}
	nowText := now.Format(time.RFC3339Nano)
	var existingID, createdAt string
	err = s.db.QueryRowContext(ctx, `
		SELECT id, created_at FROM resources
		WHERE owner_id = ? AND type = ? AND provider_instance_id = ? AND provider_resource_id = ?
	`, resource.OwnerID, resource.Type, resource.ProviderInstanceID, resource.ProviderResourceID).Scan(&existingID, &createdAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Resource{}, fmt.Errorf("look up resource identity: %w", err)
	}
	if err == nil {
		resource.ID = existingID
		resource.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
		if err != nil {
			return Resource{}, fmt.Errorf("parse resource creation time: %w", err)
		}
	} else {
		resource.CreatedAt = now
	}
	resource.UpdatedAt = now
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Resource{}, fmt.Errorf("begin resource upsert: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO resources(
			id, type, provider, provider_instance_id, provider_resource_id,
			owner_id, data_json, capabilities_json, state, created_at, updated_at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(owner_id, type, provider_instance_id, provider_resource_id) DO UPDATE SET
			provider = excluded.provider,
			owner_id = excluded.owner_id,
			data_json = excluded.data_json,
			capabilities_json = excluded.capabilities_json,
			state = excluded.state,
			updated_at = excluded.updated_at
	`, resource.ID, resource.Type, resource.Provider, resource.ProviderInstanceID,
		resource.ProviderResourceID, resource.OwnerID, dataJSON, capabilitiesJSON,
		resource.State, resource.CreatedAt.Format(time.RFC3339Nano), nowText)
	if err != nil {
		return Resource{}, fmt.Errorf("upsert resource: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO change_events(resource_id, operation, created_at) VALUES(?, 'upsert', ?)`, resource.ID, nowText); err != nil {
		return Resource{}, fmt.Errorf("record resource change: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Resource{}, fmt.Errorf("commit resource upsert: %w", err)
	}
	resource.CreatedAt = resource.CreatedAt.UTC()
	return resource, nil
}

func (s *Store) Get(ctx context.Context, ownerID, id string) (Resource, error) {
	row := s.db.QueryRowContext(ctx, resourceSelect+` WHERE owner_id = ? AND id = ?`, ownerID, id)
	resource, err := scanResource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Resource{}, ErrNotFound
	}
	if err != nil {
		return Resource{}, fmt.Errorf("get resource: %w", err)
	}
	return resource, nil
}

func (s *Store) Delete(ctx context.Context, ownerID, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin resource deletion: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `DELETE FROM resources WHERE owner_id = ? AND id = ?`, ownerID, id)
	if err != nil {
		return fmt.Errorf("delete resource: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check deleted resource: %w", err)
	}
	if count == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO change_events(resource_id, operation, created_at) VALUES(?, 'delete', ?)`, id, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return fmt.Errorf("record resource deletion: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit resource deletion: %w", err)
	}
	return nil
}

func (s *Store) Query(ctx context.Context, query Query) (Page, error) {
	compiled, args, err := s.compileQuery(ctx, query)
	if err != nil {
		return Page{}, err
	}
	countSQL := `SELECT COUNT(*) FROM resources` + compiled
	var total int
	if err := s.db.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return Page{}, fmt.Errorf("count resources: %w", err)
	}
	limit := query.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := query.Offset
	if offset < 0 {
		offset = 0
	}
	orderBy := "updated_at DESC, id ASC"
	switch query.OrderBy {
	case "createdAt":
		orderBy = "created_at DESC, id ASC"
	case "type":
		orderBy = "type ASC, id ASC"
	case "updatedAt", "":
	default:
		return Page{}, errors.New("orderBy must be updatedAt, createdAt, or type")
	}
	querySQL := resourceSelect + compiled + ` ORDER BY ` + orderBy + ` LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.QueryContext(ctx, querySQL, queryArgs...)
	if err != nil {
		return Page{}, fmt.Errorf("query resources: %w", err)
	}
	defer rows.Close()
	items := make([]Resource, 0)
	for rows.Next() {
		item, err := scanResource(rows)
		if err != nil {
			return Page{}, fmt.Errorf("read resource: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("iterate resources: %w", err)
	}
	return Page{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

const resourceSelect = `
	SELECT id, type, provider, provider_instance_id, provider_resource_id,
		owner_id, data_json, capabilities_json, state, created_at, updated_at
	FROM resources`

type rowScanner interface{ Scan(...any) error }

func scanResource(row rowScanner) (Resource, error) {
	var resource Resource
	var dataJSON, capabilitiesJSON, createdAt, updatedAt string
	err := row.Scan(&resource.ID, &resource.Type, &resource.Provider,
		&resource.ProviderInstanceID, &resource.ProviderResourceID, &resource.OwnerID,
		&dataJSON, &capabilitiesJSON, &resource.State, &createdAt, &updatedAt)
	if err != nil {
		return Resource{}, err
	}
	if err := unmarshal(dataJSON, &resource.Data); err != nil {
		return Resource{}, fmt.Errorf("decode resource data: %w", err)
	}
	if err := unmarshal(capabilitiesJSON, &resource.Capabilities); err != nil {
		return Resource{}, fmt.Errorf("decode resource capabilities: %w", err)
	}
	var parseErr error
	resource.CreatedAt, parseErr = time.Parse(time.RFC3339Nano, createdAt)
	if parseErr != nil {
		return Resource{}, parseErr
	}
	resource.UpdatedAt, parseErr = time.Parse(time.RFC3339Nano, updatedAt)
	if parseErr != nil {
		return Resource{}, parseErr
	}
	return resource, nil
}

func newID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate resource ID: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

func normalizeCapabilities(resourceCapabilities, typeCapabilities []string) []string {
	set := make(map[string]struct{}, len(typeCapabilities)+len(resourceCapabilities))
	for _, capability := range typeCapabilities {
		set[capability] = struct{}{}
	}
	for _, capability := range resourceCapabilities {
		if identifierPattern.MatchString(capability) {
			set[capability] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for capability := range set {
		result = append(result, capability)
	}
	return result
}

func validateFieldValue(field FieldDefinition, value any) error {
	valid := true
	switch field.Type {
	case "string", "text", "url", "datetime", "date":
		_, valid = value.(string)
	case "number", "integer":
		switch value.(type) {
		case float64, float32, int, int32, int64, json.Number:
		default:
			valid = false
		}
	case "boolean":
		_, valid = value.(bool)
	case "object":
		_, valid = value.(map[string]any)
	case "array":
		_, valid = value.([]any)
	default:
		return fmt.Errorf("field %q has unsupported declared type %q", field.Name, field.Type)
	}
	if !valid {
		return fmt.Errorf("field %q must have type %s", field.Name, field.Type)
	}
	return nil
}
