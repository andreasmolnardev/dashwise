package news

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

const maxFeedResponseBytes = 5 << 20

var (
	tagPattern   = regexp.MustCompile(`(?is)<(script|style)\b[^>]*>.*?</\1\s*>|<[^>]+>`)
	spacePattern = regexp.MustCompile(`\s+`)
)

type Fetcher struct {
	Client    *http.Client
	MaxItems  int
	Retention int
}

type RefreshResult struct {
	Fetched int              `json:"fetched"`
	Failed  int              `json:"failed"`
	Details []map[string]any `json:"details"`
}

func NewFetcher() *Fetcher {
	transport := &http.Transport{Proxy: nil, DialContext: publicDialContext, ForceAttemptHTTP2: true, ResponseHeaderTimeout: 8 * time.Second, TLSHandshakeTimeout: 8 * time.Second}
	client := &http.Client{Transport: transport, Timeout: 15 * time.Second}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("feed redirected too many times")
		}
		if err := validatePublicURL(req.Context(), req.URL.String()); err != nil {
			return err
		}
		return nil
	}
	return &Fetcher{Client: client, MaxItems: 1000, Retention: 1000}
}

func (f *Fetcher) Fetch(ctx context.Context, feedURL string, settings map[string]any, sourceName string) ([]ArticleInput, error) {
	if f == nil || f.Client == nil {
		return nil, errors.New("news fetcher is not configured")
	}
	if err := validatePublicURL(ctx, feedURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Dashwise/2 News Feed Reader")
	req.Header.Set("Accept", "application/atom+xml, application/rss+xml, application/xml, text/xml, */*;q=0.5")
	resp, err := f.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch feed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("feed returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFeedResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read feed: %w", err)
	}
	if len(body) > maxFeedResponseBytes {
		return nil, errors.New("feed response exceeds 5 MB")
	}
	parsed, err := parseFeed(body)
	if err != nil {
		return nil, err
	}
	linkRules := stringMap(settings["linkReplaceRule"])
	thumbnailOverride, _ := settings["thumbnailOverwriteUrl"].(string)
	fallbackThumbnail, _ := settings["fallbackThumbnailUrl"].(string)
	for i := range parsed.Items {
		item := &parsed.Items[i]
		link, _ := item.Data["link"].(string)
		for from, to := range linkRules {
			if from != "" {
				if re, e := regexp.Compile(from); e == nil {
					link = re.ReplaceAllString(link, to)
				}
			}
		}
		item.Data["link"] = link
		item.Data["subscription_name"] = sourceName
		item.Data["subscription_id"] = ""
		thumbnail, _ := item.Data["thumbnailUrl"].(string)
		if thumbnailOverride != "" {
			item.Data["thumbnailUrl"] = thumbnailOverride
		} else if thumbnail == "" {
			item.Data["thumbnailUrl"] = fallbackThumbnail
		}
	}
	items := parsed.Items
	if f.MaxItems > 0 && len(items) > f.MaxItems {
		items = items[:f.MaxItems]
	}
	return items, nil
}

func (f *Fetcher) Metadata(ctx context.Context, feedURL string) (string, string, error) {
	parsed, err := f.fetchDocument(ctx, feedURL)
	if err != nil {
		return "", "", err
	}
	icon := parsed.Image
	if icon != "" {
		icon = resolveURL(feedURL, icon)
	}
	return parsed.Title, icon, nil
}

func (f *Fetcher) fetchDocument(ctx context.Context, feedURL string) (parsedFeed, error) {
	if err := validatePublicURL(ctx, feedURL); err != nil {
		return parsedFeed{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return parsedFeed{}, err
	}
	req.Header.Set("User-Agent", "Dashwise/2 News Feed Reader")
	resp, err := f.Client.Do(req)
	if err != nil {
		return parsedFeed{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return parsedFeed{}, fmt.Errorf("feed returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFeedResponseBytes+1))
	if err != nil {
		return parsedFeed{}, err
	}
	if len(body) > maxFeedResponseBytes {
		return parsedFeed{}, errors.New("feed response exceeds 5 MB")
	}
	return parseFeed(body)
}

func parseFeed(body []byte) (parsedFeed, error) {
	var rss rssDocument
	if err := xml.Unmarshal(body, &rss); err == nil && len(rss.Channel.Items) > 0 {
		result := parsedFeed{Title: cleanText(rss.Channel.Title), Image: firstNonempty(rss.Channel.Image.URL, rss.Channel.Image.Link)}
		for _, raw := range rss.Channel.Items {
			published := parseFeedTime(firstNonempty(raw.PubDate, raw.Date))
			link := strings.TrimSpace(raw.Link)
			if link == "" {
				link = raw.GUID.Value
			}
			data := map[string]any{"title": firstNonempty(cleanText(raw.Title), "No Title"), "link": link, "guid": raw.GUID.Value, "pubDate": publishedText(published), "description": truncateSentences(cleanText(raw.Description), 5), "content": firstNonempty(raw.Content, raw.Description, raw.MediaEncoded), "author": firstNonempty(raw.Author, raw.Creator), "source": cleanText(rss.Channel.Title)}
			for _, category := range raw.Categories {
				if category != "" {
					if _, ok := data["categories"]; !ok {
						data["categories"] = []string{}
					}
					data["categories"] = append(data["categories"].([]string), cleanText(category))
				}
			}
			thumb := firstNonempty(raw.Thumbnail.URL, raw.Enclosure.URL)
			if thumb != "" {
				data["thumbnailUrl"] = thumb
			}
			if link != "" && published != nil {
				result.Items = append(result.Items, ArticleInput{CanonicalURL: CanonicalizeURL(link), GUID: raw.GUID.Value, Title: data["title"].(string), PublishedAt: published, Data: data})
			}
		}
		sortArticles(result.Items)
		return result, nil
	}
	var atom atomDocument
	if err := xml.Unmarshal(body, &atom); err != nil {
		return parsedFeed{}, fmt.Errorf("parse RSS/Atom feed: %w", err)
	}
	if len(atom.Entries) == 0 {
		return parsedFeed{}, errors.New("document contains no RSS or Atom articles")
	}
	result := parsedFeed{Title: cleanText(atom.Title), Image: firstNonempty(atom.Logo, atom.Icon)}
	for _, raw := range atom.Entries {
		link := ""
		for _, candidate := range raw.Links {
			if candidate.Rel == "" || candidate.Rel == "alternate" {
				link = candidate.Href
				break
			}
		}
		published := parseFeedTime(firstNonempty(raw.Published, raw.Updated))
		content := firstNonempty(raw.Content.Value, raw.Summary.Value)
		title := firstNonempty(cleanText(raw.Title), "No Title")
		data := map[string]any{"title": title, "link": link, "guid": raw.ID, "pubDate": publishedText(published), "description": truncateSentences(cleanText(raw.Summary.Value), 5), "content": content, "source": cleanText(atom.Title)}
		if len(raw.Authors) > 0 {
			data["author"] = raw.Authors[0].Name
		}
		if link != "" && published != nil {
			result.Items = append(result.Items, ArticleInput{CanonicalURL: CanonicalizeURL(link), GUID: raw.ID, Title: title, PublishedAt: published, Data: data})
		}
	}
	sortArticles(result.Items)
	return result, nil
}

type parsedFeed struct {
	Title, Image string
	Items        []ArticleInput
}
type rssDocument struct {
	Channel struct {
		Title string `xml:"title"`
		Image struct {
			URL  string `xml:"url"`
			Link string `xml:"link"`
		} `xml:"image"`
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
}
type rssItem struct {
	Title string `xml:"title"`
	Link  string `xml:"link"`
	GUID  struct {
		Value string `xml:",chardata"`
	} `xml:"guid"`
	Description  string   `xml:"description"`
	Content      string   `xml:"content"`
	MediaEncoded string   `xml:"encoded"`
	PubDate      string   `xml:"pubDate"`
	Date         string   `xml:"date"`
	Author       string   `xml:"author"`
	Creator      string   `xml:"creator"`
	Categories   []string `xml:"category"`
	Enclosure    struct {
		URL string `xml:"url,attr"`
	} `xml:"enclosure"`
	Thumbnail struct {
		URL string `xml:"url,attr"`
	} `xml:"thumbnail"`
}
type atomDocument struct {
	Title   string      `xml:"title"`
	Icon    string      `xml:"icon"`
	Logo    string      `xml:"logo"`
	Entries []atomEntry `xml:"entry"`
}
type atomEntry struct {
	ID        string     `xml:"id"`
	Title     string     `xml:"title"`
	Updated   string     `xml:"updated"`
	Published string     `xml:"published"`
	Summary   atomText   `xml:"summary"`
	Content   atomText   `xml:"content"`
	Links     []atomLink `xml:"link"`
	Authors   []struct {
		Name string `xml:"name"`
	} `xml:"author"`
}
type atomText struct {
	Value string `xml:",chardata"`
}
type atomLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr"`
}

func validatePublicURL(ctx context.Context, raw string) error {
	u, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return errors.New("feed URL must be a public HTTP or HTTPS URL")
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, u.Hostname())
	if err != nil {
		return fmt.Errorf("resolve feed host: %w", err)
	}
	if len(ips) == 0 {
		return errors.New("feed host did not resolve")
	}
	for _, entry := range ips {
		if !publicIP(entry.IP) {
			return errors.New("feed URL resolves to a non-public address")
		}
	}
	return nil
}

func publicDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	var last error
	for _, entry := range ips {
		if !publicIP(entry.IP) {
			continue
		}
		conn, e := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(entry.IP.String(), port))
		if e == nil {
			return conn, nil
		}
		last = e
	}
	if last != nil {
		return nil, last
	}
	return nil, errors.New("feed host resolves to no public address")
}
func publicIP(ip net.IP) bool {
	return ip != nil && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsUnspecified()
}
func cleanText(value string) string {
	value = tagPattern.ReplaceAllString(value, " ")
	value = html.UnescapeString(value)
	return strings.TrimSpace(spacePattern.ReplaceAllString(value, " "))
}
func truncateSentences(value string, max int) string {
	if value == "" {
		return ""
	}
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '!' || r == '?' || r == '.' })
	if len(parts) <= max {
		return value
	}
	return strings.TrimSpace(strings.Join(parts[:max], ". ")) + "."
}
func parseFeedTime(raw string) *time.Time {
	for _, layout := range []string{time.RFC3339Nano, time.RFC1123Z, time.RFC1123, time.RFC822Z, time.RFC822, "Mon, 02 Jan 2006 15:04:05 MST", "2006-01-02"} {
		if parsed, err := time.Parse(layout, strings.TrimSpace(raw)); err == nil {
			value := parsed.UTC()
			return &value
		}
	}
	return nil
}
func publishedText(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}
func resolveURL(base, relative string) string {
	b, err := url.Parse(base)
	if err != nil {
		return relative
	}
	r, err := url.Parse(relative)
	if err != nil {
		return relative
	}
	return b.ResolveReference(r).String()
}
func firstNonempty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func stringMap(value any) map[string]string {
	out := map[string]string{}
	if value == nil {
		return out
	}
	if object, ok := value.(map[string]any); ok {
		for key, val := range object {
			if text, ok := val.(string); ok {
				out[key] = text
			}
		}
	}
	if object, ok := value.(map[string]string); ok {
		return object
	}
	return out
}
func sortArticles(items []ArticleInput) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].PublishedAt == nil {
			return false
		}
		if items[j].PublishedAt == nil {
			return true
		}
		return items[i].PublishedAt.After(*items[j].PublishedAt)
	})
}

func (s *Store) Refresh(ctx context.Context, owner string, requested []string, fetcher *Fetcher) (RefreshResult, error) {
	if owner == "" || fetcher == nil {
		return RefreshResult{}, fmt.Errorf("%w: owner and feed fetcher are required", ErrInvalid)
	}
	subIDs := map[string]bool{}
	if len(requested) == 0 {
		subs, err := s.ListSubscriptions(ctx, owner)
		if err != nil {
			return RefreshResult{}, err
		}
		for _, sub := range subs {
			subIDs[sub.ID] = true
		}
	} else {
		for _, id := range uniqueStrings(requested) {
			if sub, err := s.GetSubscription(ctx, owner, id); err == nil {
				subIDs[sub.ID] = true
				continue
			}
			selected, err := s.selectedSubscriptionIDs(ctx, owner, id)
			if err != nil {
				return RefreshResult{}, err
			}
			for _, subID := range selected {
				subIDs[subID] = true
			}
		}
	}
	result := RefreshResult{Details: []map[string]any{}}
	for id := range subIDs {
		sub, err := s.GetSubscription(ctx, owner, id)
		if err != nil {
			return result, err
		}
		settings := map[string]any{}
		_ = json.Unmarshal(sub.Settings, &settings)
		items, err := fetcher.Fetch(ctx, sub.URL, settings, firstNonempty(sub.Title, sub.URL))
		if err == nil {
			for i := range items {
				items[i].Data["subscription_id"] = sub.ID
				items[i].Data["subscription_name"] = firstNonempty(sub.Title, sub.URL)
			}
			retention := fetcher.Retention
			if retention <= 0 {
				retention = 1000
			}
			err = s.UpsertArticles(ctx, owner, sub.ID, items, retention)
		}
		if err != nil {
			result.Failed++
			_ = s.RecordFetchFailure(ctx, owner, sub.ID, err.Error())
			result.Details = append(result.Details, map[string]any{"subscriptionId": sub.ID, "error": err.Error()})
			continue
		}
		result.Fetched++
	}
	return result, nil
}

func (s *Store) ReadSubscriptionItems(ctx context.Context, owner, id string, limit int) ([]map[string]any, error) {
	if _, err := s.GetSubscription(ctx, owner, id); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `SELECT a.id,a.data_json FROM news_articles a JOIN news_article_sources s ON s.article_id=a.id WHERE a.owner_id=? AND s.subscription_id=? ORDER BY a.published_at DESC,a.id LIMIT ?`, owner, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, data string
		if err := rows.Scan(&id, &data); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal([]byte(data), &item); err != nil {
			return nil, err
		}
		item["id"] = id
		items = append(items, item)
	}
	return items, rows.Err()
}
