package resources

import (
	"context"
	"database/sql"
	"fmt"
)

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
