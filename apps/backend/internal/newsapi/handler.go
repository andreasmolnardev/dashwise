// Package newsapi adapts the News store to Dashwise's existing HTTP routes.
// Fetching, metadata discovery, and topic grouping are injected provider jobs.
package newsapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/news"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

const maxBodyBytes = 1 << 20

type Metadata struct {
	FeedURL                 string   `json:"feedUrl"`
	Title                   string   `json:"title"`
	Icon                    string   `json:"icon"`
	SuggestedBlacklistWords []string `json:"suggestedBlacklistWords,omitempty"`
}

type Options struct {
	// ResolveMetadata normalizes a feed URL and obtains its title, icon, and
	// optional topic grouping suggestions. It may perform outbound HTTP work.
	ResolveMetadata func(context.Context, string) (Metadata, error)
	// Refresh fetches the requested subscription IDs. An empty slice means all
	// of the owner's subscriptions; implementations should preserve old articles
	// when a fetch fails.
	Refresh func(context.Context, string, []string) error
	// ReadItems returns one subscription's latest raw materialized feed cache.
	ReadItems func(context.Context, string, string) (any, error)
	// GroupTopics applies the existing News topic clustering after articles are
	// selected for a feed view.
	GroupTopics func(context.Context, string, string, []any) ([]any, error)
}

type Handler struct {
	store *news.Store
	auth  resourceapi.Authenticate
	opts  Options
	mux   *http.ServeMux
}

func New(store *news.Store, authenticate resourceapi.Authenticate, options Options) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("news API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: authenticate, opts: options, mux: http.NewServeMux()}
	h.registerRoutes()
	return h.mux, nil
}

func (h *Handler) registerRoutes() {
	h.mux.HandleFunc("GET /api/v1/news", h.getNews)
	h.mux.HandleFunc("GET /api/v1/news/subscriptions", h.getSubscriptions)
	h.mux.HandleFunc("GET /api/v1/news/subscriptions/{id}/json", h.getSubscriptionItems)
	h.mux.HandleFunc("GET /api/v1/news/feeds", h.getFeeds)
	h.mux.HandleFunc("GET /api/v1/news/saved-articles", h.getSavedArticles)
	h.mux.HandleFunc("POST /api/v1/news/saved-articles", h.saveArticle)
	h.mux.HandleFunc("DELETE /api/v1/news/saved-articles", h.deleteSavedArticle)
	h.mux.HandleFunc("PATCH /api/v1/news/saved-articles/read", h.markRead)
	h.mux.HandleFunc("DELETE /api/v1/news/saved-article-lists/{id}", h.deleteSavedList)
	h.mux.HandleFunc("PATCH /api/v1/news/saved-article-lists/{id}", h.renameSavedList)
	h.mux.HandleFunc("GET /api/v1/news/feeds/{id}", h.getFeedArticles)
	h.mux.HandleFunc("GET /api/v1/news/feed", h.getFeedArticles)
	h.mux.HandleFunc("GET /api/v1/news/feed-records/{id}", h.getFeedRecord)
	h.mux.HandleFunc("DELETE /api/v1/news/feed-records/{id}", h.deleteFeedRecord)
	h.mux.HandleFunc("POST /api/v1/news/feed-records", h.createFeedRecord)
	h.mux.HandleFunc("POST /api/v1/news/feed-records/{id}", h.updateFeedRecord)
	h.mux.HandleFunc("GET /api/v1/news/feed-metadata", h.getFeedMetadata)
	h.mux.HandleFunc("GET /api/v1/news/feed-refresh", h.refreshFeeds)
	h.mux.HandleFunc("POST /api/v1/news/feed-refresh", h.refreshFeeds)
	h.mux.HandleFunc("POST /api/v1/news/feed-subscribe", h.subscribe)
	h.mux.HandleFunc("POST /api/v1/news/feed-unsubscribe", h.unsubscribe)
	h.mux.HandleFunc("POST /api/v1/news/feed-update", h.updateSubscription)
	h.mux.HandleFunc("POST /api/v1/news/fix-missing-titles", h.fixMissingTitles)
}

func (h *Handler) getNews(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	feeds, err := h.feedSummaries(r.Context(), owner)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	subs, err := h.store.ListSubscriptions(r.Context(), owner)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	short := make([]map[string]string, 0, len(subs))
	for _, sub := range subs {
		short = append(short, map[string]string{"id": sub.ID, "title": first(sub.Title, sub.URL)})
	}
	writeJSON(w, 200, map[string]any{"id": nil, "subscriptions": short, "feeds": feeds})
}

func (h *Handler) getSubscriptions(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	subs, err := h.subscriptionsJSON(r.Context(), owner)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"id": nil, "subscriptions": subs})
}

func (h *Handler) getSubscriptionItems(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if _, err := h.store.GetSubscription(r.Context(), owner, id); err != nil {
		writeStoreError(w, err)
		return
	}
	if h.opts.ReadItems == nil {
		writeError(w, 501, "subscription cache reader is not configured")
		return
	}
	items, err := h.opts.ReadItems(r.Context(), owner, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"id": id, "json": items})
}

func (h *Handler) getFeeds(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	feeds, err := h.feedSummaries(r.Context(), owner)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	subs, err := h.store.ListSubscriptions(r.Context(), owner)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	short := make([]map[string]string, 0, len(subs))
	for _, sub := range subs {
		short = append(short, map[string]string{"id": sub.ID, "title": first(sub.Title, sub.URL)})
	}
	writeJSON(w, 200, map[string]any{"id": nil, "feeds": feeds, "subscriptions": short})
}

func (h *Handler) getSavedArticles(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	result, err := h.store.QuerySavedArticles(r.Context(), owner, r.URL.Query().Get("list"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	articles := make([]map[string]any, 0, len(result.Articles))
	for _, article := range result.Articles {
		articles = append(articles, savedJSON(owner, article))
	}
	writeJSON(w, 200, map[string]any{"articles": articles, "lists": result.Lists, "defaultList": result.DefaultList})
}

func (h *Handler) saveArticle(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Article map[string]any `json:"article"`
		List    string         `json:"list"`
	}
	if !decode(w, r, &body) {
		return
	}
	input, err := parseArticle(body.Article)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	article, err := h.store.SaveArticle(r.Context(), owner, input, body.List)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	saved, err := h.store.QuerySavedArticles(r.Context(), owner, "")
	if err != nil {
		writeStoreError(w, err)
		return
	}
	for _, item := range saved.Articles {
		if item.ID == article.ID {
			article = item
			break
		}
	}
	writeJSON(w, 200, savedJSON(owner, article))
}

func (h *Handler) deleteSavedArticle(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Link string `json:"link"`
	}
	if !decode(w, r, &body) {
		return
	}
	count, err := h.store.RemoveSavedArticleByURL(r.Context(), owner, body.Link)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if count > 0 {
		count = 1
	}
	writeJSON(w, 200, map[string]any{"success": true, "deletedCount": count})
}

func (h *Handler) markRead(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Link   string `json:"link"`
		IsRead *bool  `json:"isRead"`
	}
	if !decode(w, r, &body) {
		return
	}
	read := true
	if body.IsRead != nil {
		read = *body.IsRead
	}
	count, err := h.store.MarkReadByURL(r.Context(), owner, body.Link, read)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "updatedCount": count})
}

func (h *Handler) deleteSavedList(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	listID := r.PathValue("id")
	saved, err := h.store.QuerySavedArticles(r.Context(), owner, listID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := h.store.DeleteSavedList(r.Context(), owner, listID); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "deletedArticles": len(saved.Articles)})
}

func (h *Handler) renameSavedList(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	list, err := h.store.RenameSavedList(r.Context(), owner, r.PathValue("id"), body.Name)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, list)
}

func (h *Handler) getFeedArticles(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		id = r.URL.Query().Get("feedId")
	}
	if id == "" {
		id = "all"
	}
	limit := intParam(r.URL.Query().Get("limit"), 50, 1, 100)
	offset := intParam(r.URL.Query().Get("offset"), 0, 0, 1_000_000)
	page, err := h.store.QueryArticles(r.Context(), owner, id, offset, limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	items, err := h.articleItems(r.Context(), owner, page.Items, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": page.Total, "limit": page.Limit})
}

func (h *Handler) getFeedRecord(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	feed, err := h.resolveFeed(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	page, err := h.store.QueryArticles(r.Context(), owner, feed.ID, 0, min(feed.MaxItems, 100))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	items, err := h.articleItems(r.Context(), owner, page.Items, feed.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, feedJSON(feed, items))
}

func (h *Handler) deleteFeedRecord(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	feed, err := h.resolveFeed(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := h.store.DeleteFeed(r.Context(), owner, feed.ID); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"id": feed.ID})
}

func (h *Handler) createFeedRecord(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Title    string   `json:"title"`
		Icon     string   `json:"icon"`
		Included []string `json:"includedFeedRefs"`
	}
	if !decode(w, r, &body) {
		return
	}
	if strings.EqualFold(strings.TrimSpace(body.Title), "all feed") {
		feed, err := h.store.EnsureAllFeed(r.Context(), owner)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, 200, feedJSON(feed, []any{}))
		return
	}
	feeds, err := h.store.ListFeeds(r.Context(), owner)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	for _, existing := range feeds {
		if existing.SystemKey == "" && strings.EqualFold(strings.TrimSpace(existing.Title), strings.TrimSpace(body.Title)) {
			writeJSON(w, 200, feedJSON(existing, []any{}))
			return
		}
	}
	feed, err := h.store.CreateFeed(r.Context(), owner, body.Title, body.Icon)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if len(body.Included) > 0 {
		feed, err = h.store.UpdateFeed(r.Context(), owner, feed.ID, feed.Title, feed.Icon, nil, body.Included, nil, feed.MaxItems)
		if err != nil {
			writeStoreError(w, err)
			return
		}
	}
	writeJSON(w, 200, feedJSON(feed, []any{}))
}

func (h *Handler) updateFeedRecord(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		FeedID                   string   `json:"feedId"`
		FeedType                 string   `json:"feedType"`
		SystemKey                string   `json:"systemKey"`
		Title                    *string  `json:"title"`
		Icon                     *string  `json:"icon"`
		SubscriptionRefs         []string `json:"subscriptionRefs"`
		IncludedFeedRefs         []string `json:"includedFeedRefs"`
		ExcludedSubscriptionRefs []string `json:"excludedSubscriptionRefs"`
		MaxFeedItems             *int     `json:"maxFeedItems"`
	}
	if !decode(w, r, &body) {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		id = body.FeedID
	}
	feed, err := h.resolveFeed(r.Context(), owner, id)
	if err != nil && id == "all" {
		feed, err = h.store.EnsureAllFeed(r.Context(), owner)
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	title, icon := feed.Title, feed.Icon
	if body.Title != nil {
		title = *body.Title
	}
	if body.Icon != nil {
		icon = *body.Icon
	}
	refs, included, excluded := feed.SubscriptionRefs, feed.IncludedFeedRefs, feed.ExcludedSubscriptionRefs
	if body.SubscriptionRefs != nil {
		refs = body.SubscriptionRefs
	}
	if body.IncludedFeedRefs != nil {
		included = body.IncludedFeedRefs
	}
	if body.ExcludedSubscriptionRefs != nil {
		excluded = body.ExcludedSubscriptionRefs
	}
	maxItems := feed.MaxItems
	if body.MaxFeedItems != nil {
		maxItems = *body.MaxFeedItems
	}
	feed, err = h.store.UpdateFeed(r.Context(), owner, feed.ID, title, icon, refs, included, excluded, maxItems)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, feedJSON(feed, []any{}))
}

func (h *Handler) getFeedMetadata(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.owner(w, r); !ok {
		return
	}
	feedURL, err := normalizeURL(r.URL.Query().Get("url"))
	if err != nil {
		writeError(w, 400, "invalid feed URL")
		return
	}
	if feedURL == "" {
		writeJSON(w, 200, Metadata{})
		return
	}
	if h.opts.ResolveMetadata != nil {
		metadata, err := h.opts.ResolveMetadata(r.Context(), feedURL)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		metadata.FeedURL = feedURL
		writeJSON(w, 200, metadata)
		return
	}
	u, _ := url.Parse(feedURL)
	writeJSON(w, 200, Metadata{FeedURL: feedURL, Icon: u.Scheme + "://" + u.Host + "/favicon.ico"})
}

func (h *Handler) refreshFeeds(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	ids := requestedIDs(r.URL.Query())
	if r.Method == http.MethodPost {
		var body struct {
			Auth    map[string]any `json:"auth"`
			FeedIDs []string       `json:"feedIds"`
			FeedID  string         `json:"feedId"`
		}
		if !decode(w, r, &body) {
			return
		}
		if body.FeedIDs != nil {
			ids = unique(body.FeedIDs)
		} else if body.FeedID != "" {
			ids = []string{body.FeedID}
		}
	}
	if h.opts.Refresh == nil {
		writeError(w, 501, "news refresh worker is not configured")
		return
	}
	if err := h.opts.Refresh(r.Context(), owner, ids); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"message": "Internal refresh triggered"})
}

func (h *Handler) subscribe(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body subscribeRequest
	if !decode(w, r, &body) {
		return
	}
	feedURL, err := normalizeURL(first(body.Sub.FeedURL, body.Sub.URL))
	if err != nil || feedURL == "" {
		writeError(w, 400, "feed URL is required and must be valid")
		return
	}
	title, icon := first(body.Sub.Name, body.Sub.Title), strings.TrimSpace(body.Sub.Icon)
	if h.opts.ResolveMetadata != nil && (title == "" || icon == "") {
		if metadata, resolveErr := h.opts.ResolveMetadata(r.Context(), feedURL); resolveErr == nil {
			if title == "" {
				title = strings.TrimSpace(metadata.Title)
			}
			if icon == "" {
				icon = strings.TrimSpace(metadata.Icon)
			}
		}
	}
	settings := map[string]any{
		"linkReplaceRule":                   body.Sub.LinkReplaceRule,
		"fallbackThumbnailUrl":              body.Sub.FallbackThumbnailURL,
		"thumbnailOverwriteUrl":             body.Sub.ThumbnailOverwriteURL,
		"similarityGroupingWordsBlacklist":  body.Sub.SimilarityGroupingWordsBlacklist,
		"enableTopicGrouping":               boolValue(body.Sub.EnableTopicGrouping, true),
		"ignoreDescriptionForTopicGrouping": boolValue(body.Sub.IgnoreDescriptionForTopicGrouping, false),
	}
	input := news.SubscriptionInput{URL: feedURL, Title: title, Icon: icon, Settings: settings}
	sub, err := h.findSubscriptionURL(r.Context(), owner, feedURL)
	if errors.Is(err, news.ErrNotFound) {
		sub, err = h.store.CreateSubscription(r.Context(), owner, input)
	} else if err == nil {
		sub, err = h.store.UpdateSubscription(r.Context(), owner, sub.ID, input)
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if _, err := h.store.SetSubscriptionFeeds(r.Context(), owner, sub.ID, body.Sub.FeedIDs, body.Sub.NewFeedTitles); err != nil {
		writeStoreError(w, err)
		return
	}
	if h.opts.Refresh != nil {
		if err := h.opts.Refresh(r.Context(), owner, []string{sub.ID}); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	response := map[string]any{"message": "Feed successfully subscribed.", "subscriptionId": sub.ID}
	if body.View != nil {
		if view, err := h.feedView(r.Context(), owner, *body.View); err == nil {
			response["feedView"] = view
		}
	}
	writeJSON(w, 200, response)
}

func (h *Handler) unsubscribe(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Auth    map[string]any `json:"auth"`
		FeedURL string         `json:"feedUrl"`
	}
	if !decode(w, r, &body) {
		return
	}
	sub, err := h.findSubscriptionURL(r.Context(), owner, body.FeedURL)
	if errors.Is(err, news.ErrNotFound) {
		writeJSON(w, 200, map[string]string{"message": "Subscription removed."})
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := h.store.DeleteSubscription(r.Context(), owner, sub.ID); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"message": "Subscription removed."})
}

func (h *Handler) updateSubscription(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body updateRequest
	if !decode(w, r, &body) {
		return
	}
	oldURL := first(body.Payload.OldFeedURL, body.Payload.FeedURL, body.Payload.URL)
	sub, err := h.findSubscription(r.Context(), owner, first(body.Payload.SubscriptionID, body.Payload.ID), oldURL)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	feedURL, err := normalizeURL(first(body.Payload.FeedURL, body.Payload.URL, sub.URL))
	if err != nil {
		writeError(w, 400, "feed URL is invalid")
		return
	}
	settings := decodeSettings(sub.Settings)
	settings["linkReplaceRule"] = body.Payload.LinkReplaceRule
	settings["fallbackThumbnailUrl"] = body.Payload.FallbackThumbnailURL
	settings["thumbnailOverwriteUrl"] = body.Payload.ThumbnailOverwriteURL
	settings["similarityGroupingWordsBlacklist"] = body.Payload.SimilarityGroupingWordsBlacklist
	settings["enableTopicGrouping"] = boolValue(body.Payload.EnableTopicGrouping, true)
	settings["ignoreDescriptionForTopicGrouping"] = boolValue(body.Payload.IgnoreDescriptionForTopicGrouping, false)
	sub, err = h.store.UpdateSubscription(r.Context(), owner, sub.ID, news.SubscriptionInput{URL: feedURL, Title: first(body.Payload.Title, body.Payload.Name, sub.Title), Icon: first(body.Payload.Icon, sub.Icon), Settings: settings})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if body.Payload.FeedIDs != nil || body.Payload.NewFeedTitles != nil {
		if _, err := h.store.SetSubscriptionFeeds(r.Context(), owner, sub.ID, body.Payload.FeedIDs, body.Payload.NewFeedTitles); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	if h.opts.Refresh != nil {
		if err := h.opts.Refresh(r.Context(), owner, []string{sub.ID}); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	response := map[string]any{"message": "Feed successfully updated.", "subscriptionId": sub.ID}
	if body.View != nil {
		if view, err := h.feedView(r.Context(), owner, *body.View); err == nil {
			response["feedView"] = view
		}
	}
	writeJSON(w, 200, response)
}

func (h *Handler) fixMissingTitles(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if h.opts.ResolveMetadata == nil {
		writeError(w, 501, "news metadata resolver is not configured")
		return
	}
	subs, err := h.store.ListSubscriptions(r.Context(), owner)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	updated := 0
	for _, sub := range subs {
		if strings.TrimSpace(sub.Title) != "" && sub.Title != sub.URL {
			continue
		}
		metadata, err := h.opts.ResolveMetadata(r.Context(), sub.URL)
		if err != nil || strings.TrimSpace(metadata.Title) == "" {
			continue
		}
		if _, err := h.store.UpdateSubscription(r.Context(), owner, sub.ID, news.SubscriptionInput{URL: sub.URL, Title: metadata.Title, Icon: first(metadata.Icon, sub.Icon), Settings: decodeSettings(sub.Settings)}); err == nil {
			updated++
		}
	}
	writeJSON(w, 200, map[string]any{"success": true, "updatedCount": updated})
}

func (h *Handler) subscriptionsJSON(ctx context.Context, owner string) ([]map[string]any, error) {
	subs, err := h.store.ListSubscriptions(ctx, owner)
	if err != nil {
		return nil, err
	}
	feeds, err := h.store.ListFeeds(ctx, owner)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(subs))
	for _, sub := range subs {
		settings := decodeSettings(sub.Settings)
		feedIDs := []string{}
		for _, feed := range feeds {
			if feed.SystemKey == "" && contains(feed.SubscriptionRefs, sub.ID) {
				feedIDs = append(feedIDs, feed.ID)
			}
		}
		sort.Strings(feedIDs)
		result = append(result, map[string]any{
			"id": sub.ID, "url": sub.URL, "feedUrl": sub.URL,
			"title": sub.Title, "name": sub.Title, "icon": sub.Icon,
			"feedIds":                           feedIDs,
			"linkReplaceRule":                   settings["linkReplaceRule"],
			"fallbackThumbnailUrl":              settings["fallbackThumbnailUrl"],
			"thumbnailOverwriteUrl":             settings["thumbnailOverwriteUrl"],
			"similarityGroupingWordsBlacklist":  settings["similarityGroupingWordsBlacklist"],
			"enableTopicGrouping":               boolValueFrom(settings["enableTopicGrouping"], true),
			"ignoreDescriptionForTopicGrouping": boolValueFrom(settings["ignoreDescriptionForTopicGrouping"], false),
			"fetchErrors":                       sub.FetchErrors, "fetchErrorCount": sub.FetchErrorCount,
		})
	}
	return result, nil
}

func (h *Handler) feedSummaries(ctx context.Context, owner string) ([]map[string]any, error) {
	feeds, err := h.store.ListFeeds(ctx, owner)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(feeds))
	for _, feed := range feeds {
		if feed.SystemKey == "all" {
			result = append(result, map[string]any{"id": "all", "title": feed.Title, "icon": feed.Icon})
		}
	}
	for _, feed := range feeds {
		if feed.SystemKey == "" {
			result = append(result, map[string]any{"id": feed.ID, "title": feed.Title, "icon": feed.Icon, "includedFeedRefs": feed.IncludedFeedRefs})
		}
	}
	return result, nil
}

func (h *Handler) articleItems(ctx context.Context, owner string, articles []news.Article, feedID string) ([]any, error) {
	result := make([]any, 0, len(articles))
	for _, article := range articles {
		item := clone(article.Data)
		item["dedupeKey"] = article.DedupeKey
		if article.Title != "" {
			item["title"] = article.Title
		}
		if article.CanonicalURL != "" {
			item["link"] = article.CanonicalURL
		}
		if article.PublishedAt != nil && item["pubDate"] == nil {
			item["pubDate"] = article.PublishedAt.UTC().Format(time.RFC3339Nano)
		}
		sources := make([]map[string]string, 0, len(article.SourceIDs))
		for _, sourceID := range article.SourceIDs {
			sub, err := h.store.GetSubscription(ctx, owner, sourceID)
			if errors.Is(err, news.ErrNotFound) {
				continue
			}
			if err != nil {
				return nil, err
			}
			sources = append(sources, map[string]string{"id": sub.ID, "title": first(sub.Title, sub.URL, "Subscription")})
		}
		if len(sources) > 0 {
			item["sourceSubscriptions"] = sources
			if item["subscription_id"] == nil {
				item["subscription_id"] = sources[0]["id"]
			}
			if item["subscription_name"] == nil {
				item["subscription_name"] = sources[0]["title"]
			}
		}
		result = append(result, item)
	}
	if h.opts.GroupTopics != nil {
		return h.opts.GroupTopics(ctx, owner, feedID, result)
	}
	return result, nil
}

func (h *Handler) feedView(ctx context.Context, owner string, request viewRequest) (map[string]any, error) {
	id := strings.TrimSpace(request.FeedID)
	if id == "" {
		id = "all"
	}
	limit := request.Limit
	if limit <= 0 || limit > 100 {
		limit = 15
	}
	offset := request.Offset
	if offset < 0 || offset > 1_000_000 {
		offset = 0
	}
	page, err := h.store.QueryArticles(ctx, owner, id, offset, limit)
	if err != nil {
		return nil, err
	}
	items, err := h.articleItems(ctx, owner, page.Items, id)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": page.Total, "limit": page.Limit}, nil
}

func (h *Handler) resolveFeed(ctx context.Context, owner, id string) (news.Feed, error) {
	if id != "all" {
		return h.store.GetFeed(ctx, owner, id)
	}
	feeds, err := h.store.ListFeeds(ctx, owner)
	if err != nil {
		return news.Feed{}, err
	}
	for _, feed := range feeds {
		if feed.SystemKey == "all" {
			return feed, nil
		}
	}
	return h.store.EnsureAllFeed(ctx, owner)
}

func (h *Handler) findSubscription(ctx context.Context, owner, id, feedURL string) (news.Subscription, error) {
	if id != "" {
		return h.store.GetSubscription(ctx, owner, id)
	}
	return h.findSubscriptionURL(ctx, owner, feedURL)
}

func (h *Handler) findSubscriptionURL(ctx context.Context, owner, feedURL string) (news.Subscription, error) {
	feedURL = strings.TrimSpace(feedURL)
	if feedURL == "" {
		return news.Subscription{}, news.ErrNotFound
	}
	subs, err := h.store.ListSubscriptions(ctx, owner)
	if err != nil {
		return news.Subscription{}, err
	}
	for _, sub := range subs {
		if sub.ID == feedURL {
			return sub, nil
		}
	}
	normalized, err := normalizeURL(feedURL)
	if err != nil {
		return news.Subscription{}, err
	}
	for _, sub := range subs {
		if sub.URL == normalized || sub.URL == feedURL {
			return sub, nil
		}
	}
	return news.Subscription{}, news.ErrNotFound
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		writeError(w, 401, "authentication required")
		return "", false
	}
	return owner, true
}

func feedJSON(feed news.Feed, items []any) map[string]any {
	id := feed.ID
	if feed.SystemKey == "all" {
		id = "all"
	}
	return map[string]any{"id": id, "title": feed.Title, "icon": feed.Icon, "feedType": feed.Type, "systemKey": feed.SystemKey,
		"subscriptionRefs": feed.SubscriptionRefs, "includedFeedRefs": feed.IncludedFeedRefs,
		"excludedSubscriptionRefs": feed.ExcludedSubscriptionRefs, "maxFeedItems": feed.MaxItems, "feedCache": items}
}

func savedJSON(owner string, article news.Article) map[string]any {
	return map[string]any{"id": article.ID, "list": article.SavedLists, "isRead": article.IsRead,
		"json": article.Data, "userId": owner, "created": article.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated": article.UpdatedAt.UTC().Format(time.RFC3339Nano)}
}

func parseArticle(data map[string]any) (news.ArticleInput, error) {
	if data == nil {
		return news.ArticleInput{}, errors.New("article is required")
	}
	input := news.ArticleInput{Data: data}
	input.Title, _ = data["title"].(string)
	input.CanonicalURL, _ = data["link"].(string)
	input.GUID, _ = data["guid"].(string)
	input.DedupeKey, _ = data["dedupeKey"].(string)
	for _, field := range []string{"pubDate", "isoDate", "publishedAt"} {
		if raw, ok := data[field].(string); ok && raw != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
				input.PublishedAt = &parsed
				break
			}
		}
	}
	if strings.TrimSpace(input.CanonicalURL) == "" {
		return news.ArticleInput{}, errors.New("article link is required")
	}
	return input, nil
}

func decodeSettings(value json.RawMessage) map[string]any {
	result := map[string]any{}
	if len(value) > 0 {
		_ = json.Unmarshal(value, &result)
	}
	return result
}

func requestedIDs(values url.Values) []string {
	inputs := append([]string{}, values["feedIds"]...)
	inputs = append(inputs, values["feedId"]...)
	result := []string{}
	for _, input := range inputs {
		for _, id := range strings.Split(input, ",") {
			if id = strings.TrimSpace(id); id != "" {
				result = append(result, id)
			}
		}
	}
	return unique(result)
}

func normalizeURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	u, err := url.ParseRequestURI(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("feed URL must be HTTP or HTTPS")
	}
	if strings.Contains(strings.ToLower(u.Host), "reddit.com") && strings.Contains(u.Path, "/r/") && !strings.HasSuffix(strings.TrimRight(u.Path, "/"), ".rss") {
		u.Path = strings.TrimRight(u.Path, "/") + ".rss"
	}
	return u.String(), nil
}

func intParam(value string, fallback, minValue, maxValue int) int {
	if value == "" {
		return fallback
	}
	var parsed int
	if _, err := fmt.Sscan(value, &parsed); err != nil || parsed < minValue {
		return fallback
	}
	if parsed > maxValue {
		return maxValue
	}
	return parsed
}

func boolValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}
func boolValueFrom(value any, fallback bool) bool {
	result, ok := value.(bool)
	if !ok {
		return fallback
	}
	return result
}

func first(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func clone(source map[string]any) map[string]any {
	result := make(map[string]any, len(source)+6)
	for key, value := range source {
		result[key] = value
	}
	return result
}
func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func unique(values []string) []string {
	seen := map[string]struct{}{}
	result := []string{}
	for _, value := range values {
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
	sort.Strings(result)
	return result
}

func decode(w http.ResponseWriter, r *http.Request, destination any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(w, 400, "invalid JSON request body")
		return false
	}
	var trailing any
	if !errors.Is(decoder.Decode(&trailing), io.EOF) {
		writeError(w, 400, "request body must contain one JSON value")
		return false
	}
	return true
}

func writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, news.ErrNotFound) {
		writeError(w, 404, "news record not found")
		return
	}
	if errors.Is(err, news.ErrInvalid) {
		writeError(w, 400, err.Error())
		return
	}
	writeError(w, 500, "news request failed")
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

type viewRequest struct {
	FeedID string `json:"feedId"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}
type subscriptionInput struct {
	FeedURL                           string            `json:"feedUrl"`
	URL                               string            `json:"url"`
	Name                              string            `json:"name"`
	Title                             string            `json:"title"`
	Icon                              string            `json:"icon"`
	FeedIDs                           []string          `json:"feedIds"`
	NewFeedTitles                     []string          `json:"newFeedTitles"`
	LinkReplaceRule                   map[string]string `json:"linkReplaceRule"`
	FallbackThumbnailURL              string            `json:"fallbackThumbnailUrl"`
	ThumbnailOverwriteURL             string            `json:"thumbnailOverwriteUrl"`
	SimilarityGroupingWordsBlacklist  string            `json:"similarityGroupingWordsBlacklist"`
	EnableTopicGrouping               *bool             `json:"enableTopicGrouping"`
	IgnoreDescriptionForTopicGrouping *bool             `json:"ignoreDescriptionForTopicGrouping"`
	ID                                string            `json:"id"`
	FetchErrors                       string            `json:"fetchErrors"`
	JSON                              json.RawMessage   `json:"json"`
}
type subscribeRequest struct {
	Auth map[string]any    `json:"auth"`
	Sub  subscriptionInput `json:"sub"`
	View *viewRequest      `json:"view"`
}
type updateRequest struct {
	Auth    map[string]any `json:"auth"`
	Payload struct {
		SubscriptionID                    string            `json:"subscriptionId"`
		ID                                string            `json:"id"`
		OldFeedURL                        string            `json:"oldFeedUrl"`
		FeedURL                           string            `json:"feedUrl"`
		URL                               string            `json:"url"`
		Title                             string            `json:"title"`
		Name                              string            `json:"name"`
		Icon                              string            `json:"icon"`
		FeedIDs                           []string          `json:"feedIds"`
		NewFeedTitles                     []string          `json:"newFeedTitles"`
		LinkReplaceRule                   map[string]string `json:"linkReplaceRule"`
		FallbackThumbnailURL              string            `json:"fallbackThumbnailUrl"`
		ThumbnailOverwriteURL             string            `json:"thumbnailOverwriteUrl"`
		SimilarityGroupingWordsBlacklist  string            `json:"similarityGroupingWordsBlacklist"`
		EnableTopicGrouping               *bool             `json:"enableTopicGrouping"`
		IgnoreDescriptionForTopicGrouping *bool             `json:"ignoreDescriptionForTopicGrouping"`
		FetchErrors                       string            `json:"fetchErrors"`
		FetchErrorCount                   int               `json:"fetchErrorCount"`
		JSON                              json.RawMessage   `json:"json"`
	} `json:"payload"`
	View *viewRequest `json:"view"`
}
