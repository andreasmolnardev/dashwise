// Package activities contains the owner-scoped event and current-state activity
// domain. Activities are an event stream, not resources: each entry records an
// occurrence and may optionally replace an integration's current-state entry.
package activities

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

var (
	ErrNotFound = errors.New("activity not found")
	ErrInvalid  = errors.New("invalid activity")
)

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
}

type Action struct {
	Label  string `json:"label"`
	Target string `json:"target"`
}
type Record struct {
	ID             string         `json:"id"`
	OwnerID        string         `json:"ownerId"`
	Source         string         `json:"source"`
	SourceID       string         `json:"sourceId,omitempty"`
	EventID        string         `json:"eventId,omitempty"`
	IdempotencyKey string         `json:"-"`
	Type           string         `json:"type"`
	Title          string         `json:"title"`
	Description    string         `json:"description,omitempty"`
	Severity       string         `json:"severity"`
	OccurredAt     time.Time      `json:"occurredAt"`
	CreatedAt      time.Time      `json:"createdAt"`
	Current        bool           `json:"-"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	Action         *Action        `json:"action,omitempty"`
}
type Input struct {
	Source, SourceID                   string
	Type, Title, Description, Severity string
	EventID, IdempotencyKey            string
	OccurredAt                         time.Time
	Current                            bool
	Metadata                           map[string]any
	Action                             *Action
}
type Query struct {
	Page, PerPage          int
	Source, Type, Severity string
	From, To               time.Time
}
type Page struct {
	Items      []Record `json:"items"`
	Page       int      `json:"page"`
	PerPage    int      `json:"perPage"`
	TotalItems int      `json:"totalItems"`
	TotalPages int      `json:"totalPages"`
}

func New(db *foundation.DB) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("activities store requires an open database")
	}
	return &Store{db: db.SQL(), foundation: db}, nil
}
func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{ID: "0012_activities_domain", Name: "create Activities event store", Up: func(ctx context.Context, tx *sql.Tx) error {
		statements := []string{`CREATE TABLE IF NOT EXISTS activities (
		id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT '',
		event_id TEXT NOT NULL DEFAULT '', idempotency_key TEXT NOT NULL DEFAULT '', type TEXT NOT NULL, title TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '', severity TEXT NOT NULL DEFAULT 'info', occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
		is_current INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}', action_json TEXT NOT NULL DEFAULT ''
	)`,
			`CREATE INDEX IF NOT EXISTS activities_by_owner_time ON activities(owner_id,occurred_at DESC,id DESC)`,
			`CREATE INDEX IF NOT EXISTS activities_by_owner_source ON activities(owner_id,source,type,occurred_at DESC)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS activities_idempotency ON activities(owner_id,source,source_id,idempotency_key) WHERE idempotency_key<>''`,
			`CREATE UNIQUE INDEX IF NOT EXISTS activities_event_identity ON activities(owner_id,source,source_id,event_id) WHERE event_id<>''`,
			`CREATE UNIQUE INDEX IF NOT EXISTS activities_current_identity ON activities(owner_id,source,source_id,type,idempotency_key) WHERE is_current=1 AND idempotency_key<>''`}
		for _, stmt := range statements {
			if _, err := tx.ExecContext(ctx, stmt); err != nil {
				return fmt.Errorf("initialize activities schema: %w", err)
			}
		}
		return nil
	}, Down: func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS activities`)
		return err
	}}, {ID: "0018_activity_definition_settings", Name: "store Activity definition settings and resource conditions", Up: func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS activity_definition_settings(owner_id TEXT PRIMARY KEY NOT NULL,settings_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL)`)
		return err
	}, Down: func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS activity_definition_settings`)
		return err
	}}})
}

func (s *Store) Publish(ctx context.Context, owner string, in Input) (Record, bool, error) {
	if strings.TrimSpace(owner) == "" || strings.TrimSpace(in.Source) == "" || strings.TrimSpace(in.Type) == "" || strings.TrimSpace(in.Title) == "" {
		return Record{}, false, ErrInvalid
	}
	in.Source = strings.TrimSpace(in.Source)
	in.SourceID = strings.TrimSpace(in.SourceID)
	in.Type = strings.TrimSpace(in.Type)
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	in.Severity = strings.TrimSpace(in.Severity)
	if len(in.Source) > 120 || len(in.SourceID) > 200 || len(in.Type) > 120 || len(in.Title) > 200 || len(in.Description) > 2000 || len(in.EventID) > 200 || len(in.IdempotencyKey) > 256 {
		return Record{}, false, ErrInvalid
	}
	if in.Severity == "" {
		in.Severity = "info"
	}
	if in.Severity != "info" && in.Severity != "success" && in.Severity != "warning" && in.Severity != "error" {
		return Record{}, false, ErrInvalid
	}
	if in.OccurredAt.IsZero() {
		in.OccurredAt = time.Now().UTC()
	} else {
		in.OccurredAt = in.OccurredAt.UTC()
	}
	metadata, err := json.Marshal(in.Metadata)
	if err != nil || len(metadata) > 16*1024 || tooDeep(in.Metadata, 0) || sensitiveKey(in.Metadata) {
		return Record{}, false, ErrInvalid
	}
	if in.Metadata == nil {
		metadata = []byte(`{}`)
	}
	actionJSON := ""
	if in.Action != nil {
		in.Action.Label = strings.TrimSpace(in.Action.Label)
		in.Action.Target = strings.TrimSpace(in.Action.Target)
		if in.Action.Label == "" || len(in.Action.Label) > 80 || len(in.Action.Target) > 2048 || !safeTarget(in.Action.Target) {
			return Record{}, false, ErrInvalid
		}
		b, e := json.Marshal(in.Action)
		if e != nil {
			return Record{}, false, ErrInvalid
		}
		actionJSON = string(b)
	}
	if len(metadata)+len(actionJSON)+len(in.Title)+len(in.Description) > 100*1024 {
		return Record{}, false, ErrInvalid
	}
	id, err := newID()
	if err != nil {
		return Record{}, false, err
	}
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx, `INSERT INTO activities(id,owner_id,source,source_id,event_id,idempotency_key,type,title,description,severity,occurred_at,created_at,is_current,metadata_json,action_json)
	VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`, id, owner, in.Source, in.SourceID, in.EventID, in.IdempotencyKey, in.Type, in.Title, in.Description, in.Severity, in.OccurredAt.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), boolInt(in.Current), string(metadata), actionJSON)
	if err != nil {
		return Record{}, false, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		rec, e := s.findDuplicate(ctx, owner, in)
		if e != nil {
			return Record{}, false, e
		}
		if in.Current {
			_, e = s.db.ExecContext(ctx, `UPDATE activities SET title=?,description=?,severity=?,occurred_at=?,metadata_json=?,action_json=?,created_at=?,is_current=1 WHERE id=?`, in.Title, in.Description, in.Severity, in.OccurredAt.Format(time.RFC3339Nano), string(metadata), actionJSON, now.Format(time.RFC3339Nano), rec.ID)
			if e != nil {
				return Record{}, false, e
			}
			rec, e = s.Get(ctx, owner, rec.ID)
			return rec, true, e
		}
		return rec, true, nil
	}
	record, err := s.Get(ctx, owner, id)
	return record, false, err
}
func (s *Store) findDuplicate(ctx context.Context, owner string, in Input) (Record, error) {
	if in.IdempotencyKey == "" && in.EventID == "" {
		return Record{}, ErrInvalid
	}
	return scanRecord(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM activities WHERE owner_id=? AND source=? AND source_id=? AND ((idempotency_key=? AND ?<>'') OR (event_id=? AND ?<>'')) ORDER BY created_at DESC LIMIT 1`, owner, in.Source, in.SourceID, in.IdempotencyKey, in.IdempotencyKey, in.EventID, in.EventID))
}

const columns = `id,owner_id,source,source_id,event_id,idempotency_key,type,title,description,severity,occurred_at,created_at,is_current,metadata_json,action_json`

func (s *Store) Get(ctx context.Context, owner, id string) (Record, error) {
	return scanRecord(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM activities WHERE owner_id=? AND id=?`, owner, id))
}
func (s *Store) Delete(ctx context.Context, owner, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM activities WHERE owner_id=? AND id=?`, owner, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteExpired removes historical activity events beyond retention. Current
// state records are retained because they represent active conditions rather
// than transient events.
func (s *Store) DeleteExpired(ctx context.Context, retentionDays int) (int64, error) {
	if retentionDays < 1 || retentionDays > 3650 {
		retentionDays = 90
	}
	cutoff := time.Now().UTC().Add(-time.Duration(retentionDays) * 24 * time.Hour).Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `DELETE FROM activities WHERE created_at < ? AND is_current = 0`, cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Store) Clear(ctx context.Context, owner, source, sourceID, key string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM activities WHERE owner_id=? AND source=? AND source_id=? AND idempotency_key=?`, owner, source, sourceID, key)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ClearInstance removes every activity recorded for one integration instance.
// Stopping an SDK provider releases its current-state conditions (such as an
// "unreachable" warning) so none can outlive the runtime that owns them.
func (s *Store) ClearInstance(ctx context.Context, owner, source, sourceID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM activities WHERE owner_id=? AND source=? AND source_id=?`, owner, source, sourceID)
	return err
}
func (s *Store) List(ctx context.Context, owner string, q Query) (Page, error) {
	if owner == "" {
		return Page{}, ErrInvalid
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PerPage < 1 {
		q.PerPage = 20
	}
	if q.PerPage > 100 {
		q.PerPage = 100
	}
	where := []string{"owner_id=?"}
	args := []any{owner}
	if q.Source != "" {
		where = append(where, "source=?")
		args = append(args, q.Source)
	}
	if q.Type != "" {
		where = append(where, "type=?")
		args = append(args, q.Type)
	}
	if q.Severity != "" {
		where = append(where, "severity=?")
		args = append(args, q.Severity)
	}
	if !q.From.IsZero() {
		where = append(where, "occurred_at>=?")
		args = append(args, q.From.UTC().Format(time.RFC3339Nano))
	}
	if !q.To.IsZero() {
		where = append(where, "occurred_at<=?")
		args = append(args, q.To.UTC().Format(time.RFC3339Nano))
	}
	clause := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM activities WHERE `+clause, args...).Scan(&total); err != nil {
		return Page{}, err
	}
	page := Page{Items: []Record{}, Page: q.Page, PerPage: q.PerPage, TotalItems: total}
	if total > 0 {
		page.TotalPages = (total + q.PerPage - 1) / q.PerPage
	}
	args = append(args, q.PerPage, (q.Page-1)*q.PerPage)
	rows, err := s.db.QueryContext(ctx, `SELECT `+columns+` FROM activities WHERE `+clause+` ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	for rows.Next() {
		item, e := scanRecord(rows)
		if e != nil {
			return Page{}, e
		}
		page.Items = append(page.Items, item)
	}
	return page, rows.Err()
}

type scanner interface{ Scan(...any) error }

func scanRecord(row scanner) (Record, error) {
	var r Record
	var sourceID, eventID, key, description, metadata, action string
	var occurred, created string
	var current int
	err := row.Scan(&r.ID, &r.OwnerID, &r.Source, &sourceID, &eventID, &key, &r.Type, &r.Title, &description, &r.Severity, &occurred, &created, &current, &metadata, &action)
	if errors.Is(err, sql.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	r.SourceID = sourceID
	r.EventID = eventID
	r.IdempotencyKey = key
	r.Description = description
	r.Current = current != 0
	r.OccurredAt, _ = time.Parse(time.RFC3339Nano, occurred)
	r.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	_ = json.Unmarshal([]byte(metadata), &r.Metadata)
	if action != "" {
		var a Action
		if json.Unmarshal([]byte(action), &a) == nil {
			r.Action = &a
		}
	}
	return r, nil
}
func tooDeep(v any, depth int) bool {
	if depth > 8 {
		return true
	}
	switch x := v.(type) {
	case map[string]any:
		for k, val := range x {
			if sensitiveName(k) || tooDeep(val, depth+1) {
				return true
			}
		}
	case []any:
		for _, val := range x {
			if tooDeep(val, depth+1) {
				return true
			}
		}
	}
	return false
}
func sensitiveKey(v map[string]any) bool {
	for k, x := range v {
		if sensitiveName(k) {
			return true
		}
		switch y := x.(type) {
		case map[string]any:
			if sensitiveKey(y) {
				return true
			}
		case []any:
			for _, z := range y {
				if m, ok := z.(map[string]any); ok && sensitiveKey(m) {
					return true
				}
			}
		}
	}
	return false
}
func sensitiveName(k string) bool {
	k = strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(k, "_", ""), "-", ""))
	for _, needle := range []string{"password", "passwd", "secret", "token", "authorization", "credential", "apikey", "privatekey"} {
		if strings.Contains(k, needle) {
			return true
		}
	}
	return false
}
func safeTarget(target string) bool {
	return strings.HasPrefix(target, "/") && !strings.HasPrefix(target, "//") && !strings.Contains(target, "\\") && !strings.ContainsAny(target, "\r\n")
}
func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
func newID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
func (s *Store) String() string { return fmt.Sprintf("ActivitiesStore(%p)", s) }
