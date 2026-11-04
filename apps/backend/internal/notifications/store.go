// Package notifications stores user-owned notification topics and their
// inbox items. Notifications have their own lifecycle and are not resources.
package notifications

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

var ErrNotFound = errors.New("notification record not found")
var ErrInvalid = errors.New("invalid notification input")

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
	now        func() time.Time
	deliveryMu sync.Mutex
}
type Topic struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	UserID   string `json:"userId"`
	Priority int    `json:"priority"`
	Created  string `json:"created"`
	Updated  string `json:"updated"`
}
type Item struct {
	ID            string `json:"id"`
	Content       any    `json:"content"`
	Status        string `json:"status"`
	Created       string `json:"created"`
	TopicID       string `json:"topicId"`
	TopicName     string `json:"topicName"`
	Source        string `json:"source,omitempty"`
	ForwardStatus string `json:"forwardStatus,omitempty"`
	ExpiresAt     string `json:"expiresAt,omitempty"`
}
type Forwarder struct {
	ID       string `json:"id"`
	Topic    Topic  `json:"topic"`
	Target   string `json:"target"`
	IsActive bool   `json:"isActive"`
	Created  string `json:"created"`
	Updated  string `json:"updated"`
}

func NewStore(db *foundation.DB) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("notifications store requires an open database")
	}
	return &Store{db: db.SQL(), foundation: db, now: time.Now}, nil
}
func (s *Store) Initialize(ctx context.Context) error {
	err := s.foundation.ApplyMigrations(ctx, []foundation.Migration{
		{ID: "0012_notifications_schema_repair", Name: "preserve bootstrap notification table", Up: func(ctx context.Context, tx *sql.Tx) error {
			rows, err := tx.QueryContext(ctx, `PRAGMA table_info(notification_items)`)
			if err != nil {
				return err
			}
			hasTable, hasTopicID := false, false
			for rows.Next() {
				var cid, notnull, pk int
				var name, typ string
				var defaultValue any
				if err := rows.Scan(&cid, &name, &typ, &notnull, &defaultValue, &pk); err != nil {
					_ = rows.Close()
					return err
				}
				hasTable = true
				if name == "topic_id" {
					hasTopicID = true
				}
			}
			if err := rows.Err(); err != nil {
				_ = rows.Close()
				return err
			}
			if err := rows.Close(); err != nil {
				return err
			}
			if hasTable && !hasTopicID {
				if _, err := tx.ExecContext(ctx, `ALTER TABLE notification_items RENAME TO notification_items_legacy_bootstrap`); err != nil {
					return fmt.Errorf("preserve bootstrap notifications: %w", err)
				}
			}
			return nil
		}},
		{ID: "0012_notifications_domain", Name: "notification topics and inbox", Up: func(ctx context.Context, tx *sql.Tx) error {
			for _, q := range []string{
				`CREATE TABLE IF NOT EXISTS notification_topics(id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,title TEXT NOT NULL,priority INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(owner_id,title COLLATE NOCASE))`,
				`CREATE INDEX IF NOT EXISTS notification_topics_by_owner ON notification_topics(owner_id,priority,title COLLATE NOCASE)`,
				`CREATE TABLE IF NOT EXISTS notification_items(id TEXT PRIMARY KEY NOT NULL,topic_id TEXT NOT NULL REFERENCES notification_topics(id) ON DELETE CASCADE,content_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'sent',source TEXT NOT NULL DEFAULT 'system',forward_status TEXT NOT NULL DEFAULT 'none',created_at TEXT NOT NULL,received_at TEXT)`,
				`CREATE INDEX IF NOT EXISTS notification_items_by_topic_created ON notification_items(topic_id,created_at DESC)`,
				`CREATE TABLE IF NOT EXISTS notification_topic_tokens(id TEXT PRIMARY KEY NOT NULL,topic_id TEXT NOT NULL REFERENCES notification_topics(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT,created_at TEXT NOT NULL)`,
				`CREATE TABLE IF NOT EXISTS notification_forwarders(id TEXT PRIMARY KEY NOT NULL,topic_id TEXT NOT NULL REFERENCES notification_topics(id) ON DELETE CASCADE,target TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
			} {
				if _, e := tx.ExecContext(ctx, q); e != nil {
					return fmt.Errorf("initialize notifications schema: %w", e)
				}
			}
			return nil
		}},
		{ID: "0013_notification_item_lifecycle", Name: "notification dismissal and expiration", Up: func(ctx context.Context, tx *sql.Tx) error {
			for _, q := range []string{
				`ALTER TABLE notification_items ADD COLUMN dismissed_at TEXT`,
				`ALTER TABLE notification_items ADD COLUMN expires_at TEXT`,
				`CREATE INDEX notification_items_by_expiry ON notification_items(expires_at) WHERE expires_at IS NOT NULL`,
			} {
				if _, err := tx.ExecContext(ctx, q); err != nil {
					return fmt.Errorf("add notification lifecycle fields: %w", err)
				}
			}
			return nil
		}},
	})
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE notification_items SET forward_status='queued' WHERE forward_status='sending'`)
	return err
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	return hex.EncodeToString(b), nil
}
func (s *Store) CreateTopic(ctx context.Context, owner, title string) (Topic, error) {
	title = strings.TrimSpace(title)
	if owner == "" || title == "" || len(title) > 200 {
		return Topic{}, ErrInvalid
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	id, e := newID()
	if e != nil {
		return Topic{}, e
	}
	_, e = s.db.ExecContext(ctx, `INSERT INTO notification_topics(id,owner_id,title,priority,created_at,updated_at) VALUES(?,?,?,1,?,?) ON CONFLICT(owner_id,title) DO NOTHING`, id, owner, title, now, now)
	if e != nil {
		return Topic{}, e
	}
	return s.GetTopicByTitle(ctx, owner, title)
}
func (s *Store) GetTopic(ctx context.Context, owner, id string) (Topic, error) {
	var t Topic
	e := s.db.QueryRowContext(ctx, `SELECT id,title,owner_id,priority,created_at,updated_at FROM notification_topics WHERE owner_id=? AND id=?`, owner, id).Scan(&t.ID, &t.Title, &t.UserID, &t.Priority, &t.Created, &t.Updated)
	if errors.Is(e, sql.ErrNoRows) {
		return Topic{}, ErrNotFound
	}
	return t, e
}
func (s *Store) GetTopicByTitle(ctx context.Context, owner, title string) (Topic, error) {
	var t Topic
	e := s.db.QueryRowContext(ctx, `SELECT id,title,owner_id,priority,created_at,updated_at FROM notification_topics WHERE owner_id=? AND title=? COLLATE NOCASE`, owner, title).Scan(&t.ID, &t.Title, &t.UserID, &t.Priority, &t.Created, &t.Updated)
	if errors.Is(e, sql.ErrNoRows) {
		return Topic{}, ErrNotFound
	}
	return t, e
}
func (s *Store) ListTopics(ctx context.Context, owner string) ([]Topic, error) {
	rows, e := s.db.QueryContext(ctx, `SELECT id,title,owner_id,priority,created_at,updated_at FROM notification_topics WHERE owner_id=? ORDER BY priority,title COLLATE NOCASE`, owner)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Topic{}
	for rows.Next() {
		var t Topic
		if e = rows.Scan(&t.ID, &t.Title, &t.UserID, &t.Priority, &t.Created, &t.Updated); e != nil {
			return nil, e
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Store) DeleteTopic(ctx context.Context, owner, id string) error {
	res, e := s.db.ExecContext(ctx, `DELETE FROM notification_topics WHERE owner_id=? AND id=?`, owner, id)
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
func (s *Store) Publish(ctx context.Context, topicID string, content any, source string) (Item, error) {
	return s.PublishWithExpiry(ctx, topicID, content, source, "")
}

func (s *Store) PublishWithExpiry(ctx context.Context, topicID string, content any, source, expiresAt string) (Item, error) {
	if source == "" {
		source = "system"
	}
	if expiresAt != "" {
		parsed, err := time.Parse(time.RFC3339, expiresAt)
		if err != nil {
			return Item{}, ErrInvalid
		}
		expiresAt = parsed.UTC().Format(time.RFC3339Nano)
	}
	b, e := json.Marshal(content)
	if e != nil {
		return Item{}, fmt.Errorf("encode notification content: %w", e)
	}
	id, e := newID()
	if e != nil {
		return Item{}, e
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	res, e := s.db.ExecContext(ctx, `INSERT INTO notification_items(id,topic_id,content_json,status,source,forward_status,created_at,expires_at) SELECT ?,id,?,'sent',?,'queued',?,? FROM notification_topics WHERE id=?`, id, string(b), source, now, nullableText(expiresAt), topicID)
	if e != nil {
		return Item{}, e
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return Item{}, ErrNotFound
	}
	var value any
	if e = json.Unmarshal(b, &value); e != nil {
		return Item{}, e
	}
	return Item{ID: id, Content: value, Status: "sent", Created: now, TopicID: topicID, Source: source, ForwardStatus: "queued", ExpiresAt: expiresAt}, nil
}

func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (s *Store) ListForwarders(ctx context.Context, owner string) ([]Forwarder, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT f.id,t.id,t.title,t.owner_id,t.priority,t.created_at,t.updated_at,f.target,f.is_active,f.created_at,f.updated_at FROM notification_forwarders f JOIN notification_topics t ON t.id=f.topic_id WHERE t.owner_id=? ORDER BY f.created_at DESC`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Forwarder{}
	for rows.Next() {
		var f Forwarder
		var active int
		if err := rows.Scan(&f.ID, &f.Topic.ID, &f.Topic.Title, &f.Topic.UserID, &f.Topic.Priority, &f.Topic.Created, &f.Topic.Updated, &f.Target, &active, &f.Created, &f.Updated); err != nil {
			return nil, err
		}
		f.IsActive = active != 0
		items = append(items, f)
	}
	return items, rows.Err()
}

func (s *Store) CreateForwarder(ctx context.Context, owner, topicID, target string, active bool) (Forwarder, error) {
	target = strings.TrimSpace(target)
	if target == "" || len(target) > 4096 {
		return Forwarder{}, ErrInvalid
	}
	topic, err := s.GetTopic(ctx, owner, topicID)
	if err != nil {
		return Forwarder{}, err
	}
	id, err := newID()
	if err != nil {
		return Forwarder{}, err
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	activeValue := 0
	if active {
		activeValue = 1
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO notification_forwarders(id,topic_id,target,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?)`, id, topic.ID, target, activeValue, now, now); err != nil {
		return Forwarder{}, err
	}
	return s.GetForwarder(ctx, owner, id)
}

func (s *Store) GetForwarder(ctx context.Context, owner, id string) (Forwarder, error) {
	var f Forwarder
	var active int
	err := s.db.QueryRowContext(ctx, `SELECT f.id,t.id,t.title,t.owner_id,t.priority,t.created_at,t.updated_at,f.target,f.is_active,f.created_at,f.updated_at FROM notification_forwarders f JOIN notification_topics t ON t.id=f.topic_id WHERE t.owner_id=? AND f.id=?`, owner, id).Scan(&f.ID, &f.Topic.ID, &f.Topic.Title, &f.Topic.UserID, &f.Topic.Priority, &f.Topic.Created, &f.Topic.Updated, &f.Target, &active, &f.Created, &f.Updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Forwarder{}, ErrNotFound
	}
	if err != nil {
		return Forwarder{}, err
	}
	f.IsActive = active != 0
	return f, nil
}

func (s *Store) UpdateForwarder(ctx context.Context, owner, id string, target *string, active *bool) (Forwarder, error) {
	current, err := s.GetForwarder(ctx, owner, id)
	if err != nil {
		return Forwarder{}, err
	}
	nextTarget := current.Target
	if target != nil {
		nextTarget = strings.TrimSpace(*target)
		if nextTarget == "" || len(nextTarget) > 4096 {
			return Forwarder{}, ErrInvalid
		}
	}
	nextActive := current.IsActive
	if active != nil {
		nextActive = *active
	}
	activeValue := 0
	if nextActive {
		activeValue = 1
	}
	_, err = s.db.ExecContext(ctx, `UPDATE notification_forwarders SET target=?,is_active=?,updated_at=? WHERE id=?`, nextTarget, activeValue, s.now().UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return Forwarder{}, err
	}
	return s.GetForwarder(ctx, owner, id)
}

func (s *Store) DeleteForwarder(ctx context.Context, owner, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM notification_forwarders WHERE id=? AND topic_id IN(SELECT id FROM notification_topics WHERE owner_id=?)`, id, owner)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

// ProcessQueued sends pending notifications and leaves failures queued so the
// scheduler can retry them. The local mutex prevents overlapping worker runs.
func (s *Store) ProcessQueued(ctx context.Context, send func(context.Context, string, string) error, limit int) error {
	if send == nil {
		return ErrInvalid
	}
	s.deliveryMu.Lock()
	defer s.deliveryMu.Unlock()
	if err := s.PruneExpired(ctx); err != nil {
		return err
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT i.id,i.topic_id,i.content_json FROM notification_items i WHERE i.forward_status='queued' ORDER BY i.created_at LIMIT ?`, limit)
	if err != nil {
		return err
	}
	type pending struct{ id, topic, content string }
	pendingItems := []pending{}
	for rows.Next() {
		var item pending
		if err := rows.Scan(&item.id, &item.topic, &item.content); err != nil {
			rows.Close()
			return err
		}
		pendingItems = append(pendingItems, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, item := range pendingItems {
		if err := ctx.Err(); err != nil {
			return err
		}
		result, err := s.db.ExecContext(ctx, `UPDATE notification_items SET forward_status='sending' WHERE id=? AND forward_status='queued'`, item.id)
		if err != nil {
			return err
		}
		claimed, _ := result.RowsAffected()
		if claimed == 0 {
			continue
		}
		forwarders, err := s.activeForwardersForTopic(ctx, item.topic)
		if err != nil {
			_, _ = s.db.ExecContext(ctx, `UPDATE notification_items SET forward_status='queued' WHERE id=? AND forward_status='sending'`, item.id)
			return err
		}
		if len(forwarders) == 0 {
			_, err = s.db.ExecContext(ctx, `UPDATE notification_items SET forward_status='done' WHERE id=? AND forward_status='sending'`, item.id)
			if err != nil {
				return err
			}
			continue
		}
		var content any
		if err := json.Unmarshal([]byte(item.content), &content); err != nil {
			_, _ = s.db.ExecContext(ctx, `UPDATE notification_items SET forward_status='queued' WHERE id=? AND forward_status='sending'`, item.id)
			continue
		}
		message := FormatMessage(content)
		sent := false
		for _, forwarder := range forwarders {
			if send(ctx, forwarder.Target, message) == nil {
				sent = true
			}
		}
		status := "queued"
		if sent {
			status = "done"
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE notification_items SET forward_status=? WHERE id=? AND forward_status='sending'`, status, item.id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) activeForwardersForTopic(ctx context.Context, topicID string) ([]Forwarder, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,target,is_active,created_at,updated_at FROM notification_forwarders WHERE topic_id=? AND is_active=1`, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Forwarder{}
	for rows.Next() {
		var f Forwarder
		var active int
		if err := rows.Scan(&f.ID, &f.Target, &active, &f.Created, &f.Updated); err != nil {
			return nil, err
		}
		f.IsActive = active != 0
		out = append(out, f)
	}
	return out, rows.Err()
}

func FormatMessage(content any) string {
	switch value := content.(type) {
	case string:
		return value
	case map[string]any:
		if message, ok := value["message"].(string); ok && message != "" {
			return message
		}
		if title, ok := value["title"].(string); ok && title != "" {
			return title
		}
	}
	encoded, err := json.Marshal(content)
	if err == nil {
		return string(encoded)
	}
	return fmt.Sprint(content)
}
func (s *Store) ListItems(ctx context.Context, owner string, unread bool) ([]Item, error) {
	if err := s.PruneExpired(ctx); err != nil {
		return nil, err
	}
	q := `SELECT i.id,i.content_json,i.status,i.created_at,t.id,t.title,i.source,i.forward_status,COALESCE(i.expires_at,'') FROM notification_items i JOIN notification_topics t ON t.id=i.topic_id WHERE t.owner_id=? AND i.dismissed_at IS NULL`
	if unread {
		q += ` AND i.status!='read'`
	}
	q += ` ORDER BY i.created_at DESC`
	rows, e := s.db.QueryContext(ctx, q, owner)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Item{}
	ids := []string{}
	for rows.Next() {
		var i Item
		var raw string
		if e = rows.Scan(&i.ID, &raw, &i.Status, &i.Created, &i.TopicID, &i.TopicName, &i.Source, &i.ForwardStatus, &i.ExpiresAt); e != nil {
			return nil, e
		}
		if e = json.Unmarshal([]byte(raw), &i.Content); e != nil {
			return nil, e
		}
		if i.Status == "sent" {
			i.Status = "received"
			ids = append(ids, i.ID)
		}
		out = append(out, i)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	if len(ids) > 0 {
		tx, e := s.db.BeginTx(ctx, nil)
		if e != nil {
			return nil, e
		}
		defer tx.Rollback()
		for _, id := range ids {
			if _, e = tx.ExecContext(ctx, `UPDATE notification_items SET status='received',received_at=? WHERE id=? AND status='sent'`, s.now().UTC().Format(time.RFC3339Nano), id); e != nil {
				return nil, e
			}
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
	}
	return out, nil
}
func (s *Store) Counts(ctx context.Context, owner string) (map[string]int, error) {
	if err := s.PruneExpired(ctx); err != nil {
		return nil, err
	}
	var total, unread int
	e := s.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN i.status!='read' THEN 1 ELSE 0 END),0) FROM notification_items i JOIN notification_topics t ON t.id=i.topic_id WHERE t.owner_id=? AND i.dismissed_at IS NULL`, owner).Scan(&total, &unread)
	return map[string]int{"total": total, "unread": unread}, e
}

func (s *Store) PruneExpired(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM notification_items WHERE expires_at IS NOT NULL AND expires_at<=?`, s.now().UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Store) Dismiss(ctx context.Context, owner string, ids []string) error {
	now := s.now().UTC().Format(time.RFC3339Nano)
	if len(ids) == 0 {
		_, err := s.db.ExecContext(ctx, `UPDATE notification_items SET dismissed_at=? WHERE topic_id IN(SELECT id FROM notification_topics WHERE owner_id=?) AND dismissed_at IS NULL`, now, owner)
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, id := range ids {
		if _, err = tx.ExecContext(ctx, `UPDATE notification_items SET dismissed_at=? WHERE id=? AND topic_id IN(SELECT id FROM notification_topics WHERE owner_id=?) AND dismissed_at IS NULL`, now, id, owner); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) MarkRead(ctx context.Context, owner string, ids []string) error {
	if len(ids) == 0 {
		_, e := s.db.ExecContext(ctx, `UPDATE notification_items SET status='read' WHERE topic_id IN(SELECT id FROM notification_topics WHERE owner_id=?) AND status!='read'`, owner)
		return e
	}
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, id := range ids {
		if _, e = tx.ExecContext(ctx, `UPDATE notification_items SET status='read' WHERE id=? AND topic_id IN(SELECT id FROM notification_topics WHERE owner_id=?)`, id, owner); e != nil {
			return e
		}
	}
	return tx.Commit()
}
