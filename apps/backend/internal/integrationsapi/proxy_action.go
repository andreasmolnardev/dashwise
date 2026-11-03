package integrationsapi

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/shortcuts"
)

const maxProxyResponseBytes = 2 << 20

type proxyActionDefinition struct {
	Type    string         `json:"type"`
	URL     string         `json:"url"`
	Auth    string         `json:"auth"`
	Headers map[string]any `json:"headers"`
	Body    any            `json:"body"`
}

func (h *Handler) proxyAction(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if h.shortcuts == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "shortcut action service unavailable"})
		return
	}
	var input struct {
		ShortcutID string          `json:"shortcutId"`
		ID         string          `json:"id"`
		Auth       json.RawMessage `json:"auth"`
	}
	if !decode(w, r, &input) {
		return
	}
	shortcutID := firstNonempty(input.ShortcutID, input.ID)
	if shortcutID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing shortcutId"})
		return
	}
	rawAction, err := h.shortcuts.Action(r.Context(), owner, shortcutID)
	if errors.Is(err, shortcuts.ErrNotFound) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Unauthorized"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load shortcut"})
		return
	}
	if action, isString := rawAction.(string); isString && hasRoutedShortcutPrefix(action) {
		h.executeRoutedShortcut(w, r, owner, action)
		return
	}
	action, valid := parseProxyAction(rawAction)
	if !valid || strings.TrimSpace(action.URL) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Unsupported proxy action"})
		return
	}
	requestURL, err := validateProxyURL(action.URL)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Unsupported proxy action"})
		return
	}
	body, err := encodeProxyBody(action.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Unsupported proxy action"})
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, requestURL.String(), body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Unsupported proxy action"})
		return
	}
	for key, value := range action.Headers {
		if !validHeaderName(key) {
			continue
		}
		request.Header.Set(key, scalarText(value))
	}
	if action.Auth != "" && !hasHeader(request.Header, "Authorization") {
		request.Header.Set("Authorization", action.Auth)
	}
	if action.Body != nil && !hasHeader(request.Header, "Content-Type") {
		request.Header.Set("Content-Type", "application/json")
	}
	client := newProxyActionClient()
	response, err := client.Do(request)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not execute proxy action"})
		return
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxProxyResponseBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not read proxy action response"})
		return
	}
	if len(responseBody) > maxProxyResponseBytes {
		responseBody = responseBody[:maxProxyResponseBytes]
	}
	statusText := response.Status
	if _, text, found := strings.Cut(response.Status, " "); found {
		statusText = text
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         response.StatusCode >= 200 && response.StatusCode < 300,
		"status":     response.StatusCode,
		"statusText": statusText,
		"body":       string(responseBody),
	})
}

func parseProxyAction(raw any) (proxyActionDefinition, bool) {
	text, ok := raw.(string)
	if !ok {
		return proxyActionDefinition{}, false
	}
	trimmed := strings.TrimSpace(text)
	if len(trimmed) >= len("post:") && strings.EqualFold(trimmed[:len("post:")], "post:") {
		return proxyActionDefinition{Type: "post", URL: strings.TrimSpace(trimmed[len("post:"):])}, true
	}
	if !strings.HasPrefix(trimmed, "{") {
		return proxyActionDefinition{}, false
	}
	var parsed map[string]any
	if json.Unmarshal([]byte(trimmed), &parsed) != nil || strings.ToLower(strings.TrimSpace(scalarText(parsed["type"]))) != "post" {
		return proxyActionDefinition{}, false
	}
	action := proxyActionDefinition{Type: "post", URL: scalarText(parsed["url"]), Auth: scalarText(parsed["auth"]), Body: parsed["body"]}
	if headers, ok := parsed["headers"].(map[string]any); ok {
		action.Headers = headers
	}
	return action, true
}

func encodeProxyBody(body any) (io.Reader, error) {
	if body == nil {
		return nil, nil
	}
	if text, ok := body.(string); ok {
		return strings.NewReader(text), nil
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	return strings.NewReader(string(encoded)), nil
}

func validateProxyURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return nil, errors.New("invalid proxy action URL")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || isMetadataHost(host) {
		return nil, errors.New("blocked proxy action host")
	}
	if ip := net.ParseIP(host); ip != nil && blockedProxyIP(ip) {
		return nil, errors.New("blocked proxy action address")
	}
	return parsed, nil
}

func newProxyActionClient() *http.Client {
	transport := &http.Transport{
		Proxy:                 nil,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		ResponseHeaderTimeout: 10 * time.Second,
		DialContext:           guardedProxyDial,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 || len(via) == 0 || !sameOrigin(via[0].URL, req.URL) {
				return http.ErrUseLastResponse
			}
			if _, err := validateProxyURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

func guardedProxyDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || isMetadataHost(host) {
		return nil, errors.New("blocked proxy action host")
	}
	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else {
		resolved, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(resolved) == 0 {
			return nil, errors.New("proxy action host did not resolve")
		}
		for _, item := range resolved {
			ips = append(ips, item.IP)
		}
	}
	for _, ip := range ips {
		if blockedProxyIP(ip) {
			return nil, errors.New("proxy action host resolves to a blocked address")
		}
	}
	dialer := &net.Dialer{Timeout: 8 * time.Second}
	var lastErr error
	for _, ip := range ips {
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func blockedProxyIP(ip net.IP) bool {
	return previewBlockedIP(ip) || isSharedAddress(ip)
}

func isMetadataHost(host string) bool {
	switch host {
	case "metadata", "metadata.google.internal", "metadata.google", "metadata.goog", "instance-data.ec2.internal":
		return true
	default:
		return false
	}
}

func hasHeader(headers http.Header, name string) bool {
	for key := range headers {
		if strings.EqualFold(key, name) {
			return true
		}
	}
	return false
}

func validHeaderName(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	for _, r := range value {
		if r <= 32 || r >= 127 || strings.ContainsRune("()<>@,;:\\\"/[]?={} ", r) {
			return false
		}
	}
	return true
}

func scalarText(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(typed)
	default:
		encoded, err := json.Marshal(value)
		if err == nil {
			return string(encoded)
		}
		return ""
	}
}
