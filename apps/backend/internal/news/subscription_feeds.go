package news

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

// SetSubscriptionFeeds replaces the custom feeds containing a subscription.
// The built-in All feed remains implicit and is never stored as a reference.
func (s *Store) SetSubscriptionFeeds(ctx context.Context, ownerID, subscriptionID string, feedIDs, newFeedTitles []string) ([]string, error) {
	if _, err := s.GetSubscription(ctx, ownerID, subscriptionID); err != nil {
		return nil, err
	}
	feeds, err := s.ListFeeds(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]Feed, len(feeds))
	byTitle := make(map[string]Feed, len(feeds))
	for _, feed := range feeds {
		byID[feed.ID] = feed
		if feed.SystemKey == "" {
			byTitle[strings.ToLower(strings.TrimSpace(feed.Title))] = feed
		}
	}
	selected := map[string]struct{}{}
	for _, id := range uniqueStrings(feedIDs) {
		feed, ok := byID[id]
		if ok && feed.SystemKey == "" {
			selected[id] = struct{}{}
		}
	}
	for _, rawTitle := range newFeedTitles {
		title := strings.TrimSpace(rawTitle)
		if title == "" {
			continue
		}
		key := strings.ToLower(title)
		feed, ok := byTitle[key]
		if !ok {
			feed, err = s.CreateFeed(ctx, ownerID, title, "")
			if err != nil {
				return nil, err
			}
			byTitle[key] = feed
		}
		selected[feed.ID] = struct{}{}
	}
	ids := make([]string, 0, len(selected))
	for id := range selected {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM news_feed_subscriptions WHERE owner_id=? AND subscription_id=?`, ownerID, subscriptionID); err != nil {
		return nil, fmt.Errorf("remove subscription feed references: %w", err)
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `INSERT INTO news_feed_subscriptions(owner_id,feed_id,subscription_id) VALUES(?,?,?)`, ownerID, id, subscriptionID); err != nil {
			return nil, fmt.Errorf("add subscription feed reference: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return ids, nil
}
