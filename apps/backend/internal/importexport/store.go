// Package importexport creates versioned, owner-scoped migration snapshots.
// Password hashes and sessions are intentionally outside the transfer format.
package importexport

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

const (
	Format          = "dashwise-pocketbase-export"
	Version         = 1
	MaxRows         = 100000
	MaxFileBytes    = 25 << 20
	MaxArchiveBytes = 100 << 20
)

var ErrInvalid = errors.New("invalid Dashwise migration archive")

type SecretProtector interface {
	Protect([]byte) ([]byte, error)
	Reveal([]byte) ([]byte, error)
}

// Archive.Tables contains canonical SQLite-shaped rows. The old PocketBase
// export modal maps PocketBase collections into these versioned table names.
type Archive struct {
	Format     string                      `json:"format"`
	Version    int                         `json:"version"`
	ExportedAt time.Time                   `json:"exportedAt"`
	Source     string                      `json:"source"`
	Tables     map[string][]map[string]any `json:"tables"`
}

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
	secrets    SecretProtector
	filesDir   string
}

type Result struct {
	Imported map[string]int `json:"imported"`
	Skipped  []string       `json:"skipped,omitempty"`
}

type tableSpec struct {
	name, ownerColumn, where string
	order                    int
}

// Tables are ordered parent-first for foreign-key-safe transactional imports.
var tableSpecs = []tableSpec{
	{"links_collections", "owner_id", "owner_id=?", 10},
	{"links_folders", "owner_id", "owner_id=?", 20},
	{"links_tags", "owner_id", "owner_id=?", 30},
	{"link_items", "owner_id", "owner_id=?", 40},
	{"links_rss_feeds", "owner_id", "owner_id=?", 50},
	{"news_subscriptions", "owner_id", "owner_id=?", 60},
	{"news_feeds", "owner_id", "owner_id=?", 70},
	{"news_articles", "owner_id", "owner_id=?", 80},
	{"news_saved_lists", "owner_id", "owner_id=?", 90},
	{"news_feed_subscriptions", "owner_id", "owner_id=?", 100},
	{"news_feed_includes", "owner_id", "owner_id=?", 110},
	{"news_feed_exclusions", "owner_id", "owner_id=?", 120},
	{"news_article_sources", "", "subscription_id IN (SELECT id FROM news_subscriptions WHERE owner_id=?)", 130},
	{"news_saved_list_items", "owner_id", "owner_id=?", 140},
	{"news_article_user_state", "owner_id", "owner_id=?", 150},
	{"news_preferences", "owner_id", "owner_id=?", 160},
	{"monitors", "owner_id", "owner_id=?", 170},
	{"monitor_pings", "", "monitor_id IN (SELECT id FROM monitors WHERE owner_id=?)", 180},
	{"monitoring_hosts", "owner_id", "owner_id=?", 190},
	{"monitoring_host_stats", "", "host_id IN (SELECT id FROM monitoring_hosts WHERE owner_id=?)", 200},
	{"monitoring_host_history", "", "host_id IN (SELECT id FROM monitoring_hosts WHERE owner_id=?)", 210},
	{"notification_topics", "owner_id", "owner_id=?", 220},
	{"notification_items", "", "topic_id IN (SELECT id FROM notification_topics WHERE owner_id=?)", 230},
	{"notification_topic_tokens", "", "topic_id IN (SELECT id FROM notification_topics WHERE owner_id=?)", 240},
	{"notification_forwarders", "", "topic_id IN (SELECT id FROM notification_topics WHERE owner_id=?)", 250},
	{"activities", "owner_id", "owner_id=?", 260},
	{"integrations", "owner_id", "owner_id=?", 270},
	{"page_configs", "owner_id", "owner_id=?", 280},
	{"saved_views", "owner_id", "owner_id=?", 290},
	{"resources", "owner_id", "owner_id=?", 300},
	{"auth_user_properties", "user_id", "user_id=?", 310},
	{"wallpapers", "owner_id", "owner_id=?", 320},
}

var userPropertyNames = map[string]bool{
	"appearancePreferences": true, "localizationPreferences": true,
	"screensaverPreferences": true, "searchPreferences": true, "global": true,
}

func New(db *foundation.DB, secrets SecretProtector, filesDir string) (*Store, error) {
	if db == nil || db.SQL() == nil || strings.TrimSpace(filesDir) == "" {
		return nil, errors.New("migration store requires an open database and file directory")
	}
	if err := os.MkdirAll(filesDir, 0o700); err != nil {
		return nil, err
	}
	return &Store{db: db.SQL(), foundation: db, secrets: secrets, filesDir: filesDir}, nil
}

func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{ID: "0016_importexport_domain", Name: "migration archive tracking", Up: func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS migration_imports(id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,archive_hash TEXT NOT NULL,imported_at TEXT NOT NULL,UNIQUE(owner_id,archive_hash))`)
		return err
	}}})
}

func (s *Store) Export(ctx context.Context, owner string) (Archive, error) {
	if strings.TrimSpace(owner) == "" {
		return Archive{}, ErrInvalid
	}
	archive := Archive{Format: Format, Version: Version, ExportedAt: time.Now().UTC(), Source: "dashwise-go", Tables: map[string][]map[string]any{}}
	total := 0
	for _, spec := range tableSpecs {
		if _, err := s.tableColumns(ctx, s.db, spec.name); err != nil {
			if isMissingTable(err) {
				continue
			}
			return Archive{}, err
		}
		rows, err := s.readRows(ctx, s.db, spec, owner)
		if err != nil {
			return Archive{}, fmt.Errorf("export %s: %w", spec.name, err)
		}
		for i := range rows {
			if err := s.prepareExportRow(ctx, spec.name, rows[i]); err != nil {
				return Archive{}, fmt.Errorf("export %s row: %w", spec.name, err)
			}
		}
		total += len(rows)
		if total > MaxRows {
			return Archive{}, fmt.Errorf("%w: export exceeds %d records", ErrInvalid, MaxRows)
		}
		if len(rows) > 0 {
			archive.Tables[spec.name] = rows
		}
	}
	encoded, err := json.Marshal(archive)
	if err != nil {
		return Archive{}, err
	}
	if len(encoded) > MaxArchiveBytes {
		return Archive{}, fmt.Errorf("%w: export exceeds %d bytes", ErrInvalid, MaxArchiveBytes)
	}
	return archive, nil
}

// Import merges a normalized PocketBase collection export into one existing
// account. Caller-owned identity always replaces exported owner fields.
func (s *Store) Import(ctx context.Context, owner string, archive Archive) (Result, error) {
	if strings.TrimSpace(owner) == "" || archive.Format != Format || archive.Version != Version || len(archive.Tables) == 0 {
		return Result{}, ErrInvalid
	}
	known := make(map[string]tableSpec, len(tableSpecs))
	for _, spec := range tableSpecs {
		known[spec.name] = spec
	}
	total := 0
	for table, rows := range archive.Tables {
		if _, ok := known[table]; !ok {
			return Result{}, fmt.Errorf("%w: unsupported table %q", ErrInvalid, table)
		}
		total += len(rows)
	}
	if total > MaxRows {
		return Result{}, fmt.Errorf("%w: archive exceeds %d records", ErrInvalid, MaxRows)
	}
	archiveJSON, err := json.Marshal(archive)
	if err != nil {
		return Result{}, fmt.Errorf("%w: archive cannot be encoded", ErrInvalid)
	}
	if len(archiveJSON) > MaxArchiveBytes {
		return Result{}, fmt.Errorf("%w: archive exceeds %d bytes", ErrInvalid, MaxArchiveBytes)
	}
	digest := sha256.Sum256(archiveJSON)
	archiveHash := hex.EncodeToString(digest[:])
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = tx.Rollback() }()
	createdFiles := []string{}
	oldWallpaperPaths := []string{}
	committed := false
	defer func() {
		if !committed {
			for _, path := range createdFiles {
				_ = os.Remove(path)
			}
		}
	}()
	result := Result{Imported: map[string]int{}}
	if len(archive.Tables["wallpapers"]) > 0 {
		var previous string
		err := tx.QueryRowContext(ctx, `SELECT path FROM wallpapers WHERE owner_id=?`, owner).Scan(&previous)
		if err == nil && previous != "" {
			oldWallpaperPaths = append(oldWallpaperPaths, previous)
		} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Result{}, err
		}
	}
	for _, spec := range tableSpecs {
		rows := archive.Tables[spec.name]
		if len(rows) == 0 {
			continue
		}
		columns, err := s.tableColumns(ctx, tx, spec.name)
		if err != nil {
			return Result{}, fmt.Errorf("table %s is unavailable: %w", spec.name, err)
		}
		for _, raw := range rows {
			row := cloneMap(raw)
			if err := s.prepareImportRow(spec.name, row); err != nil {
				return Result{}, fmt.Errorf("import %s: %w", spec.name, err)
			}
			if spec.name == "wallpapers" {
				path, err := s.persistWallpaper(row)
				if err != nil {
					return Result{}, err
				}
				createdFiles = append(createdFiles, path)
			}
			if spec.ownerColumn != "" {
				row[spec.ownerColumn] = owner
			}
			if spec.name == "auth_user_properties" && !userPropertyNames[stringValue(row["property_name"])] {
				return Result{}, fmt.Errorf("%w: unsupported user property", ErrInvalid)
			}
			if err := validateRowColumns(spec.name, row, columns); err != nil {
				return Result{}, err
			}
			if err := s.validateOwnership(ctx, tx, spec.name, owner, row); err != nil {
				return Result{}, err
			}
			if err := upsertRow(ctx, tx, spec.name, columns, row); err != nil {
				return Result{}, fmt.Errorf("write %s: %w", spec.name, err)
			}
			result.Imported[spec.name]++
		}
	}
	importID := owner + ":" + archiveHash
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO migration_imports(id,owner_id,archive_hash,imported_at) VALUES(?,?,?,?)`, importID, owner, archiveHash, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return Result{}, err
	}
	if err := tx.Commit(); err != nil {
		return Result{}, err
	}
	committed = true
	for _, path := range oldWallpaperPaths {
		_ = os.Remove(path)
	}
	return result, nil
}

func (s *Store) readRows(ctx context.Context, q queryer, spec tableSpec, owner string) ([]map[string]any, error) {
	columns, err := s.tableColumns(ctx, q, spec.name)
	if err != nil {
		return nil, err
	}
	quoted := quoteColumns(columns)
	rows, err := q.QueryContext(ctx, `SELECT `+quoted+` FROM `+quoteIdentifier(spec.name)+` WHERE `+spec.where+` ORDER BY 1`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		refs := make([]any, len(columns))
		for i := range values {
			refs[i] = &values[i]
		}
		if err := rows.Scan(refs...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, column := range columns {
			switch value := values[i].(type) {
			case []byte:
				row[column] = append([]byte(nil), value...)
			default:
				row[column] = value
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Store) prepareExportRow(ctx context.Context, table string, row map[string]any) error {
	switch table {
	case "integrations":
		if raw, ok := row["environment_cipher"].([]byte); ok && len(raw) > 0 {
			plain, err := s.reveal(raw)
			if err != nil {
				return err
			}
			var env map[string]string
			if err := json.Unmarshal(plain, &env); err != nil {
				return err
			}
			row["environment"] = env
		}
		delete(row, "environment_cipher")
	case "monitoring_hosts":
		if raw, ok := row["credential"].([]byte); ok && len(raw) > 0 {
			plain, err := s.reveal(raw)
			if err != nil {
				return err
			}
			row["token"] = string(plain)
		}
		delete(row, "credential")
	case "monitors":
		if raw, ok := row["endpoint_auth"].([]byte); ok && len(raw) > 0 {
			plain, err := s.reveal(raw)
			if err != nil {
				return err
			}
			row["endpoint_auth_plain"] = string(plain)
		}
		delete(row, "endpoint_auth")
	case "wallpapers":
		path, _ := row["path"].(string)
		if path != "" {
			contents, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if len(contents) > MaxFileBytes {
				return fmt.Errorf("wallpaper exceeds %d bytes", MaxFileBytes)
			}
			row["contentsBase64"] = base64.StdEncoding.EncodeToString(contents)
		}
		delete(row, "path")
	}
	return nil
}

func (s *Store) prepareImportRow(table string, row map[string]any) error {
	switch table {
	case "integrations":
		env := stringMap(row["environment"])
		encoded, err := json.Marshal(env)
		if err != nil {
			return err
		}
		protected, err := s.protect(encoded)
		if err != nil {
			return err
		}
		row["environment_cipher"] = protected
		delete(row, "environment")
		if _, ok := row["sdk_enabled"]; !ok {
			row["sdk_enabled"] = 1
		}
	case "monitoring_hosts":
		token := stringValue(row["token"])
		if token != "" {
			protected, err := s.protect([]byte(token))
			if err != nil {
				return err
			}
			row["credential"] = protected
		}
		delete(row, "token")
	case "monitors":
		plain := row["endpoint_auth_plain"]
		if plain != nil && stringValue(plain) != "" {
			protected, err := s.protect([]byte(stringValue(plain)))
			if err != nil {
				return err
			}
			row["endpoint_auth"] = protected
		}
		delete(row, "endpoint_auth_plain")
	}
	return nil
}

func (s *Store) validateOwnership(ctx context.Context, tx *sql.Tx, table, owner string, row map[string]any) error {
	columns, columnErr := s.tableColumns(ctx, tx, table)
	if columnErr == nil {
		ownerColumn := ""
		if contains(columns, "owner_id") {
			ownerColumn = "owner_id"
		} else if contains(columns, "user_id") {
			ownerColumn = "user_id"
		}
		if id := stringValue(row["id"]); id != "" && ownerColumn != "" {
			var existingOwner string
			err := tx.QueryRowContext(ctx, `SELECT `+quoteIdentifier(ownerColumn)+` FROM `+quoteIdentifier(table)+` WHERE id=?`, id).Scan(&existingOwner)
			if err == nil && existingOwner != owner {
				return fmt.Errorf("%w: record identity belongs to another account", ErrInvalid)
			}
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		if id := stringValue(row["id"]); id != "" && ownerColumn == "" {
			parent := map[string]struct{ table, column string }{
				"news_article_sources":      {"news_articles", "article_id"},
				"monitor_pings":             {"monitors", "monitor_id"},
				"monitoring_host_stats":     {"monitoring_hosts", "host_id"},
				"monitoring_host_history":   {"monitoring_hosts", "host_id"},
				"notification_items":        {"notification_topics", "topic_id"},
				"notification_topic_tokens": {"notification_topics", "topic_id"},
				"notification_forwarders":   {"notification_topics", "topic_id"},
			}[table]
			if parent.table != "" {
				var existingOwner string
				query := `SELECT parent.owner_id FROM ` + quoteIdentifier(table) + ` child JOIN ` + quoteIdentifier(parent.table) + ` parent ON parent.id=child.` + quoteIdentifier(parent.column) + ` WHERE child.id=?`
				err := tx.QueryRowContext(ctx, query, id).Scan(&existingOwner)
				if err == nil && existingOwner != owner {
					return fmt.Errorf("%w: record identity belongs to another account", ErrInvalid)
				}
				if err != nil && !errors.Is(err, sql.ErrNoRows) {
					return err
				}
			}
		}
	}
	if table == "notification_topic_tokens" {
		hash := stringValue(row["token_hash"])
		if hash != "" {
			var existingOwner string
			err := tx.QueryRowContext(ctx, `SELECT t.owner_id FROM notification_topic_tokens token JOIN notification_topics t ON t.id=token.topic_id WHERE token.token_hash=?`, hash).Scan(&existingOwner)
			if err == nil && existingOwner != owner {
				return fmt.Errorf("%w: topic token identity belongs to another account", ErrInvalid)
			}
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
	}
	checks := map[string][]struct{ table, column string }{
		"links_folders": {{"links_collections", "list_id"}}, "link_items": {{"links_collections", "list_id"}},
		"links_rss_feeds":         {{"links_collections", "list_id"}},
		"news_feed_subscriptions": {{"news_feeds", "feed_id"}, {"news_subscriptions", "subscription_id"}},
		"news_feed_includes":      {{"news_feeds", "feed_id"}, {"news_feeds", "included_feed_id"}},
		"news_feed_exclusions":    {{"news_feeds", "feed_id"}, {"news_subscriptions", "subscription_id"}},
		"news_article_sources":    {{"news_articles", "article_id"}, {"news_subscriptions", "subscription_id"}},
		"news_saved_list_items":   {{"news_saved_lists", "list_id"}, {"news_articles", "article_id"}},
		"news_article_user_state": {{"news_articles", "article_id"}},
		"monitor_pings":           {{"monitors", "monitor_id"}},
		"monitoring_host_stats":   {{"monitoring_hosts", "host_id"}}, "monitoring_host_history": {{"monitoring_hosts", "host_id"}},
		"notification_items": {{"notification_topics", "topic_id"}}, "notification_topic_tokens": {{"notification_topics", "topic_id"}}, "notification_forwarders": {{"notification_topics", "topic_id"}},
	}
	for _, check := range checks[table] {
		id := stringValue(row[check.column])
		if id == "" {
			return fmt.Errorf("%w: %s.%s is required", ErrInvalid, table, check.column)
		}
		var exists int
		query := `SELECT 1 FROM ` + quoteIdentifier(check.table) + ` WHERE id=? AND owner_id=?`
		if err := tx.QueryRowContext(ctx, query, id, owner).Scan(&exists); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("%w: %s references a record outside the importing account", ErrInvalid, table)
			}
			return err
		}
	}
	return nil
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (s *Store) tableColumns(ctx context.Context, q queryer, table string) ([]string, error) {
	if !validTable(table) {
		return nil, ErrInvalid
	}
	rows, err := q.QueryContext(ctx, `PRAGMA table_info(`+quoteIdentifier(table)+`)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := []string{}
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &typ, &notnull, &defaultValue, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(cols) == 0 {
		return nil, fmt.Errorf("table %q does not exist", table)
	}
	return cols, nil
}
func validTable(table string) bool {
	for _, spec := range tableSpecs {
		if spec.name == table {
			return true
		}
	}
	return false
}
func quoteIdentifier(value string) string { return `"` + strings.ReplaceAll(value, `"`, `""`) + `"` }
func quoteColumns(cols []string) string {
	out := make([]string, len(cols))
	for i, col := range cols {
		out[i] = quoteIdentifier(col)
	}
	return strings.Join(out, ",")
}
func validateRowColumns(table string, row map[string]any, columns []string) error {
	allowed := map[string]bool{}
	for _, c := range columns {
		allowed[c] = true
	}
	for key := range row {
		if !allowed[key] {
			return fmt.Errorf("%w: unsupported field %s.%s", ErrInvalid, table, key)
		}
	}
	return nil
}
func upsertRow(ctx context.Context, tx *sql.Tx, table string, columns []string, row map[string]any) error {
	keys := []string{}
	args := []any{}
	for _, column := range columns {
		value, ok := row[column]
		if !ok {
			continue
		}
		keys = append(keys, column)
		args = append(args, value)
	}
	if len(keys) == 0 {
		return ErrInvalid
	}
	quoted := quoteColumns(keys)
	marks := strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")
	sets := []string{}
	for _, key := range keys {
		if key == "id" || key == "owner_id" || key == "user_id" {
			continue
		}
		sets = append(sets, quoteIdentifier(key)+"=excluded."+quoteIdentifier(key))
	}
	query := `INSERT INTO ` + quoteIdentifier(table) + ` (` + quoted + `) VALUES (` + marks + `)`
	if len(sets) > 0 {
		query += ` ON CONFLICT DO UPDATE SET ` + strings.Join(sets, ",")
	} else {
		query += ` ON CONFLICT DO NOTHING`
	}
	_, err := tx.ExecContext(ctx, query, args...)
	return err
}
func cloneMap(input map[string]any) map[string]any {
	out := make(map[string]any, len(input)+2)
	for k, v := range input {
		out[k] = v
	}
	return out
}
func stringValue(value any) string {
	if value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		return fmt.Sprint(v)
	}
}
func stringMap(value any) map[string]string {
	out := map[string]string{}
	switch m := value.(type) {
	case map[string]any:
		for k, v := range m {
			if v != nil {
				out[k] = fmt.Sprint(v)
			}
		}
	case map[string]string:
		return m
	}
	return out
}
func (s *Store) protect(value []byte) ([]byte, error) {
	if s.secrets == nil {
		return nil, errors.New("migration secret encryption is unavailable")
	}
	return s.secrets.Protect(value)
}
func (s *Store) reveal(value []byte) ([]byte, error) {
	if s.secrets == nil {
		return nil, errors.New("migration secret decryption is unavailable")
	}
	return s.secrets.Reveal(value)
}
func isMissingTable(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "does not exist")
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func (s *Store) persistWallpaper(row map[string]any) (string, error) {
	encoded := stringValue(row["contentsBase64"])
	if encoded == "" {
		return "", fmt.Errorf("%w: wallpaper content is required", ErrInvalid)
	}
	contents, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(contents) == 0 || len(contents) > MaxFileBytes {
		return "", fmt.Errorf("%w: invalid wallpaper content", ErrInvalid)
	}
	file, err := os.CreateTemp(s.filesDir, "wallpaper-import-*")
	if err != nil {
		return "", err
	}
	path := file.Name()
	if _, err = file.Write(contents); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return "", err
	}
	row["path"] = path
	delete(row, "contentsBase64")
	return path, nil
}
