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
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

var ErrNotFound = errors.New("notification record not found")
var ErrInvalid = errors.New("invalid notification input")

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
	now        func() time.Time
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
}

func NewStore(db *foundation.DB) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("notifications store requires an open database")
	}
	return &Store{db: db.SQL(), foundation: db, now: time.Now}, nil
}
func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{ID: "0012_notifications_domain", Name: "notification topics and inbox", Up: func(ctx context.Context, tx *sql.Tx) error {
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
	}}})
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
	if source == "" {
		source = "system"
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
	res, e := s.db.ExecContext(ctx, `INSERT INTO notification_items(id,topic_id,content_json,status,source,forward_status,created_at) SELECT ?,id,?,'sent',?,'queued',? FROM notification_topics WHERE id=?`, id, string(b), source, now, topicID)
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
	return Item{ID: id, Content: value, Status: "sent", Created: now, TopicID: topicID, Source: source, ForwardStatus: "queued"}, nil
}
func (s *Store) ListItems(ctx context.Context, owner string, unread bool) ([]Item, error) {
	q := `SELECT i.id,i.content_json,i.status,i.created_at,t.id,t.title,i.source,i.forward_status FROM notification_items i JOIN notification_topics t ON t.id=i.topic_id WHERE t.owner_id=?`
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
		if e = rows.Scan(&i.ID, &raw, &i.Status, &i.Created, &i.TopicID, &i.TopicName, &i.Source, &i.ForwardStatus); e != nil {
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
	var total, unread int
	e := s.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN i.status!='read' THEN 1 ELSE 0 END),0) FROM notification_items i JOIN notification_topics t ON t.id=i.topic_id WHERE t.owner_id=?`, owner).Scan(&total, &unread)
	return map[string]int{"total": total, "unread": unread}, e
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
