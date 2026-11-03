package news

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

func (s *Store) EnsureAllFeed(ctx context.Context, ownerID string) (Feed, error) {
	if strings.TrimSpace(ownerID) == "" {
		return Feed{}, fmt.Errorf("%w: owner is required", ErrInvalid)
	}
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM news_feeds WHERE owner_id=? AND system_key='all'`, ownerID).Scan(&id)
	if err == nil {
		return s.GetFeed(ctx, ownerID, id)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Feed{}, fmt.Errorf("find all-news feed: %w", err)
	}
	id, err = randomID()
	if err != nil {
		return Feed{}, err
	}
	now := s.now().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO news_feeds(id,owner_id,title,feed_type,system_key,max_items,created_at,updated_at) VALUES(?,?,?,'all','all',200,?,?)`, id, ownerID, "All feed", now, now)
	if err != nil {
		return Feed{}, fmt.Errorf("create all-news feed: %w", err)
	}
	return s.GetFeed(ctx, ownerID, id)
}

func (s *Store) CreateFeed(ctx context.Context, ownerID, title, icon string) (Feed, error) {
	ownerID, title = strings.TrimSpace(ownerID), strings.TrimSpace(title)
	if ownerID == "" || title == "" || len(title) > 200 {
		return Feed{}, fmt.Errorf("%w: feed title is required", ErrInvalid)
	}
	id, err := randomID()
	if err != nil {
		return Feed{}, err
	}
	now := s.now().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO news_feeds(id,owner_id,title,icon,feed_type,max_items,created_at,updated_at) VALUES(?,?,?,?,'custom',200,?,?)`, id, ownerID, title, strings.TrimSpace(icon), now, now)
	if err != nil {
		return Feed{}, fmt.Errorf("create news feed: %w", err)
	}
	return s.GetFeed(ctx, ownerID, id)
}

func (s *Store) GetFeed(ctx context.Context, ownerID, id string) (Feed, error) {
	var feed Feed
	var createdAt, updatedAt string
	err := s.db.QueryRowContext(ctx, `SELECT id,owner_id,title,icon,feed_type,system_key,max_items,created_at,updated_at FROM news_feeds WHERE owner_id=? AND id=?`, ownerID, id).
		Scan(&feed.ID, &feed.OwnerID, &feed.Title, &feed.Icon, &feed.Type, &feed.SystemKey, &feed.MaxItems, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Feed{}, ErrNotFound
	}
	if err != nil {
		return Feed{}, fmt.Errorf("get news feed: %w", err)
	}
	feed.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return Feed{}, err
	}
	feed.UpdatedAt, err = parseTime(updatedAt)
	if err != nil {
		return Feed{}, err
	}
	feed.SubscriptionRefs, err = s.listFeedRefs(ctx, `SELECT subscription_id FROM news_feed_subscriptions WHERE owner_id=? AND feed_id=? ORDER BY subscription_id`, ownerID, id)
	if err != nil {
		return Feed{}, err
	}
	feed.IncludedFeedRefs, err = s.listFeedRefs(ctx, `SELECT included_feed_id FROM news_feed_includes WHERE owner_id=? AND feed_id=? ORDER BY included_feed_id`, ownerID, id)
	if err != nil {
		return Feed{}, err
	}
	feed.ExcludedSubscriptionRefs, err = s.listFeedRefs(ctx, `SELECT subscription_id FROM news_feed_exclusions WHERE owner_id=? AND feed_id=? ORDER BY subscription_id`, ownerID, id)
	return feed, err
}

func (s *Store) ListFeeds(ctx context.Context, ownerID string) ([]Feed, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM news_feeds WHERE owner_id=? ORDER BY CASE WHEN system_key='all' THEN 0 ELSE 1 END,title COLLATE NOCASE`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list news feeds: %w", err)
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	feeds := make([]Feed, 0, len(ids))
	for _, id := range ids {
		feed, err := s.GetFeed(ctx, ownerID, id)
		if err != nil {
			return nil, err
		}
		feeds = append(feeds, feed)
	}
	return feeds, nil
}

// UpdateFeed replaces the feed's references in one transaction. References
// must point to records owned by ownerID, and nested feeds are cycle-checked.
func (s *Store) UpdateFeed(ctx context.Context, ownerID, id, title, icon string, subscriptions, included, excluded []string, maxItems int) (Feed, error) {
	feed, err := s.GetFeed(ctx, ownerID, id)
	if err != nil {
		return Feed{}, err
	}
	if feed.SystemKey == "all" {
		title = strings.TrimSpace(title)
		if title == "" {
			title = "All feed"
		}
		subscriptions, included = nil, nil
	} else {
		title = strings.TrimSpace(title)
		if title == "" {
			title = feed.Title
		}
	}
	if title == "" || len(title) > 200 {
		return Feed{}, fmt.Errorf("%w: feed title is invalid", ErrInvalid)
	}
	if maxItems <= 0 {
		maxItems = 200
	}
	if maxItems > 5000 {
		return Feed{}, fmt.Errorf("%w: max feed items cannot exceed 5000", ErrInvalid)
	}
	subscriptions = uniqueStrings(subscriptions)
	included = uniqueStrings(included)
	excluded = uniqueStrings(excluded)
	if err := s.validateReferences(ctx, ownerID, id, subscriptions, included, excluded); err != nil {
		return Feed{}, err
	}
	if feed.SystemKey != "all" {
		if err := s.checkFeedCycle(ctx, ownerID, id, included); err != nil {
			return Feed{}, err
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Feed{}, err
	}
	defer func() { _ = tx.Rollback() }()
	now := s.now().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `UPDATE news_feeds SET title=?,icon=?,feed_type=?,max_items=?,updated_at=? WHERE owner_id=? AND id=?`, title, strings.TrimSpace(icon), feed.Type, maxItems, now, ownerID, id); err != nil {
		return Feed{}, fmt.Errorf("update news feed: %w", err)
	}
	for _, table := range []string{"news_feed_subscriptions", "news_feed_includes", "news_feed_exclusions"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE owner_id=? AND feed_id=?`, ownerID, id); err != nil {
			return Feed{}, fmt.Errorf("replace news feed references: %w", err)
		}
	}
	for _, ref := range subscriptions {
		if _, err := tx.ExecContext(ctx, `INSERT INTO news_feed_subscriptions(owner_id,feed_id,subscription_id) VALUES(?,?,?)`, ownerID, id, ref); err != nil {
			return Feed{}, err
		}
	}
	for _, ref := range included {
		if _, err := tx.ExecContext(ctx, `INSERT INTO news_feed_includes(owner_id,feed_id,included_feed_id) VALUES(?,?,?)`, ownerID, id, ref); err != nil {
			return Feed{}, err
		}
	}
	for _, ref := range excluded {
		if _, err := tx.ExecContext(ctx, `INSERT INTO news_feed_exclusions(owner_id,feed_id,subscription_id) VALUES(?,?,?)`, ownerID, id, ref); err != nil {
			return Feed{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Feed{}, err
	}
	return s.GetFeed(ctx, ownerID, id)
}

func (s *Store) DeleteFeed(ctx context.Context, ownerID, id string) error {
	feed, err := s.GetFeed(ctx, ownerID, id)
	if err != nil {
		return err
	}
	if feed.SystemKey == "all" || id == "all" {
		return fmt.Errorf("%w: all feed cannot be deleted", ErrInvalid)
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM news_feeds WHERE owner_id=? AND id=?`, ownerID, id)
	if err != nil {
		return fmt.Errorf("delete news feed: %w", err)
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

func (s *Store) selectedSubscriptionIDs(ctx context.Context, ownerID, feedID string) ([]string, error) {
	subs, err := s.ListSubscriptions(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	all := make(map[string]struct{}, len(subs))
	for _, subscription := range subs {
		all[subscription.ID] = struct{}{}
	}
	if feedID == "" || feedID == "all" {
		return s.allSubscriptionIDs(ctx, ownerID, all)
	}
	feed, err := s.GetFeed(ctx, ownerID, feedID)
	if err != nil {
		return nil, err
	}
	if feed.SystemKey == "all" {
		return s.allSubscriptionIDs(ctx, ownerID, all)
	}
	visited := map[string]struct{}{}
	var visit func(Feed) (map[string]struct{}, error)
	visit = func(current Feed) (map[string]struct{}, error) {
		if _, ok := visited[current.ID]; ok {
			return map[string]struct{}{}, nil
		}
		visited[current.ID] = struct{}{}
		selected, excluded := map[string]struct{}{}, map[string]struct{}{}
		for _, id := range current.SubscriptionRefs {
			if _, ok := all[id]; ok {
				selected[id] = struct{}{}
			}
		}
		for _, id := range current.ExcludedSubscriptionRefs {
			excluded[id] = struct{}{}
		}
		for _, childID := range current.IncludedFeedRefs {
			child, err := s.GetFeed(ctx, ownerID, childID)
			if err != nil {
				return nil, err
			}
			childSelected, err := visit(child)
			if err != nil {
				return nil, err
			}
			for id := range childSelected {
				selected[id] = struct{}{}
			}
		}
		for id := range excluded {
			delete(selected, id)
		}
		return selected, nil
	}
	selected, err := visit(feed)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(selected))
	for id := range selected {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids, nil
}

func (s *Store) allSubscriptionIDs(ctx context.Context, ownerID string, all map[string]struct{}) ([]string, error) {
	ids := make([]string, 0, len(all))
	excluded := map[string]struct{}{}
	var allFeedID string
	if err := s.db.QueryRowContext(ctx, `SELECT id FROM news_feeds WHERE owner_id=? AND system_key='all'`, ownerID).Scan(&allFeedID); err == nil {
		allFeed, err := s.GetFeed(ctx, ownerID, allFeedID)
		if err != nil {
			return nil, err
		}
		for _, id := range allFeed.ExcludedSubscriptionRefs {
			excluded[id] = struct{}{}
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	for id := range all {
		if _, skip := excluded[id]; !skip {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids, nil
}

func (s *Store) UpsertArticles(ctx context.Context, ownerID, subscriptionID string, items []ArticleInput, retention int) error {
	if ownerID == "" || subscriptionID == "" {
		return fmt.Errorf("%w: owner and subscription are required", ErrInvalid)
	}
	if retention <= 0 {
		retention = 200
	}
	if retention > 10000 {
		return fmt.Errorf("%w: retention cannot exceed 10000", ErrInvalid)
	}
	var subscriptionURL string
	if err := s.db.QueryRowContext(ctx, `SELECT url FROM news_subscriptions WHERE owner_id=? AND id=?`, ownerID, subscriptionID).Scan(&subscriptionURL); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// The batch is a successful full snapshot for this subscription. A failed
	// fetch never calls this method, so stale materialized items survive errors.
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_article_sources WHERE subscription_id=?`, subscriptionID); err != nil {
		return fmt.Errorf("replace materialized subscription snapshot: %w", err)
	}
	now := s.now().Format(time.RFC3339Nano)
	for _, item := range items {
		data := item.Data
		if data == nil {
			data = map[string]any{}
		}
		if item.Title == "" {
			item.Title, _ = data["title"].(string)
		}
		item.Title = strings.TrimSpace(item.Title)
		if item.CanonicalURL == "" {
			if value, ok := data["link"].(string); ok {
				item.CanonicalURL = CanonicalizeURL(value)
			}
		}
		if item.DedupeKey == "" {
			item.DedupeKey = ArticleKey(item.CanonicalURL, item.GUID, item.Title, subscriptionURL, item.PublishedAt)
		}
		if item.DedupeKey == "" {
			continue
		}
		encoded, err := json.Marshal(data)
		if err != nil {
			return fmt.Errorf("encode article data: %w", err)
		}
		published := ""
		if item.PublishedAt != nil {
			published = item.PublishedAt.UTC().Format(time.RFC3339Nano)
			data["pubDate"] = published
			encoded, err = json.Marshal(data)
			if err != nil {
				return fmt.Errorf("encode article data: %w", err)
			}
		}
		id, err := randomID()
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO news_articles(id,owner_id,dedupe_key,canonical_url,guid,title,published_at,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,dedupe_key) DO UPDATE SET canonical_url=CASE WHEN excluded.canonical_url<>'' THEN excluded.canonical_url ELSE news_articles.canonical_url END,guid=CASE WHEN excluded.guid<>'' THEN excluded.guid ELSE news_articles.guid END,title=CASE WHEN excluded.title<>'' THEN excluded.title ELSE news_articles.title END,published_at=COALESCE(excluded.published_at,news_articles.published_at),data_json=excluded.data_json,updated_at=excluded.updated_at`, id, ownerID, item.DedupeKey, item.CanonicalURL, item.GUID, item.Title, nullable(published), string(encoded), now, now)
		if err != nil {
			return fmt.Errorf("upsert materialized article: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO news_article_sources(article_id,subscription_id,last_seen_at) SELECT id,?,? FROM news_articles WHERE owner_id=? AND dedupe_key=? ON CONFLICT(article_id,subscription_id) DO UPDATE SET last_seen_at=excluded.last_seen_at`, subscriptionID, now, ownerID, item.DedupeKey); err != nil {
			return fmt.Errorf("associate article source: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_article_sources WHERE subscription_id=? AND article_id IN (SELECT s.article_id FROM news_article_sources s JOIN news_articles a ON a.id=s.article_id WHERE s.subscription_id=? ORDER BY a.published_at DESC,s.article_id LIMIT -1 OFFSET ?)`, subscriptionID, subscriptionID, retention); err != nil {
		return fmt.Errorf("apply news article retention: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_articles WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM news_article_sources s WHERE s.article_id=news_articles.id) AND NOT EXISTS(SELECT 1 FROM news_saved_list_items i WHERE i.article_id=news_articles.id)`, ownerID); err != nil {
		return fmt.Errorf("clean orphaned articles: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE news_subscriptions SET last_fetched_at=?,fetch_errors='',fetch_error_count=0,updated_at=? WHERE owner_id=? AND id=?`, now, now, ownerID, subscriptionID); err != nil {
		return fmt.Errorf("mark subscription fetch success: %w", err)
	}
	return tx.Commit()
}

func (s *Store) RecordFetchFailure(ctx context.Context, ownerID, subscriptionID, message string) error {
	if strings.TrimSpace(message) == "" {
		message = "feed fetch failed"
	}
	return s.RecordFetchResult(ctx, ownerID, subscriptionID, message)
}

func (s *Store) QueryArticles(ctx context.Context, ownerID, feedID string, offset, limit int) (Page, error) {
	if ownerID == "" {
		return Page{}, fmt.Errorf("%w: owner is required", ErrInvalid)
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	maxItems, err := s.feedMaxItems(ctx, ownerID, feedID)
	if err != nil {
		return Page{}, err
	}
	beyondMaxItems := maxItems > 0 && offset >= maxItems
	if maxItems > 0 && !beyondMaxItems {
		if remaining := maxItems - offset; limit > remaining {
			limit = remaining
		}
	}
	ids, err := s.selectedSubscriptionIDs(ctx, ownerID, feedID)
	if err != nil {
		return Page{}, err
	}
	if len(ids) == 0 {
		return Page{Items: []Article{}, Limit: limit, Offset: offset}, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, 0, len(ids)+1)
	for i, id := range ids {
		placeholders[i] = "?"
		args = append(args, id)
	}
	join := strings.Join(placeholders, ",")
	var total int
	countQuery := `SELECT COUNT(DISTINCT a.id) FROM news_articles a JOIN news_article_sources s ON s.article_id=a.id JOIN news_subscriptions n ON n.id=s.subscription_id WHERE a.owner_id=? AND n.owner_id=? AND s.subscription_id IN (` + join + `)`
	countArgs := append([]any{ownerID, ownerID}, args...)
	if err := s.db.QueryRowContext(ctx, countQuery, countArgs...).Scan(&total); err != nil {
		return Page{}, fmt.Errorf("count news articles: %w", err)
	}
	if maxItems > 0 && total > maxItems {
		total = maxItems
	}
	if beyondMaxItems {
		return Page{Items: []Article{}, Total: total, Limit: limit, Offset: offset}, nil
	}
	query := `SELECT DISTINCT a.id,a.owner_id,a.dedupe_key,a.canonical_url,a.guid,a.title,a.published_at,a.data_json,a.created_at,a.updated_at,COALESCE(u.is_read,0) FROM news_articles a JOIN news_article_sources s ON s.article_id=a.id JOIN news_subscriptions n ON n.id=s.subscription_id LEFT JOIN news_article_user_state u ON u.article_id=a.id AND u.owner_id=? WHERE a.owner_id=? AND n.owner_id=? AND s.subscription_id IN (` + join + `) ORDER BY a.published_at DESC,a.id LIMIT ? OFFSET ?`
	queryArgs := []any{ownerID, ownerID, ownerID}
	queryArgs = append(queryArgs, args...)
	queryArgs = append(queryArgs, limit, offset)
	rows, err := s.db.QueryContext(ctx, query, queryArgs...)
	if err != nil {
		return Page{}, fmt.Errorf("query news articles: %w", err)
	}
	defer rows.Close()
	items := make([]Article, 0)
	for rows.Next() {
		item, err := scanArticle(rows)
		if err != nil {
			return Page{}, err
		}
		item.IsRead, err = s.isRead(ctx, ownerID, item.ID)
		if err != nil {
			return Page{}, err
		}
		item.SourceIDs, err = s.articleSources(ctx, ownerID, item.ID)
		if err != nil {
			return Page{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	return Page{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

func (s *Store) feedMaxItems(ctx context.Context, ownerID, feedID string) (int, error) {
	var maxItems int
	var err error
	if feedID == "" || feedID == "all" {
		err = s.db.QueryRowContext(ctx, `SELECT max_items FROM news_feeds WHERE owner_id=? AND system_key='all'`, ownerID).Scan(&maxItems)
	} else {
		err = s.db.QueryRowContext(ctx, `SELECT max_items FROM news_feeds WHERE owner_id=? AND id=?`, ownerID, feedID).Scan(&maxItems)
	}
	if errors.Is(err, sql.ErrNoRows) {
		if feedID != "" && feedID != "all" {
			return 0, ErrNotFound
		}
		return 200, nil
	}
	return maxItems, err
}

func (s *Store) MarkRead(ctx context.Context, ownerID string, articleIDs []string, read bool) error {
	if ownerID == "" || len(articleIDs) == 0 {
		return fmt.Errorf("%w: owner and article IDs are required", ErrInvalid)
	}
	if len(articleIDs) > 500 {
		return fmt.Errorf("%w: at most 500 articles may be updated", ErrInvalid)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := s.now().Format(time.RFC3339Nano)
	for _, id := range uniqueStrings(articleIDs) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO news_article_user_state(owner_id,article_id,is_read,read_at,updated_at) SELECT ?,a.id,?,?,? FROM news_articles a WHERE a.owner_id=? AND a.id=? AND (EXISTS(SELECT 1 FROM news_article_sources s JOIN news_subscriptions n ON n.id=s.subscription_id WHERE s.article_id=a.id AND n.owner_id=?) OR EXISTS(SELECT 1 FROM news_saved_list_items i WHERE i.article_id=a.id AND i.owner_id=?)) ON CONFLICT(owner_id,article_id) DO UPDATE SET is_read=excluded.is_read,read_at=excluded.read_at,updated_at=excluded.updated_at`, ownerID, boolInt(read), readAt(read, now), now, ownerID, id, ownerID, ownerID); err != nil {
			return fmt.Errorf("update article read state: %w", err)
		}
	}
	return tx.Commit()
}

// MarkReadByURL updates a user's read state for every deduplicated article
// matching the URL; it is useful to adapt the frontend's current URL-based
// article action while resource IDs are introduced.
func (s *Store) MarkReadByURL(ctx context.Context, ownerID, link string, read bool) (int64, error) {
	if ownerID == "" || strings.TrimSpace(link) == "" {
		return 0, fmt.Errorf("%w: owner and article URL are required", ErrInvalid)
	}
	canonical := CanonicalizeURL(link)
	now := s.now().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `INSERT INTO news_article_user_state(owner_id,article_id,is_read,read_at,updated_at) SELECT ?,a.id,?,?,? FROM news_articles a WHERE a.owner_id=? AND a.canonical_url=? AND (EXISTS(SELECT 1 FROM news_article_sources s JOIN news_subscriptions n ON n.id=s.subscription_id WHERE s.article_id=a.id AND n.owner_id=?) OR EXISTS(SELECT 1 FROM news_saved_list_items i WHERE i.article_id=a.id AND i.owner_id=?)) ON CONFLICT(owner_id,article_id) DO UPDATE SET is_read=excluded.is_read,read_at=excluded.read_at,updated_at=excluded.updated_at`, ownerID, boolInt(read), readAt(read, now), now, ownerID, canonical, ownerID, ownerID)
	if err != nil {
		return 0, fmt.Errorf("update article read state: %w", err)
	}
	return result.RowsAffected()
}

func (s *Store) QuerySavedArticles(ctx context.Context, ownerID, listID string) (SavedArticles, error) {
	defaultList, err := s.EnsureDefaultSavedList(ctx, ownerID)
	if err != nil {
		return SavedArticles{}, err
	}
	lists, err := s.ListSavedLists(ctx, ownerID)
	if err != nil {
		return SavedArticles{}, err
	}
	if listID != "" {
		for _, list := range lists {
			if list.ID == listID || strings.EqualFold(list.Name, listID) {
				listID = list.ID
				break
			}
		}
	}
	query := `SELECT DISTINCT a.id,a.owner_id,a.dedupe_key,a.canonical_url,a.guid,a.title,a.published_at,a.data_json,a.created_at,a.updated_at,COALESCE(u.is_read,0) FROM news_articles a JOIN news_saved_list_items i ON i.article_id=a.id LEFT JOIN news_article_user_state u ON u.article_id=a.id AND u.owner_id=? WHERE a.owner_id=? AND i.owner_id=?`
	args := []any{ownerID, ownerID, ownerID}
	if listID != "" {
		query += ` AND i.list_id=?`
		args = append(args, listID)
	}
	query += ` ORDER BY i.created_at DESC,a.id`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return SavedArticles{}, fmt.Errorf("query saved news articles: %w", err)
	}
	defer rows.Close()
	articles := make([]Article, 0)
	for rows.Next() {
		article, err := scanArticle(rows)
		if err != nil {
			return SavedArticles{}, err
		}
		article.SavedLists, err = s.articleLists(ctx, ownerID, article.ID)
		if err != nil {
			return SavedArticles{}, err
		}
		articles = append(articles, article)
	}
	if err := rows.Err(); err != nil {
		return SavedArticles{}, err
	}
	return SavedArticles{Articles: articles, Lists: lists, DefaultList: defaultList.ID}, nil
}

func (s *Store) EnsureDefaultSavedList(ctx context.Context, ownerID string) (SavedList, error) {
	if ownerID == "" {
		return SavedList{}, fmt.Errorf("%w: owner is required", ErrInvalid)
	}
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT l.id FROM news_preferences p JOIN news_saved_lists l ON l.id=p.default_list_id WHERE p.owner_id=? AND l.owner_id=?`, ownerID, ownerID).Scan(&id)
	if err == nil {
		return s.getSavedList(ctx, ownerID, id)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SavedList{}, err
	}
	list, err := s.CreateSavedList(ctx, ownerID, "Read Later")
	if err != nil {
		if !isUnique(err) {
			return SavedList{}, err
		}
		list, err = s.getSavedListByName(ctx, ownerID, "Read Later")
		if err != nil {
			return SavedList{}, err
		}
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO news_preferences(owner_id,default_list_id,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET default_list_id=excluded.default_list_id,updated_at=excluded.updated_at`, ownerID, list.ID, s.now().Format(time.RFC3339Nano))
	if err != nil {
		return SavedList{}, fmt.Errorf("save default news list: %w", err)
	}
	return list, nil
}

func (s *Store) CreateSavedList(ctx context.Context, ownerID, name string) (SavedList, error) {
	ownerID, name = strings.TrimSpace(ownerID), strings.TrimSpace(name)
	if ownerID == "" || name == "" || len(name) > 100 {
		return SavedList{}, fmt.Errorf("%w: saved list name is required", ErrInvalid)
	}
	id, err := randomID()
	if err != nil {
		return SavedList{}, err
	}
	now := s.now().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO news_saved_lists(id,owner_id,name,created_at,updated_at) VALUES(?,?,?,?,?)`, id, ownerID, name, now, now)
	if err != nil {
		return SavedList{}, fmt.Errorf("create saved list: %w", err)
	}
	return SavedList{ID: id, Name: name}, nil
}

func (s *Store) ListSavedLists(ctx context.Context, ownerID string) ([]SavedList, error) {
	if _, err := s.EnsureDefaultSavedList(ctx, ownerID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,name FROM news_saved_lists WHERE owner_id=? ORDER BY name COLLATE NOCASE,id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]SavedList, 0)
	for rows.Next() {
		var item SavedList
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) SaveArticle(ctx context.Context, ownerID string, input ArticleInput, listID string) (Article, error) {
	if ownerID == "" {
		return Article{}, fmt.Errorf("%w: owner is required", ErrInvalid)
	}
	if input.CanonicalURL == "" {
		if link, ok := input.Data["link"].(string); ok {
			input.CanonicalURL = CanonicalizeURL(link)
		}
	}
	if input.CanonicalURL == "" {
		return Article{}, fmt.Errorf("%w: article URL is required", ErrInvalid)
	}
	if input.Title == "" {
		input.Title, _ = input.Data["title"].(string)
	}
	if input.DedupeKey == "" {
		input.DedupeKey = ArticleKey(input.CanonicalURL, input.GUID, input.Title, input.CanonicalURL, input.PublishedAt)
	}
	if input.DedupeKey == "" {
		return Article{}, fmt.Errorf("%w: article identity is required", ErrInvalid)
	}
	if input.Data == nil {
		input.Data = map[string]any{"title": input.Title, "link": input.CanonicalURL}
	}
	defaultList, err := s.EnsureDefaultSavedList(ctx, ownerID)
	if err != nil {
		return Article{}, err
	}
	if listID == "" {
		listID = defaultList.ID
	} else if _, err := s.getSavedList(ctx, ownerID, listID); err != nil {
		list, err := s.getSavedListByName(ctx, ownerID, listID)
		if err != nil {
			return Article{}, ErrNotFound
		}
		listID = list.ID
	}
	encoded, err := json.Marshal(input.Data)
	if err != nil {
		return Article{}, err
	}
	id, err := randomID()
	if err != nil {
		return Article{}, err
	}
	now := s.now().Format(time.RFC3339Nano)
	published := ""
	if input.PublishedAt != nil {
		published = input.PublishedAt.UTC().Format(time.RFC3339Nano)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Article{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `INSERT INTO news_articles(id,owner_id,dedupe_key,canonical_url,guid,title,published_at,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,dedupe_key) DO NOTHING`, id, ownerID, input.DedupeKey, input.CanonicalURL, input.GUID, input.Title, nullable(published), string(encoded), now, now); err != nil {
		return Article{}, fmt.Errorf("save article: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO news_saved_list_items(owner_id,list_id,article_id,created_at) SELECT ?,?,id,? FROM news_articles WHERE owner_id=? AND dedupe_key=? ON CONFLICT(list_id,article_id) DO NOTHING`, ownerID, listID, now, ownerID, input.DedupeKey); err != nil {
		return Article{}, fmt.Errorf("add article to saved list: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Article{}, err
	}
	return s.articleByDedupe(ctx, ownerID, input.DedupeKey)
}

func (s *Store) RemoveSavedArticle(ctx context.Context, ownerID, articleID string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM news_saved_list_items WHERE owner_id=? AND article_id=?`, ownerID, articleID)
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
	_, err = s.db.ExecContext(ctx, `DELETE FROM news_articles WHERE owner_id=? AND id=? AND NOT EXISTS(SELECT 1 FROM news_article_sources WHERE article_id=?) AND NOT EXISTS(SELECT 1 FROM news_saved_list_items WHERE article_id=?)`, ownerID, articleID, articleID, articleID)
	return err
}

func (s *Store) RemoveSavedArticleByURL(ctx context.Context, ownerID, link string) (int64, error) {
	if ownerID == "" || strings.TrimSpace(link) == "" {
		return 0, fmt.Errorf("%w: owner and article URL are required", ErrInvalid)
	}
	canonical := CanonicalizeURL(link)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `DELETE FROM news_saved_list_items WHERE owner_id=? AND article_id IN (SELECT id FROM news_articles WHERE owner_id=? AND canonical_url=?)`, ownerID, ownerID, canonical)
	if err != nil {
		return 0, fmt.Errorf("remove saved article: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_articles WHERE owner_id=? AND canonical_url=? AND NOT EXISTS(SELECT 1 FROM news_article_sources s WHERE s.article_id=news_articles.id) AND NOT EXISTS(SELECT 1 FROM news_saved_list_items i WHERE i.article_id=news_articles.id)`, ownerID, canonical); err != nil {
		return 0, err
	}
	return count, tx.Commit()
}

func (s *Store) DeleteSavedList(ctx context.Context, ownerID, listID string) error {
	list, err := s.getSavedList(ctx, ownerID, listID)
	if errors.Is(err, ErrNotFound) {
		list, err = s.getSavedListByName(ctx, ownerID, listID)
	}
	if err != nil {
		return err
	}
	var defaultID string
	_ = s.db.QueryRowContext(ctx, `SELECT default_list_id FROM news_preferences WHERE owner_id=?`, ownerID).Scan(&defaultID)
	if list.ID == defaultID {
		return fmt.Errorf("%w: default saved list cannot be deleted", ErrInvalid)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_saved_lists WHERE owner_id=? AND id=?`, ownerID, list.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_articles WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM news_article_sources s WHERE s.article_id=news_articles.id) AND NOT EXISTS(SELECT 1 FROM news_saved_list_items i WHERE i.article_id=news_articles.id)`, ownerID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) RenameSavedList(ctx context.Context, ownerID, listID, name string) (SavedList, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return SavedList{}, fmt.Errorf("%w: saved list name is required", ErrInvalid)
	}
	list, err := s.getSavedList(ctx, ownerID, listID)
	if errors.Is(err, ErrNotFound) {
		list, err = s.getSavedListByName(ctx, ownerID, listID)
	}
	if err != nil {
		return SavedList{}, err
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE news_saved_lists SET name=?,updated_at=? WHERE owner_id=? AND id=?`, name, s.now().Format(time.RFC3339Nano), ownerID, list.ID); err != nil {
		if isUnique(err) {
			return SavedList{}, fmt.Errorf("%w: saved list name already exists", ErrInvalid)
		}
		return SavedList{}, err
	}
	return SavedList{ID: list.ID, Name: name}, nil
}

func (s *Store) listFeedRefs(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		items = append(items, id)
	}
	return items, rows.Err()
}

func (s *Store) validateReferences(ctx context.Context, ownerID, feedID string, subscriptions, included, excluded []string) error {
	for _, id := range subscriptions {
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM news_subscriptions WHERE owner_id=? AND id=?`, ownerID, id).Scan(&exists); err != nil {
			return fmt.Errorf("%w: subscription reference is missing or inaccessible", ErrInvalid)
		}
	}
	for _, id := range excluded {
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM news_subscriptions WHERE owner_id=? AND id=?`, ownerID, id).Scan(&exists); err != nil {
			return fmt.Errorf("%w: excluded subscription is missing or inaccessible", ErrInvalid)
		}
	}
	for _, id := range included {
		if id == feedID {
			return fmt.Errorf("%w: feed cannot include itself", ErrInvalid)
		}
		var systemKey string
		if err := s.db.QueryRowContext(ctx, `SELECT system_key FROM news_feeds WHERE owner_id=? AND id=?`, ownerID, id).Scan(&systemKey); err != nil {
			return fmt.Errorf("%w: included feed is missing or inaccessible", ErrInvalid)
		}
		if systemKey == "all" {
			return fmt.Errorf("%w: All feed cannot be nested", ErrInvalid)
		}
	}
	return nil
}

func (s *Store) checkFeedCycle(ctx context.Context, ownerID, feedID string, candidate []string) error {
	feeds, err := s.ListFeeds(ctx, ownerID)
	if err != nil {
		return err
	}
	children := map[string][]string{}
	for _, feed := range feeds {
		children[feed.ID] = feed.IncludedFeedRefs
	}
	children[feedID] = candidate
	visiting, visited := map[string]bool{}, map[string]bool{}
	var visit func(string) bool
	visit = func(id string) bool {
		if visiting[id] {
			return true
		}
		if visited[id] {
			return false
		}
		visiting[id] = true
		for _, child := range children[id] {
			if visit(child) {
				return true
			}
		}
		delete(visiting, id)
		visited[id] = true
		return false
	}
	for id := range children {
		if visit(id) {
			return fmt.Errorf("%w: feed hierarchy cannot contain cycles", ErrInvalid)
		}
	}
	return nil
}

func (s *Store) articleByDedupe(ctx context.Context, ownerID, dedupe string) (Article, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id,owner_id,dedupe_key,canonical_url,guid,title,published_at,data_json,created_at,updated_at,0 FROM news_articles WHERE owner_id=? AND dedupe_key=?`, ownerID, dedupe)
	return scanArticle(row)
}

func (s *Store) isRead(ctx context.Context, ownerID, articleID string) (bool, error) {
	var value int
	err := s.db.QueryRowContext(ctx, `SELECT is_read FROM news_article_user_state WHERE owner_id=? AND article_id=?`, ownerID, articleID).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return value != 0, err
}

func (s *Store) articleSources(ctx context.Context, ownerID, articleID string) ([]string, error) {
	return s.listFeedRefs(ctx, `SELECT s.subscription_id FROM news_article_sources s JOIN news_subscriptions n ON n.id=s.subscription_id WHERE n.owner_id=? AND s.article_id=? ORDER BY s.subscription_id`, ownerID, articleID)
}

func (s *Store) articleLists(ctx context.Context, ownerID, articleID string) ([]string, error) {
	return s.listFeedRefs(ctx, `SELECT list_id FROM news_saved_list_items WHERE owner_id=? AND article_id=? ORDER BY list_id`, ownerID, articleID)
}

func (s *Store) getSavedList(ctx context.Context, ownerID, id string) (SavedList, error) {
	var list SavedList
	err := s.db.QueryRowContext(ctx, `SELECT id,name FROM news_saved_lists WHERE owner_id=? AND id=?`, ownerID, id).Scan(&list.ID, &list.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return SavedList{}, ErrNotFound
	}
	return list, err
}

func (s *Store) getSavedListByName(ctx context.Context, ownerID, name string) (SavedList, error) {
	var list SavedList
	err := s.db.QueryRowContext(ctx, `SELECT id,name FROM news_saved_lists WHERE owner_id=? AND name=? COLLATE NOCASE`, ownerID, name).Scan(&list.ID, &list.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return SavedList{}, ErrNotFound
	}
	return list, err
}

func scanArticle(row rowScanner) (Article, error) {
	var article Article
	var published, data, createdAt, updatedAt string
	var isRead int
	if err := row.Scan(&article.ID, &article.OwnerID, &article.DedupeKey, &article.CanonicalURL, &article.GUID, &article.Title, &published, &data, &createdAt, &updatedAt, &isRead); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Article{}, ErrNotFound
		}
		return Article{}, err
	}
	article.IsRead = isRead != 0
	if err := json.Unmarshal([]byte(data), &article.Data); err != nil {
		return Article{}, fmt.Errorf("decode article JSON: %w", err)
	}
	var err error
	if published != "" {
		parsed, err := parseTime(published)
		if err != nil {
			return Article{}, err
		}
		article.PublishedAt = &parsed
	}
	article.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return Article{}, err
	}
	article.UpdatedAt, err = parseTime(updatedAt)
	return article, err
}

func uniqueStrings(input []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(input))
	for _, value := range input {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func readAt(read bool, value string) any {
	if read {
		return value
	}
	return nil
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
