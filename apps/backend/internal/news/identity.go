package news

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// CanonicalizeURL normalizes common tracking parameters, fragments, host case,
// and trailing path slashes before using a link as an article identity.
func CanonicalizeURL(value string) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return strings.TrimRight(strings.ToLower(strings.SplitN(raw, "#", 2)[0]), "/")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Fragment = ""
	query := parsed.Query()
	for key := range query {
		lower := strings.ToLower(key)
		if strings.HasPrefix(lower, "utm_") || lower == "fbclid" || lower == "gclid" || lower == "mc_cid" || lower == "mc_eid" {
			query.Del(key)
		}
	}
	parsed.RawQuery = canonicalQuery(query)
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if parsed.Path == "" {
		parsed.Path = "/"
	}
	return parsed.String()
}

func ArticleKey(link, guid, title, sourceURL string, publishedAt *time.Time) string {
	if canonical := CanonicalizeURL(link); canonical != "" {
		return "url:" + canonical
	}
	if id := strings.ToLower(strings.TrimSpace(guid)); id != "" {
		return "guid:" + id
	}
	title = strings.ToLower(strings.Join(strings.Fields(title), " "))
	if title == "" {
		return ""
	}
	sourceHost := strings.ToLower(strings.TrimSpace(sourceURL))
	if parsed, err := url.Parse(sourceURL); err == nil && parsed.Host != "" {
		sourceHost = strings.ToLower(parsed.Host)
	}
	published := int64(0)
	if publishedAt != nil {
		published = publishedAt.UnixMilli()
	}
	digest := sha256.Sum256([]byte(title + "|" + sourceHost + "|" + strconv.FormatInt(published, 10)))
	return "fallback:" + hex.EncodeToString(digest[:])
}

func canonicalQuery(query url.Values) string {
	keys := make([]string, 0, len(query))
	for key := range query {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make(url.Values, len(query))
	for _, key := range keys {
		values := query[key]
		sort.Strings(values)
		parts[key] = values
	}
	return parts.Encode()
}
