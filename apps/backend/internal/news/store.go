package news

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
	ErrNotFound = errors.New("news record not found")
	ErrInvalid  = errors.New("invalid news input")
)

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
	clock      func() time.Time
}

func NewStore(db *foundation.DB) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("news store requires an open database")
	}
	return &Store{db: db.SQL(), foundation: db, clock: time.Now}, nil
}

// Initialize creates the News-owned schema. The operation is safe to repeat.
func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{
		ID: "0011_news_domain", Name: "create News subscriptions and materialized article tables",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			statements := []string{
				`CREATE TABLE IF NOT EXISTS news_subscriptions (
			id TEXT PRIMARY KEY NOT NULL,
			owner_id TEXT NOT NULL,
			url TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			icon TEXT NOT NULL DEFAULT '',
			settings_json TEXT NOT NULL DEFAULT '{}',
			fetch_errors TEXT NOT NULL DEFAULT '',
			fetch_error_count INTEGER NOT NULL DEFAULT 0,
			last_fetched_at TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE(owner_id, url)
		)`,
				`CREATE INDEX IF NOT EXISTS news_subscriptions_by_owner ON news_subscriptions(owner_id, title COLLATE NOCASE)`,
				`CREATE TABLE IF NOT EXISTS news_feeds (
			id TEXT PRIMARY KEY NOT NULL,
			owner_id TEXT NOT NULL,
			title TEXT NOT NULL,
			icon TEXT NOT NULL DEFAULT '',
			feed_type TEXT NOT NULL DEFAULT 'custom',
			system_key TEXT NOT NULL DEFAULT '',
			max_items INTEGER NOT NULL DEFAULT 200,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
				`CREATE INDEX IF NOT EXISTS news_feeds_by_owner ON news_feeds(owner_id, title COLLATE NOCASE)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS news_feeds_by_system_key ON news_feeds(owner_id, system_key) WHERE system_key <> ''`,
				`CREATE TABLE IF NOT EXISTS news_feed_subscriptions (
			owner_id TEXT NOT NULL,
			feed_id TEXT NOT NULL REFERENCES news_feeds(id) ON DELETE CASCADE,
			subscription_id TEXT NOT NULL REFERENCES news_subscriptions(id) ON DELETE CASCADE,
			PRIMARY KEY(feed_id, subscription_id)
		)`,
				`CREATE TABLE IF NOT EXISTS news_feed_includes (
			owner_id TEXT NOT NULL,
			feed_id TEXT NOT NULL REFERENCES news_feeds(id) ON DELETE CASCADE,
			included_feed_id TEXT NOT NULL REFERENCES news_feeds(id) ON DELETE CASCADE,
			PRIMARY KEY(feed_id, included_feed_id),
			CHECK(feed_id <> included_feed_id)
		)`,
				`CREATE TABLE IF NOT EXISTS news_feed_exclusions (
			owner_id TEXT NOT NULL,
			feed_id TEXT NOT NULL REFERENCES news_feeds(id) ON DELETE CASCADE,
			subscription_id TEXT NOT NULL REFERENCES news_subscriptions(id) ON DELETE CASCADE,
			PRIMARY KEY(feed_id, subscription_id)
		)`,
				`CREATE TABLE IF NOT EXISTS news_articles (
			id TEXT PRIMARY KEY NOT NULL,
			owner_id TEXT NOT NULL,
			dedupe_key TEXT NOT NULL,
			canonical_url TEXT NOT NULL DEFAULT '',
			guid TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL DEFAULT '',
			published_at TEXT,
			data_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE(owner_id, dedupe_key)
		)`,
				`CREATE INDEX IF NOT EXISTS news_articles_by_published ON news_articles(owner_id, published_at DESC, id)`,
				`CREATE INDEX IF NOT EXISTS news_articles_by_canonical_url ON news_articles(owner_id, canonical_url)`,
				`CREATE TABLE IF NOT EXISTS news_article_sources (
			article_id TEXT NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
			subscription_id TEXT NOT NULL REFERENCES news_subscriptions(id) ON DELETE CASCADE,
			last_seen_at TEXT NOT NULL,
			PRIMARY KEY(article_id, subscription_id)
		)`,
				`CREATE INDEX IF NOT EXISTS news_article_sources_by_subscription ON news_article_sources(subscription_id, last_seen_at DESC)`,
				`CREATE TABLE IF NOT EXISTS news_saved_lists (
			id TEXT PRIMARY KEY NOT NULL,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE(owner_id, name COLLATE NOCASE)
		)`,
				`CREATE TABLE IF NOT EXISTS news_saved_list_items (
			owner_id TEXT NOT NULL,
			list_id TEXT NOT NULL REFERENCES news_saved_lists(id) ON DELETE CASCADE,
			article_id TEXT NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
			created_at TEXT NOT NULL,
			PRIMARY KEY(list_id, article_id)
		)`,
				`CREATE INDEX IF NOT EXISTS news_saved_list_items_by_owner ON news_saved_list_items(owner_id, created_at DESC)`,
				`CREATE TABLE IF NOT EXISTS news_article_user_state (
			owner_id TEXT NOT NULL,
			article_id TEXT NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
			is_read INTEGER NOT NULL DEFAULT 0,
			read_at TEXT,
			updated_at TEXT NOT NULL,
			PRIMARY KEY(owner_id, article_id)
		)`,
				`CREATE TABLE IF NOT EXISTS news_preferences (
			owner_id TEXT PRIMARY KEY NOT NULL,
			default_list_id TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL
		)`,
			}
			for _, statement := range statements {
				if _, err := tx.ExecContext(ctx, statement); err != nil {
					return fmt.Errorf("initialize news schema: %w", err)
				}
			}
			return nil
		},
		Down: func(ctx context.Context, tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS news_preferences; DROP TABLE IF EXISTS news_article_user_state; DROP TABLE IF EXISTS news_saved_list_items; DROP TABLE IF EXISTS news_saved_lists; DROP TABLE IF EXISTS news_article_sources; DROP TABLE IF EXISTS news_articles; DROP TABLE IF EXISTS news_feed_exclusions; DROP TABLE IF EXISTS news_feed_includes; DROP TABLE IF EXISTS news_feed_subscriptions; DROP TABLE IF EXISTS news_feeds; DROP TABLE IF EXISTS news_subscriptions;`)
			return err
		},
	}})
}

func (s *Store) CreateSubscription(ctx context.Context, ownerID string, input SubscriptionInput) (Subscription, error) {
	ownerID = strings.TrimSpace(ownerID)
	url := strings.TrimSpace(input.URL)
	title := strings.TrimSpace(input.Title)
	if ownerID == "" || url == "" {
		return Subscription{}, fmt.Errorf("%w: owner and feed URL are required", ErrInvalid)
	}
	settings, err := json.Marshal(input.SettingsOrEmpty())
	if err != nil {
		return Subscription{}, fmt.Errorf("encode subscription settings: %w", err)
	}
	now := s.now().Format(time.RFC3339Nano)
	id, err := newID()
	if err != nil {
		return Subscription{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO news_subscriptions(id,owner_id,url,title,icon,settings_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, id, ownerID, url, title, strings.TrimSpace(input.Icon), string(settings), now, now)
	if err != nil {
		if isUnique(err) {
			return Subscription{}, fmt.Errorf("%w: subscription already exists", ErrInvalid)
		}
		return Subscription{}, fmt.Errorf("create news subscription: %w", err)
	}
	return s.GetSubscription(ctx, ownerID, id)
}

func (s *Store) GetSubscription(ctx context.Context, ownerID, id string) (Subscription, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id,owner_id,url,title,icon,settings_json,fetch_errors,fetch_error_count,last_fetched_at,created_at,updated_at FROM news_subscriptions WHERE owner_id=? AND id=?`, ownerID, id)
	return scanSubscription(row)
}

func (s *Store) ListSubscriptions(ctx context.Context, ownerID string) ([]Subscription, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,owner_id,url,title,icon,settings_json,fetch_errors,fetch_error_count,last_fetched_at,created_at,updated_at FROM news_subscriptions WHERE owner_id=? ORDER BY title COLLATE NOCASE,url`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list news subscriptions: %w", err)
	}
	defer rows.Close()
	items := make([]Subscription, 0)
	for rows.Next() {
		item, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) UpdateSubscription(ctx context.Context, ownerID, id string, input SubscriptionInput) (Subscription, error) {
	url, title := strings.TrimSpace(input.URL), strings.TrimSpace(input.Title)
	if url == "" {
		return Subscription{}, fmt.Errorf("%w: feed URL is required", ErrInvalid)
	}
	settings, err := json.Marshal(input.SettingsOrEmpty())
	if err != nil {
		return Subscription{}, fmt.Errorf("encode subscription settings: %w", err)
	}
	result, err := s.db.ExecContext(ctx, `UPDATE news_subscriptions SET url=?,title=?,icon=?,settings_json=?,updated_at=? WHERE owner_id=? AND id=?`, url, title, strings.TrimSpace(input.Icon), string(settings), s.now().Format(time.RFC3339Nano), ownerID, id)
	if err != nil {
		if isUnique(err) {
			return Subscription{}, fmt.Errorf("%w: subscription already exists", ErrInvalid)
		}
		return Subscription{}, fmt.Errorf("update news subscription: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return Subscription{}, err
	}
	if count == 0 {
		return Subscription{}, ErrNotFound
	}
	return s.GetSubscription(ctx, ownerID, id)
}

func (s *Store) DeleteSubscription(ctx context.Context, ownerID, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `DELETE FROM news_subscriptions WHERE owner_id=? AND id=?`, ownerID, id)
	if err != nil {
		return fmt.Errorf("delete news subscription: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM news_articles WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM news_article_sources s WHERE s.article_id=news_articles.id) AND NOT EXISTS(SELECT 1 FROM news_saved_list_items i WHERE i.article_id=news_articles.id)`, ownerID)
	if err != nil {
		return fmt.Errorf("clean orphaned news articles: %w", err)
	}
	return tx.Commit()
}

func (s *Store) RecordFetchResult(ctx context.Context, ownerID, subscriptionID, fetchError string) error {
	now := s.now().UTC()
	var result sql.Result
	var err error
	if strings.TrimSpace(fetchError) == "" {
		result, err = s.db.ExecContext(ctx, `UPDATE news_subscriptions SET fetch_errors='',fetch_error_count=0,last_fetched_at=?,updated_at=? WHERE owner_id=? AND id=?`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), ownerID, subscriptionID)
	} else {
		result, err = s.db.ExecContext(ctx, `UPDATE news_subscriptions SET fetch_errors=?,fetch_error_count=fetch_error_count+1,updated_at=? WHERE owner_id=? AND id=?`, fetchError, now.Format(time.RFC3339Nano), ownerID, subscriptionID)
	}
	if err != nil {
		return fmt.Errorf("record news fetch result: %w", err)
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

func (s *Store) now() time.Time { return s.clock().UTC() }

func (input SubscriptionInput) SettingsOrEmpty() map[string]any {
	if input.Settings == nil {
		return map[string]any{}
	}
	return input.Settings
}

type rowScanner interface{ Scan(...any) error }

func scanSubscription(row rowScanner) (Subscription, error) {
	var item Subscription
	var settings, lastFetched, createdAt, updatedAt string
	if err := row.Scan(&item.ID, &item.OwnerID, &item.URL, &item.Title, &item.Icon, &settings, &item.FetchErrors, &item.FetchErrorCount, &lastFetched, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Subscription{}, ErrNotFound
		}
		return Subscription{}, fmt.Errorf("read news subscription: %w", err)
	}
	item.Settings = json.RawMessage(settings)
	var err error
	item.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return Subscription{}, err
	}
	item.UpdatedAt, err = parseTime(updatedAt)
	if err != nil {
		return Subscription{}, err
	}
	if lastFetched != "" {
		parsed, err := parseTime(lastFetched)
		if err != nil {
			return Subscription{}, err
		}
		item.LastFetchedAt = &parsed
	}
	return item, nil
}

func newID() (string, error) {
	return randomID()
}

func randomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate news ID: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

func isUnique(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}

func parseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse news timestamp: %w", err)
	}
	return parsed, nil
}
