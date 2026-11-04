package resources

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ReconcileImportedOwner repairs the derived search index and publishes
// owner-scoped changes for resources written by an archive import. It must be
// called with the import transaction so previews roll back all three effects.
func ReconcileImportedOwner(ctx context.Context, tx *sql.Tx, owner string, importedIDs []string) error {
	if tx == nil || owner == "" {
		return fmt.Errorf("resource import reconciliation requires a transaction and owner")
	}
	if len(importedIDs) == 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM resource_search WHERE owner_id = ?`, owner); err != nil {
		return fmt.Errorf("clear imported owner's resource search index: %w", err)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT r.id, r.type, r.data_json, d.definition_json
		FROM resources r JOIN resource_types d ON d.type = r.type
		WHERE r.owner_id = ? ORDER BY r.id`, owner)
	if err != nil {
		return err
	}
	type indexedResource struct {
		id, typ, dataJSON, definitionJSON string
	}
	items := make([]indexedResource, 0)
	for rows.Next() {
		var item indexedResource
		if err := rows.Scan(&item.id, &item.typ, &item.dataJSON, &item.definitionJSON); err != nil {
			_ = rows.Close()
			return err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range items {
		var definition Definition
		if err := unmarshal(item.definitionJSON, &definition); err != nil {
			return fmt.Errorf("decode resource type %q for import indexing: %w", item.typ, err)
		}
		if err := definition.Validate(); err != nil {
			return fmt.Errorf("validate resource type %q for import indexing: %w", item.typ, err)
		}
		if !hasSearchCapability(definition) {
			continue
		}
		var data map[string]any
		if err := unmarshal(item.dataJSON, &data); err != nil {
			return fmt.Errorf("decode resource %q for import indexing: %w", item.id, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO resource_search(resource_id, owner_id, resource_type, searchable_text) VALUES(?, ?, ?, ?)`, item.id, owner, item.typ, searchableText(data, definition)); err != nil {
			return fmt.Errorf("index imported resource %q: %w", item.id, err)
		}
	}

	seen := make(map[string]struct{}, len(importedIDs))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, id := range importedIDs {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		var typ, instanceID, providerResourceID string
		if err := tx.QueryRowContext(ctx, `SELECT type, provider_instance_id, provider_resource_id FROM resources WHERE id = ? AND owner_id = ?`, id, owner).Scan(&typ, &instanceID, &providerResourceID); err != nil {
			return fmt.Errorf("load imported resource %q for change event: %w", id, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO change_events(resource_id, operation, created_at, owner_id, resource_type, provider_instance_id, provider_resource_id) VALUES(?, 'upsert', ?, ?, ?, ?, ?)`, id, now, owner, typ, instanceID, providerResourceID); err != nil {
			return fmt.Errorf("publish imported resource %q change: %w", id, err)
		}
	}
	return nil
}

// reindexResourceType updates any records already materialized for a resource
// type after its searchable-field declaration changes. The table check lets
// builtin definitions register before Store.Initialize creates the FTS index.
func reindexResourceType(ctx context.Context, db *sql.DB, definition Definition) error {
	var exists int
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='resource_search')`).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM resource_search WHERE resource_type = ?`, definition.Type); err != nil {
		return err
	}
	if !hasSearchCapability(definition) {
		return tx.Commit()
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, owner_id, data_json FROM resources WHERE type = ?`, definition.Type)
	if err != nil {
		return err
	}
	type indexedResource struct {
		id, owner string
		data      string
	}
	items := make([]indexedResource, 0)
	for rows.Next() {
		var item indexedResource
		if err := rows.Scan(&item.id, &item.owner, &item.data); err != nil {
			_ = rows.Close()
			return err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range items {
		var data map[string]any
		if err := unmarshal(item.data, &data); err != nil {
			return fmt.Errorf("decode resource %q for search indexing: %w", item.id, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO resource_search(resource_id, owner_id, resource_type, searchable_text) VALUES(?, ?, ?, ?)`, item.id, item.owner, definition.Type, searchableText(data, definition)); err != nil {
			return fmt.Errorf("index resource %q: %w", item.id, err)
		}
	}
	return tx.Commit()
}
