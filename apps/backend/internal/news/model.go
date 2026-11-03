// Package news stores feed subscriptions, materialized articles, saved lists,
// and per-user reading state. Network fetching and presentation remain at the
// provider/view layer.
package news

import (
	"encoding/json"
	"time"
)

type Subscription struct {
	ID              string          `json:"id"`
	OwnerID         string          `json:"ownerId"`
	URL             string          `json:"url"`
	Title           string          `json:"title"`
	Icon            string          `json:"icon,omitempty"`
	Settings        json.RawMessage `json:"settings,omitempty"`
	FetchErrors     string          `json:"fetchErrors,omitempty"`
	FetchErrorCount int             `json:"fetchErrorCount"`
	LastFetchedAt   *time.Time      `json:"lastFetchedAt,omitempty"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

type Feed struct {
	ID                       string    `json:"id"`
	OwnerID                  string    `json:"ownerId"`
	Title                    string    `json:"title"`
	Icon                     string    `json:"icon,omitempty"`
	Type                     string    `json:"feedType"`
	SystemKey                string    `json:"systemKey,omitempty"`
	SubscriptionRefs         []string  `json:"subscriptionRefs"`
	IncludedFeedRefs         []string  `json:"includedFeedRefs"`
	ExcludedSubscriptionRefs []string  `json:"excludedSubscriptionRefs"`
	MaxItems                 int       `json:"maxFeedItems"`
	CreatedAt                time.Time `json:"createdAt"`
	UpdatedAt                time.Time `json:"updatedAt"`
}

type Article struct {
	ID           string         `json:"id"`
	OwnerID      string         `json:"ownerId,omitempty"`
	DedupeKey    string         `json:"dedupeKey"`
	CanonicalURL string         `json:"canonicalUrl,omitempty"`
	GUID         string         `json:"guid,omitempty"`
	Title        string         `json:"title"`
	PublishedAt  *time.Time     `json:"publishedAt,omitempty"`
	Data         map[string]any `json:"data"`
	SourceIDs    []string       `json:"sourceIds,omitempty"`
	IsRead       bool           `json:"isRead,omitempty"`
	SavedLists   []string       `json:"list,omitempty"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
}

type Page struct {
	Items  []Article `json:"items"`
	Total  int       `json:"total"`
	Limit  int       `json:"limit"`
	Offset int       `json:"offset"`
}

type SavedList struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type SavedArticles struct {
	Articles    []Article   `json:"articles"`
	Lists       []SavedList `json:"lists"`
	DefaultList string      `json:"defaultList"`
}

type SubscriptionInput struct {
	URL      string
	Title    string
	Icon     string
	Settings map[string]any
}

type ArticleInput struct {
	DedupeKey    string
	CanonicalURL string
	GUID         string
	Title        string
	PublishedAt  *time.Time
	Data         map[string]any
}
