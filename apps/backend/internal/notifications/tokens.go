package notifications

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"time"
)

type Token struct {
	ID      string  `json:"id"`
	Token   string  `json:"token,omitempty"`
	Topic   Topic   `json:"topic"`
	Expires *string `json:"expires"`
	Created string  `json:"created"`
}

func tokenHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
func (s *Store) CreateToken(ctx context.Context, owner, topicID string, expires *time.Time) (Token, error) {
	topic, e := s.GetTopic(ctx, owner, topicID)
	if e != nil {
		return Token{}, e
	}
	id, e := newID()
	if e != nil {
		return Token{}, e
	}
	secret := make([]byte, 48)
	if _, e = rand.Read(secret); e != nil {
		return Token{}, e
	}
	raw := hex.EncodeToString(secret)
	now := s.now().UTC().Format(time.RFC3339Nano)
	var exp any
	var expText *string
	if expires != nil {
		v := expires.UTC().Format(time.RFC3339Nano)
		exp = v
		expText = &v
	}
	_, e = s.db.ExecContext(ctx, `INSERT INTO notification_topic_tokens(id,topic_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)`, id, topicID, tokenHash(raw), exp, now)
	return Token{ID: id, Token: raw, Topic: topic, Expires: expText, Created: now}, e
}
func (s *Store) ResolveToken(ctx context.Context, raw string) (Topic, error) {
	var t Topic
	var expires *string
	e := s.db.QueryRowContext(ctx, `SELECT t.id,t.title,t.owner_id,t.priority,t.created_at,t.updated_at,k.expires_at FROM notification_topic_tokens k JOIN notification_topics t ON t.id=k.topic_id WHERE k.token_hash=?`, tokenHash(raw)).Scan(&t.ID, &t.Title, &t.UserID, &t.Priority, &t.Created, &t.Updated, &expires)
	if e != nil {
		return Topic{}, ErrNotFound
	}
	if expires != nil {
		parsed, e := time.Parse(time.RFC3339Nano, *expires)
		if e == nil && parsed.Before(s.now()) {
			_, _ = s.db.ExecContext(ctx, `DELETE FROM notification_topic_tokens WHERE token_hash=?`, tokenHash(raw))
			return Topic{}, ErrNotFound
		}
	}
	return t, nil
}
func (s *Store) ListTokens(ctx context.Context, owner string) ([]Token, error) {
	rows, e := s.db.QueryContext(ctx, `SELECT k.id,k.expires_at,k.created_at,t.id,t.title,t.owner_id,t.priority,t.created_at,t.updated_at FROM notification_topic_tokens k JOIN notification_topics t ON t.id=k.topic_id WHERE t.owner_id=? ORDER BY k.created_at DESC`, owner)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Token{}
	for rows.Next() {
		var k Token
		var topic Topic
		if e = rows.Scan(&k.ID, &k.Expires, &k.Created, &topic.ID, &topic.Title, &topic.UserID, &topic.Priority, &topic.Created, &topic.Updated); e != nil {
			return nil, e
		}
		k.Topic = topic
		out = append(out, k)
	}
	return out, rows.Err()
}
func (s *Store) DeleteToken(ctx context.Context, owner, id string) error {
	res, e := s.db.ExecContext(ctx, `DELETE FROM notification_topic_tokens WHERE id=? AND topic_id IN(SELECT id FROM notification_topics WHERE owner_id=?)`, id, owner)
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
func (s *Store) UpdateTokenExpiry(ctx context.Context, owner, id string, expires *time.Time) error {
	var value any
	if expires != nil {
		value = expires.UTC().Format(time.RFC3339Nano)
	}
	res, e := s.db.ExecContext(ctx, `UPDATE notification_topic_tokens SET expires_at=? WHERE id=? AND topic_id IN(SELECT id FROM notification_topics WHERE owner_id=?)`, value, id, owner)
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
func (s *Store) MoveToken(ctx context.Context, owner, id, topicID string) error {
	res, e := s.db.ExecContext(ctx, `UPDATE notification_topic_tokens SET topic_id=? WHERE id=? AND topic_id IN(SELECT id FROM notification_topics WHERE owner_id=?) AND EXISTS(SELECT 1 FROM notification_topics WHERE id=? AND owner_id=?)`, topicID, id, owner, topicID, owner)
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
