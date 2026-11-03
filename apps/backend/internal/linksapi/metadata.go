package linksapi

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// The metadata endpoint ports apps/backend/src/lib/api/tools/linkMetadata.ts
// and its GET /api/v1/links/metadata route. It fetches untrusted page markup,
// so it applies the same bounded-fetch protections as the Go CalDAV and YAML
// integration clients: HTTP(S) only, per-hop DNS revalidation, cloud metadata
// and loopback/link-local rejection, same-origin redirects, timeouts, and a
// response size cap. Homelab RFC1918/ULA targets stay reachable.
const (
	maxMetadataResponseBytes = 2 << 20
	maxMetadataRedirects     = 5
	metadataRequestTimeout   = 15 * time.Second
	metadataDialTimeout      = 8 * time.Second
)

// LinkMetadata mirrors the JSON body of the TypeScript linkMetadata helper.
type LinkMetadata struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	IconURL     string `json:"iconUrl"`
}

var metadataHTTPClient = newMetadataHTTPClient()

// linkMetadata implements GET /api/v1/links/metadata. Like the TypeScript
// route it requires an authenticated session, reads the url query parameter,
// and answers with {"title","description","iconUrl"}. Validation and fetch
// failures return {error} with the same messages the TypeScript route emits.
func (h *Handler) linkMetadata(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.owner(w, r); !ok {
		return
	}
	metadata, err := fetchLinkMetadata(r.Context(), r.URL.Query().Get("url"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, metadata)
}

func newMetadataHTTPClient() *http.Client {
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           metadataDialContext,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		ExpectContinueTimeout: time.Second,
		ForceAttemptHTTP2:     true,
	}
	client := &http.Client{Transport: transport, Timeout: metadataRequestTimeout}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= maxMetadataRedirects {
			return errors.New("link metadata request exceeded redirect limit")
		}
		if len(via) > 0 && !sameOrigin(via[0].URL, req.URL) {
			return errors.New("link metadata request redirected to a different origin")
		}
		if isMetadataHost(req.URL.Hostname()) {
			return errors.New("link metadata request redirected to cloud metadata")
		}
		return nil
	}
	return client
}

// metadataDialContext resolves every hop itself and dials only addresses that
// pass the SSRF filters, so redirects cannot reach hosts the resolver rejects.
func metadataDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if rejectedMetadataHostname(host) {
		return nil, errors.New("link metadata host is not allowed")
	}
	resolved, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, errors.New("could not resolve link metadata host")
	}
	dialer := &net.Dialer{Timeout: metadataDialTimeout}
	var last error
	for _, entry := range resolved {
		ip := entry.IP
		if blockedMetadataIP(ip) {
			return nil, errors.New("link metadata host resolves to a blocked address")
		}
		conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		last = dialErr
	}
	if last != nil {
		return nil, last
	}
	return nil, errors.New("link metadata host resolved to no usable address")
}

// rejectedMetadataHostname mirrors the CalDAV client host filter and the YAML
// runtime cloud-metadata hostname blocklist.
func rejectedMetadataHostname(host string) bool {
	if host == "" {
		return true
	}
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return true
	}
	return isMetadataHost(host)
}

func isMetadataHost(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	switch host {
	case "metadata", "metadata.google.internal", "metadata.google", "metadata.goog", "instance-data.ec2.internal":
		return true
	}
	return isMetadataIP(net.ParseIP(host))
}

var metadataIPNets = []*net.IPNet{
	mustCIDR("169.254.169.254/32"),
	mustCIDR("169.254.170.2/32"),
	mustCIDR("100.100.100.200/32"),
	mustCIDR("fd00:ec2::254/128"),
}

func mustCIDR(text string) *net.IPNet {
	_, network, _ := net.ParseCIDR(text)
	return network
}

// isMetadataIP blocks the cloud instance metadata endpoints. It does not block
// RFC1918 or ULA space: like the CalDAV client, homelab targets are intended.
func isMetadataIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	for _, network := range metadataIPNets {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// blockedMetadataIP rejects the addresses the CalDAV resolver refuses:
// local machine, link-local, multicast, and cloud metadata ranges.
func blockedMetadataIP(ip net.IP) bool {
	return ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() || isMetadataIP(ip)
}

func sameOrigin(a, b *url.URL) bool {
	if a == nil || b == nil {
		return false
	}
	return a.Scheme == b.Scheme && strings.EqualFold(strings.TrimSuffix(a.Host, "."), strings.TrimSuffix(b.Host, "."))
}

// fetchLinkMetadata ports getLinkMetadata from linkMetadata.ts. The response
// contract and error messages stay unchanged; only the fetch is hardened.
func fetchLinkMetadata(ctx context.Context, raw string) (LinkMetadata, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return LinkMetadata{}, errors.New("Enter a valid URL to fetch link details")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return LinkMetadata{}, errors.New("Only HTTP and HTTPS URLs are supported")
	}
	parsed.Fragment = ""

	requestCtx, cancel := context.WithTimeout(ctx, metadataRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return LinkMetadata{}, errors.New("Enter a valid URL to fetch link details")
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Dashwise link metadata)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	resp, err := metadataHTTPClient.Do(req)
	if err != nil {
		return LinkMetadata{}, errors.New("Unable to fetch URL")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return LinkMetadata{}, fmt.Errorf("Unable to fetch URL (%d)", resp.StatusCode)
	}
	// The TypeScript port slices the text to 2,000,000 characters; the Go
	// port applies the equivalent 2 MiB cap and truncates the same way.
	page, err := io.ReadAll(io.LimitReader(resp.Body, maxMetadataResponseBytes+1))
	if err != nil {
		return LinkMetadata{}, errors.New("Unable to fetch URL")
	}
	if len(page) > maxMetadataResponseBytes {
		page = page[:maxMetadataResponseBytes]
	}

	// fetch (Node) exposes the post-redirect URL as response.url; Go keeps it
	// on resp.Request.URL so icon URLs resolve against the same final origin.
	base := parsed
	if resp.Request != nil && resp.Request.URL != nil && resp.Request.URL.Hostname() != "" {
		base = resp.Request.URL
	}
	metadata := parseLinkMetadata(string(page), base)
	if metadata.Title == "" {
		metadata.Title = base.Hostname()
	}
	return metadata, nil
}

func parseLinkMetadata(page string, base *url.URL) LinkMetadata {
	metaTags := metaTagPattern.FindAllString(page, -1)
	title := firstMetaContent(metaTags, "og:title", "twitter:title")
	if title == "" {
		title = pageTitle(page)
	}
	description := firstMetaContent(metaTags, "og:description", "twitter:description", "description")
	return LinkMetadata{Title: title, Description: description, IconURL: pageIconURL(page, base)}
}

func firstMetaContent(tags []string, names ...string) string {
	for _, tag := range tags {
		name := strings.ToLower(metadataAttribute(tag, "property"))
		if name == "" {
			name = strings.ToLower(metadataAttribute(tag, "name"))
		}
		for _, candidate := range names {
			if name != candidate {
				continue
			}
			if content := metadataAttribute(tag, "content"); content != "" {
				return content
			}
		}
	}
	return ""
}

func pageTitle(page string) string {
	match := titlePattern.FindStringSubmatch(page)
	if match == nil {
		return ""
	}
	return strings.TrimSpace(spacePattern.ReplaceAllString(decodeHTMLText(match[1]), " "))
}

func pageIconURL(page string, base *url.URL) string {
	for _, tag := range linkTagPattern.FindAllString(page, -1) {
		rel := strings.ToLower(metadataAttribute(tag, "rel"))
		href := metadataAttribute(tag, "href")
		if href == "" || !iconRelPattern.MatchString(rel) {
			continue
		}
		resolved, err := base.Parse(href)
		if err != nil || !sameOriginableURL(resolved) {
			// Try the next icon declaration, like the TypeScript port.
			continue
		}
		return resolved.String()
	}
	fallback, err := base.Parse("/favicon.ico")
	if err != nil {
		return ""
	}
	return fallback.String()
}

func sameOriginableURL(u *url.URL) bool {
	return u != nil && u.Hostname() != "" && (u.Scheme == "http" || u.Scheme == "https")
}

func metadataAttribute(tag string, attribute string) string {
	pattern, ok := metadataAttrPatterns[attribute]
	if !ok {
		return ""
	}
	match := pattern.FindStringSubmatch(tag)
	if match == nil || match[1] == "" {
		return ""
	}
	return strings.TrimSpace(decodeHTMLText(match[1]))
}

var metadataAttrPatterns = func() map[string]*regexp.Regexp {
	patterns := map[string]*regexp.Regexp{}
	for _, attribute := range []string{"property", "name", "content", "rel", "href"} {
		patterns[attribute] = regexp.MustCompile(`(?i)\b` + attribute + `\s*=\s*["\']([^"\']*)["\']`)
	}
	return patterns
}()

var (
	metaTagPattern = regexp.MustCompile(`(?i)<meta\b[^>]*>`)
	linkTagPattern = regexp.MustCompile(`(?i)<link\b[^>]*>`)
	titlePattern   = regexp.MustCompile(`(?is)<title\b[^>]*>(.*?)</title>`)
	iconRelPattern = regexp.MustCompile(`(^|\s)(shortcut\s+icon|icon|apple-touch-icon)(\s|$)`)
	spacePattern   = regexp.MustCompile(`\s+`)
)

// namedEntityReplacements ports the decodeHtmlEntities replacement chain. The
// entries run in the same sequential order as the TypeScript chain so
// double-encoded values behave identically.
var namedEntityReplacements = []struct {
	pattern *regexp.Regexp
	decoded string
}{
	{regexp.MustCompile(`(?i)&amp;`), "&"},
	{regexp.MustCompile(`(?i)&quot;`), "\""},
	{regexp.MustCompile(`(?:&#39;|&apos;)`), "'"},
	{regexp.MustCompile(`(?i)&lt;`), "<"},
	{regexp.MustCompile(`(?i)&gt;`), ">"},
}

var numericEntityPattern = regexp.MustCompile(`(?i)&#(?:x[0-9a-f]+|\d+);`)

// decodeHTMLText ports decodeHtmlEntities. Invalid numeric entities are left
// untouched instead of aborting the request.
func decodeHTMLText(value string) string {
	for _, entity := range namedEntityReplacements {
		value = entity.pattern.ReplaceAllString(value, entity.decoded)
	}
	return numericEntityPattern.ReplaceAllStringFunc(value, decodeNumericEntity)
}

func decodeNumericEntity(match string) string {
	digits := match[2 : len(match)-1]
	base := 10
	if digits != "" && (digits[0] == 'x' || digits[0] == 'X') {
		digits = digits[1:]
		base = 16
	}
	code, err := strconv.ParseUint(digits, base, 32)
	if err != nil || code > unicode.MaxRune || (code >= 0xD800 && code <= 0xDFFF) {
		return match
	}
	return string(rune(code))
}
