package integrationsapi

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	previewMaxBytes      = 1 << 20
	previewTimeout       = 10 * time.Second
	previewMaxCache      = 1000
	previewCacheMaxBytes = 16 << 20
)

type previewCacheEntry struct {
	body      any
	size      int
	expiresAt time.Time
}

var previewCache = struct {
	sync.Mutex
	items map[string]previewCacheEntry
	bytes int
}{items: map[string]previewCacheEntry{}}

func (h *Handler) previewJSON(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var input struct {
		URL                  string          `json:"url"`
		InvalidateAfter      json.RawMessage `json:"invalidateAfter"`
		InvalidateAfterSnake json.RawMessage `json:"invalidate_after"`
	}
	if !decode(w, r, &input) {
		return
	}
	target, err := url.Parse(strings.TrimSpace(input.URL))
	if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" {
		writeJSON(w, 400, map[string]string{"error": "Preview URL must be an absolute HTTP or HTTPS URL"})
		return
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		writeJSON(w, 400, map[string]string{"error": "Preview URL must use HTTP or HTTPS"})
		return
	}
	cacheSeconds := parsePreviewCacheSeconds(input.InvalidateAfter)
	if len(input.InvalidateAfter) == 0 {
		cacheSeconds = parsePreviewCacheSeconds(input.InvalidateAfterSnake)
	}
	cacheKey := previewCacheKey(owner, target.String(), cacheSeconds)
	if cached, found := getPreviewCache(cacheKey); found {
		w.Header().Set("Cache-Control", "private, no-store")
		writeJSON(w, http.StatusOK, map[string]any{"body": cached})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), previewTimeout)
	defer cancel()
	client, err := newPreviewClient(ctx)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "Preview URL hostname could not be resolved"})
		return
	}
	defer client.CloseIdleConnections()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "Preview URL must be an absolute HTTP or HTTPS URL"})
		return
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "Unable to fetch preview URL"})
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := fmt.Sprintf("Preview request returned HTTP %d", response.StatusCode)
		writeJSON(w, 502, map[string]string{"error": message})
		return
	}
	if !strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "json") {
		writeJSON(w, 422, map[string]string{"error": "Image endpoint preview must return JSON"})
		return
	}
	if response.ContentLength > previewMaxBytes {
		writeJSON(w, 413, map[string]string{"error": "Preview response is too large"})
		return
	}
	contents, err := io.ReadAll(io.LimitReader(response.Body, previewMaxBytes+1))
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "Unable to read preview response"})
		return
	}
	if len(contents) > previewMaxBytes {
		writeJSON(w, 413, map[string]string{"error": "Preview response is too large"})
		return
	}
	var body any
	if err := json.Unmarshal(contents, &body); err != nil {
		writeJSON(w, 422, map[string]string{"error": "Preview response is invalid JSON"})
		return
	}
	putPreviewCache(cacheKey, body, time.Duration(cacheSeconds)*time.Second)
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{"body": body})
}

func newPreviewClient(ctx context.Context) (*http.Client, error) {
	transport := &http.Transport{
		Proxy:                 nil,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		DialContext:           previewDialContext(ctx),
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: previewTimeout,
	}
	client := &http.Client{Transport: transport, Timeout: previewTimeout}
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if len(via) >= 5 || len(via) > 0 && !sameOrigin(via[0].URL, request.URL) {
			return errors.New("preview request redirected outside its origin")
		}
		return nil
	}
	return client, nil
}

func previewDialContext(ctx context.Context) func(context.Context, string, string) (net.Conn, error) {
	return func(dialCtx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := resolvePreviewHost(dialCtx, host)
		if err != nil {
			return nil, err
		}
		dialer := &net.Dialer{Timeout: 5 * time.Second}
		var last error
		for _, ip := range ips {
			conn, dialErr := dialer.DialContext(dialCtx, network, net.JoinHostPort(ip.String(), port))
			if dialErr == nil {
				return conn, nil
			}
			last = dialErr
		}
		if last != nil {
			return nil, last
		}
		return nil, errors.New("preview host has no usable address")
	}
}

func resolvePreviewHost(ctx context.Context, rawHost string) ([]net.IP, error) {
	host := strings.TrimSuffix(strings.ToLower(strings.Trim(rawHost, "[]")), ".")
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return nil, errors.New("preview URL targets a local hostname")
	}
	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else {
		entries, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			ips = append(ips, entry.IP)
		}
	}
	if len(ips) == 0 || len(ips) > 32 {
		return nil, errors.New("preview URL host has no usable address")
	}
	allowPrivate := os.Getenv("ALLOW_PRIVATE_PREVIEW_URLS") == "true" || os.Getenv("ALLOW_PRIVATE_PREVIEW_URLS") == "1"
	for _, ip := range ips {
		if previewBlockedIP(ip) || !allowPrivate && (ip.IsPrivate() || isSharedAddress(ip)) {
			return nil, errors.New("preview URL targets a private address")
		}
	}
	return ips, nil
}

func previewBlockedIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	for _, cidr := range []string{"169.254.169.254/32", "169.254.170.2/32", "100.100.100.200/32", "fd00:ec2::254/128"} {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func isSharedAddress(ip net.IP) bool {
	_, network, _ := net.ParseCIDR("100.64.0.0/10")
	return network.Contains(ip)
}

func sameOrigin(a, b *url.URL) bool {
	return a != nil && b != nil && strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

func parsePreviewCacheSeconds(value json.RawMessage) int64 {
	const maxSeconds = int64(30 * 24 * 60 * 60)
	if len(value) == 0 || string(value) == "null" {
		return 300
	}
	var number float64
	if json.Unmarshal(value, &number) == nil && number > 0 {
		if number >= float64(maxSeconds) {
			return maxSeconds
		}
		return int64(number)
	}
	var raw string
	if json.Unmarshal(value, &raw) != nil {
		return 300
	}
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(raw)))
	if len(fields) != 2 {
		return 300
	}
	amount, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || amount <= 0 {
		return 300
	}
	unit := strings.TrimSuffix(strings.TrimSuffix(fields[1], "s"), "s")
	multiplier := float64(0)
	switch unit {
	case "s", "sec", "second":
		multiplier = 1
	case "m", "min", "minute":
		multiplier = 60
	case "h", "hr", "hour":
		multiplier = 3600
	case "d", "day":
		multiplier = 86400
	case "w", "week":
		multiplier = 604800
	}
	if multiplier == 0 {
		return 300
	}
	seconds := amount * multiplier
	if seconds >= float64(maxSeconds) {
		return maxSeconds
	}
	if seconds < 1 {
		return 1
	}
	return int64(seconds)
}

func previewCacheKey(owner, target string, seconds int64) string {
	digest := sha256.Sum256([]byte(target + ":" + strconv.FormatInt(seconds, 10)))
	return owner + ":" + hex.EncodeToString(digest[:])
}

func getPreviewCache(key string) (any, bool) {
	previewCache.Lock()
	defer previewCache.Unlock()
	entry, exists := previewCache.items[key]
	if !exists {
		return nil, false
	}
	if !entry.expiresAt.After(time.Now()) {
		delete(previewCache.items, key)
		return nil, false
	}
	return entry.body, true
}

func putPreviewCache(key string, body any, ttl time.Duration) {
	encoded, err := json.Marshal(body)
	if err != nil || len(encoded) > previewCacheMaxBytes {
		return
	}
	previewCache.Lock()
	defer previewCache.Unlock()
	if previous, exists := previewCache.items[key]; exists {
		previewCache.bytes -= previous.size
		delete(previewCache.items, key)
	}
	if len(previewCache.items) >= previewMaxCache {
		for cacheKey, entry := range previewCache.items {
			if !entry.expiresAt.After(time.Now()) {
				previewCache.bytes -= entry.size
				delete(previewCache.items, cacheKey)
			}
		}
	}
	for len(previewCache.items) >= previewMaxCache || previewCache.bytes+len(encoded) > previewCacheMaxBytes {
		removed := false
		for cacheKey, entry := range previewCache.items {
			previewCache.bytes -= entry.size
			delete(previewCache.items, cacheKey)
			removed = true
			break
		}
		if !removed {
			return
		}
	}
	previewCache.items[key] = previewCacheEntry{body: body, size: len(encoded), expiresAt: time.Now().Add(ttl)}
	previewCache.bytes += len(encoded)
}
