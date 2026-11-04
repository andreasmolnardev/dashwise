package links

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

type RSSFeed struct {
	ID           string   `json:"id"`
	User         string   `json:"user"`
	Name         string   `json:"name"`
	ListID       string   `json:"listId"`
	TagIDs       []string `json:"tagIds"`
	LinkIDs      []string `json:"linkIds"`
	RequiresAuth bool     `json:"requiresAuth"`
}
type RSSItem struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	Description string    `json:"description"`
	Updated     time.Time `json:"updated"`
}
type RSSInput struct {
	Name, ListID    string
	TagIDs, LinkIDs []string
	RequiresAuth    bool
}

func (s *Store) InitializeRSS(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{ID: "0015_links_rss", Name: "Links RSS feeds", Up: func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS links_rss_feeds(id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,name TEXT NOT NULL,list_id TEXT NOT NULL,tag_ids_json TEXT NOT NULL,link_ids_json TEXT NOT NULL,requires_auth INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`)
		return err
	}}})
}

func (s *Store) ListRSSFeeds(ctx context.Context, owner string) ([]RSSFeed, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,owner_id,name,list_id,tag_ids_json,link_ids_json,requires_auth FROM links_rss_feeds WHERE owner_id=? ORDER BY name COLLATE NOCASE`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RSSFeed{}
	for rows.Next() {
		item, e := scanRSS(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
func (s *Store) GetRSSFeed(ctx context.Context, owner, id string) (RSSFeed, error) {
	item, err := scanRSS(s.db.QueryRowContext(ctx, `SELECT id,owner_id,name,list_id,tag_ids_json,link_ids_json,requires_auth FROM links_rss_feeds WHERE owner_id=? AND id=?`, owner, id))
	if errors.Is(err, sql.ErrNoRows) {
		return RSSFeed{}, ErrNotFound
	}
	return item, err
}
func (s *Store) GetRSSFeedPublic(ctx context.Context, id string) (RSSFeed, error) {
	item, err := scanRSS(s.db.QueryRowContext(ctx, `SELECT id,owner_id,name,list_id,tag_ids_json,link_ids_json,requires_auth FROM links_rss_feeds WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return RSSFeed{}, ErrNotFound
	}
	return item, err
}
func (s *Store) CreateRSSFeed(ctx context.Context, owner string, in RSSInput) (RSSFeed, error) {
	return s.writeRSS(ctx, owner, "", in)
}
func (s *Store) UpdateRSSFeed(ctx context.Context, owner, id string, in RSSInput) (RSSFeed, error) {
	return s.writeRSS(ctx, owner, id, in)
}
func (s *Store) writeRSS(ctx context.Context, owner, id string, in RSSInput) (RSSFeed, error) {
	in.Name = strings.TrimSpace(in.Name)
	if owner == "" || in.Name == "" || len(in.Name) > 200 || in.ListID == "" {
		return RSSFeed{}, ErrInvalid
	}
	if _, err := s.collectionByID(ctx, owner, in.ListID); err != nil {
		return RSSFeed{}, err
	}
	in.TagIDs = uniqueIDs(in.TagIDs)
	in.LinkIDs = uniqueIDs(in.LinkIDs)
	if len(in.TagIDs) == 0 && len(in.LinkIDs) == 0 {
		return RSSFeed{}, ErrInvalid
	}
	for _, tag := range in.TagIDs {
		if _, err := s.tagByID(ctx, owner, tag); err != nil {
			return RSSFeed{}, ErrInvalid
		}
	}
	items, err := s.ListItems(ctx, owner, in.ListID, nil)
	if err != nil {
		return RSSFeed{}, err
	}
	available := map[string]bool{}
	for _, item := range items {
		available[item.ID] = true
	}
	for _, link := range in.LinkIDs {
		if !available[link] {
			return RSSFeed{}, ErrInvalid
		}
	}
	tags, _ := json.Marshal(in.TagIDs)
	links, _ := json.Marshal(in.LinkIDs)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if id == "" {
		id, err = newID()
		if err != nil {
			return RSSFeed{}, err
		}
		_, err = s.db.ExecContext(ctx, `INSERT INTO links_rss_feeds(id,owner_id,name,list_id,tag_ids_json,link_ids_json,requires_auth,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, id, owner, in.Name, in.ListID, string(tags), string(links), boolInt(in.RequiresAuth), now, now)
	} else {
		res, e := s.db.ExecContext(ctx, `UPDATE links_rss_feeds SET name=?,list_id=?,tag_ids_json=?,link_ids_json=?,requires_auth=?,updated_at=? WHERE owner_id=? AND id=?`, in.Name, in.ListID, string(tags), string(links), boolInt(in.RequiresAuth), now, owner, id)
		err = e
		if err == nil {
			n, _ := res.RowsAffected()
			if n == 0 {
				return RSSFeed{}, ErrNotFound
			}
		}
	}
	if err != nil {
		return RSSFeed{}, err
	}
	return s.GetRSSFeed(ctx, owner, id)
}
func (s *Store) DeleteRSSFeed(ctx context.Context, owner, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM links_rss_feeds WHERE owner_id=? AND id=?`, owner, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
func (s *Store) RSSItems(ctx context.Context, feed RSSFeed, resourceStore *resources.Store) ([]RSSItem, error) {
	if resourceStore == nil {
		return nil, errors.New("RSS resource query requires a resource store")
	}
	links := map[string]bool{}
	tags := map[string]bool{}
	for _, id := range feed.LinkIDs {
		links[id] = true
	}
	for _, id := range feed.TagIDs {
		tags[id] = true
	}
	resourcesFound := []resources.Resource{}
	for offset := 0; ; offset += 200 {
		page, err := resourceStore.Query(ctx, resources.Query{
			OwnerID: feed.User, Types: []string{"dashwise.link"},
			Filters: []resources.Filter{{Field: "collectionId", Operator: "eq", Value: feed.ListID}},
			Sort:    []resources.SortField{{Field: "position", Direction: "asc"}, {Field: "title", Direction: "asc"}},
			Limit:   200, Offset: offset,
		})
		if err != nil {
			return nil, err
		}
		resourcesFound = append(resourcesFound, page.Items...)
		if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
			break
		}
	}
	// Links historically order items by position, then case-insensitive title.
	// Keep that ordering when resources have been synchronized from the domain store.
	sort.SliceStable(resourcesFound, func(i, j int) bool {
		left, right := resourcesFound[i], resourcesFound[j]
		lp, _ := numericValue(left.Data["position"])
		rp, _ := numericValue(right.Data["position"])
		if lp != rp {
			return lp < rp
		}
		lt, _ := left.Data["title"].(string)
		rt, _ := right.Data["title"].(string)
		ll, rr := sqliteNoCaseKey(lt), sqliteNoCaseKey(rt)
		if ll != rr {
			return ll < rr
		}
		return left.ProviderResourceID < right.ProviderResourceID
	})
	out := []RSSItem{}
	for _, item := range resourcesFound {
		include := links[item.ProviderResourceID]
		if rawTags, ok := item.Data["tags"].([]any); ok {
			for _, rawTag := range rawTags {
				if tag, ok := rawTag.(string); ok && tags[tag] {
					include = true
					break
				}
			}
		}
		if !include {
			continue
		}
		updated, _ := time.Parse(time.RFC3339Nano, stringValue(item.Data["updatedAt"]))
		url, _ := item.Data["url"].(string)
		title, _ := item.Data["title"].(string)
		description, _ := item.Data["description"].(string)
		out = append(out, RSSItem{ID: item.ProviderResourceID, Title: firstString(title, url, "Link"), URL: url, Description: description, Updated: updated})
	}
	return out, nil
}

func numericValue(value any) (float64, bool) {
	switch value := value.(type) {
	case float64:
		return value, true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	default:
		return 0, false
	}
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func sqliteNoCaseKey(value string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + ('a' - 'A')
		}
		return r
	}, value)
}

type rssScanner interface{ Scan(...any) error }

func scanRSS(row rssScanner) (RSSFeed, error) {
	var f RSSFeed
	var tags, links string
	var required int
	err := row.Scan(&f.ID, &f.User, &f.Name, &f.ListID, &tags, &links, &required)
	if err != nil {
		return f, err
	}
	_ = json.Unmarshal([]byte(tags), &f.TagIDs)
	_ = json.Unmarshal([]byte(links), &f.LinkIDs)
	if f.TagIDs == nil {
		f.TagIDs = []string{}
	}
	if f.LinkIDs == nil {
		f.LinkIDs = []string{}
	}
	f.RequiresAuth = required != 0
	return f, nil
}
func uniqueIDs(items []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item != "" && !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	return out
}
func firstString(items ...string) string {
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			return item
		}
	}
	return ""
}
