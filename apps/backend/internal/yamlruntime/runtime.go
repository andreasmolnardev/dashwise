// Package yamlruntime executes the REST endpoint subset of Dashwise YAML
// integrations. It deliberately accepts decoded YAML maps so the catalog
// loader can choose how blueprint files are supplied.
package yamlruntime

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
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
)

const maxResponseBytes = 5 << 20

var templatePattern = regexp.MustCompile(`\$\{([^}]+)\}`)

type EndpointResult struct {
	ID             string        `json:"id"`
	Name           string        `json:"name,omitempty"`
	Status         int           `json:"status"`
	RawResponse    any           `json:"rawResponse,omitempty"`
	MappedResponse any           `json:"mappedResponse,omitempty"`
	CacheTTL       time.Duration `json:"-"`
}

type Result struct {
	Environment map[string]string         `json:"environment"`
	Endpoints   map[string]EndpointResult `json:"endpoints"`
	Computed    map[string]any            `json:"computed,omitempty"`
}

type Runtime struct {
	Client       *http.Client
	MaxEndpoints int
}

func New() *Runtime {
	return &Runtime{Client: newClient(), MaxEndpoints: 100}
}

// Execute fetches configured endpoints, resolving endpoint-produced values in
// multiple passes so token endpoints can feed later requests.
func (rt *Runtime) Execute(ctx context.Context, blueprint map[string]any, environment map[string]string) (Result, error) {
	if rt == nil || rt.Client == nil {
		return Result{}, errors.New("YAML integration runtime is not configured")
	}
	config := object(blueprint["configuration"])
	endpoints := endpointList(config["endpoints"])
	max := rt.MaxEndpoints
	if max <= 0 || max > 500 {
		max = 100
	}
	if len(endpoints) > max {
		return Result{}, fmt.Errorf("integration contains more than %d endpoints", max)
	}
	env := make(map[string]string, len(environment))
	for key, value := range environment {
		env[key] = value
	}
	result := Result{Environment: env, Endpoints: map[string]EndpointResult{}}
	remaining := append([]namedEndpoint(nil), endpoints...)
	var lastErr error
	for len(remaining) > 0 {
		progress := false
		next := make([]namedEndpoint, 0, len(remaining))
		for _, item := range remaining {
			endpoint, err := rt.fetch(ctx, item, env, result.Endpoints)
			if errors.Is(err, errUnresolved) {
				next = append(next, item)
				continue
			}
			if err != nil {
				lastErr = fmt.Errorf("endpoint %q: %w", item.id, err)
				next = append(next, item)
				continue
			}
			result.Endpoints[item.id] = endpoint
			setProducedEnvironment(item.value, endpoint, env)
			progress = true
		}
		if len(next) == 0 {
			break
		}
		if !progress {
			if lastErr != nil {
				return result, lastErr
			}
			return result, errors.New("integration endpoints contain unresolved dependencies")
		}
		remaining = next
	}
	result.Environment = env
	computed := object(config["computed"])
	if len(computed) > 0 {
		endpointsRoot := map[string]any{}
		for id, endpoint := range result.Endpoints {
			endpointsRoot[id] = map[string]any{"rawResponse": endpoint.RawResponse, "mappedResponse": endpoint.MappedResponse, "status": endpoint.Status}
		}
		root := map[string]any{
			"endpoints":             endpointsRoot,
			"computed":              map[string]any{},
			"environment_variables": env,
			"lookup_tables":         normalizeValue(object(config["lookup_tables"])),
		}
		result.Computed = evaluateComputed(computed, root, env, result.Endpoints)
	}
	return result, nil
}

var errUnresolved = errors.New("unresolved endpoint variables")

type namedEndpoint struct {
	id, name string
	value    map[string]any
}

func endpointList(value any) []namedEndpoint {
	out := []namedEndpoint{}
	switch endpoints := value.(type) {
	case map[string]any:
		for id, raw := range endpoints {
			if ep := object(raw); len(ep) > 0 {
				out = append(out, namedEndpoint{id: id, name: stringValue(ep["name"]), value: ep})
			}
		}
	case []any:
		for i, raw := range endpoints {
			if ep := object(raw); len(ep) > 0 {
				id := first(stringValue(ep["id"]), stringValue(ep["key"]), stringValue(ep["name"]), strconv.Itoa(i))
				out = append(out, namedEndpoint{id: id, name: stringValue(ep["name"]), value: ep})
			}
		}
	}
	return out
}

func (rt *Runtime) fetch(ctx context.Context, item namedEndpoint, env map[string]string, previous map[string]EndpointResult) (EndpointResult, error) {
	ep := item.value
	method := strings.ToUpper(first(stringValue(ep["method"]), "GET"))
	if method == "" {
		method = "GET"
	}
	urlText, err := interpolate(stringValue(ep["url"]), env, previous)
	if err != nil {
		return EndpointResult{}, err
	}
	u, err := url.ParseRequestURI(urlText)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return EndpointResult{}, errors.New("endpoint URL must be an absolute HTTP or HTTPS URL without credentials")
	}
	if isMetadataHost(u.Hostname()) {
		return EndpointResult{}, errors.New("endpoint URL targets cloud metadata")
	}
	if hasUnresolved(urlText) {
		return EndpointResult{}, errUnresolved
	}
	header := make(http.Header)
	for key, raw := range object(ep["custom_headers"]) {
		value, err := interpolate(fmt.Sprint(raw), env, previous)
		if err != nil {
			return EndpointResult{}, err
		}
		if hasUnresolved(value) {
			continue
		}
		header.Set(key, value)
	}
	if auth := stringValue(ep["auth"]); auth != "" && header.Get("Authorization") == "" {
		value, err := interpolate(auth, env, previous)
		if err != nil {
			return EndpointResult{}, err
		}
		if !hasUnresolved(value) {
			header.Set("Authorization", value)
		}
	}
	var body io.Reader
	if value, exists := ep["body"]; exists && value != nil && method != http.MethodGet && method != http.MethodHead {
		resolved, err := resolveValue(value, env, previous)
		if err != nil {
			return EndpointResult{}, err
		}
		encoded, err := json.Marshal(resolved)
		if err != nil {
			return EndpointResult{}, err
		}
		body = bytes.NewReader(encoded)
		if header.Get("Content-Type") == "" {
			header.Set("Content-Type", "application/json")
		}
	}
	timeout := parseTimeout(ep["timeout"])
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, method, u.String(), body)
	if err != nil {
		return EndpointResult{}, err
	}
	req.Header = header
	resp, err := rt.Client.Do(req)
	if err != nil {
		return EndpointResult{}, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	responseBytes, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return EndpointResult{}, err
	}
	if len(responseBytes) > maxResponseBytes {
		return EndpointResult{}, errors.New("endpoint response exceeds 5 MB")
	}
	var raw any
	responseType := strings.ToLower(stringValue(object(ep["response"])["type"]))
	if responseType == "" {
		responseType = "json"
	}
	if responseType == "json" {
		if err := json.Unmarshal(responseBytes, &raw); err != nil {
			return EndpointResult{}, fmt.Errorf("response is not valid JSON: %w", err)
		}
	} else {
		raw = string(responseBytes)
	}
	dataPath := stringValue(object(ep["response"])["data_path"])
	if dataPath != "" {
		raw = lookupPath(raw, dataPath)
	}
	mapped := raw
	if mapping, ok := ep["response_mapping"]; ok {
		mapped, err = mapResponse(mapping, raw)
		if err != nil {
			return EndpointResult{}, fmt.Errorf("map response: %w", err)
		}
	} else if boolValue(ep["discard_unmapped"]) {
		mapped = map[string]any{}
	}
	ttl := parseDuration(ep["cache_ttl"])
	result := EndpointResult{ID: item.id, Name: item.name, Status: resp.StatusCode, RawResponse: raw, MappedResponse: mapped, CacheTTL: ttl}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return result, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return result, nil
}

func setProducedEnvironment(ep map[string]any, result EndpointResult, env map[string]string) {
	definition := object(ep["response"])
	name := strings.TrimSpace(stringValue(definition["data_set_env"]))
	if name == "" {
		return
	}
	value := result.RawResponse
	if value != nil {
		env[name] = fmt.Sprint(value)
	}
}

func mapResponse(mapping any, raw any) (any, error) {
	if mapDef := object(mapping); len(mapDef) > 0 {
		if iterable := stringValue(mapDef["iterate"]); iterable != "" {
			rows := listValue(lookupPath(raw, iterable))
			if slice := stringValue(mapDef["slice"]); slice != "" {
				rows = applySlice(rows, slice)
			}
			properties := mapDef["mappingProperties"]
			out := make([]any, 0, len(rows))
			for index, item := range rows {
				mapped, err := mapResponseWithIndex(properties, item, index, raw)
				if err != nil {
					return nil, err
				}
				out = append(out, mapped)
			}
			return out, nil
		}
		out := make(map[string]any, len(mapDef))
		for key, value := range mapDef {
			mapped, err := mapResponse(value, raw)
			if err != nil {
				return nil, err
			}
			out[key] = mapped
		}
		return out, nil
	}
	if text, ok := mapping.(string); ok {
		return lookupPath(raw, text), nil
	}
	return mapping, nil
}

func mapResponseWithIndex(definition any, item any, index int, root any) (any, error) {
	if values, ok := definition.([]any); ok {
		combined := map[string]any{}
		for _, raw := range values {
			part, err := mapResponseWithIndex(raw, item, index, root)
			if err != nil {
				return nil, err
			}
			for key, value := range object(part) {
				combined[key] = value
			}
		}
		return combined, nil
	}
	if values := object(definition); len(values) > 0 {
		if iterable := stringValue(values["iterate"]); iterable != "" {
			rows := listValue(lookupPath(item, iterable))
			result := make([]any, 0, len(rows))
			for i, row := range rows {
				mapped, err := mapResponseWithIndex(values["mappingProperties"], row, i, root)
				if err != nil {
					return nil, err
				}
				result = append(result, mapped)
			}
			return result, nil
		}
		out := map[string]any{}
		for key, value := range values {
			if key == "iterate" || key == "mappingProperties" || key == "slice" {
				continue
			}
			mapped, err := mapResponseWithIndex(value, item, index, root)
			if err != nil {
				return nil, err
			}
			out[key] = mapped
		}
		return out, nil
	}
	if text, ok := definition.(string); ok {
		text = strings.ReplaceAll(text, "${_index}", strconv.Itoa(index))
		if strings.HasPrefix(text, "this.") {
			return lookupPath(root, strings.TrimPrefix(text, "this.")), nil
		}
		return lookupPath(item, text), nil
	}
	return definition, nil
}

func interpolate(value string, env map[string]string, previous map[string]EndpointResult) (string, error) {
	var unresolved bool
	result := templatePattern.ReplaceAllStringFunc(value, func(token string) string {
		path := strings.TrimSpace(token[2 : len(token)-1])
		if strings.HasPrefix(path, "this.endpoints.") {
			path = strings.TrimPrefix(path, "this.endpoints.")
			parts := strings.SplitN(path, ".", 2)
			if len(parts) == 2 {
				endpoint, ok := previous[parts[0]]
				if ok {
					found := lookupPath(map[string]any{"rawResponse": endpoint.RawResponse, "mappedResponse": endpoint.MappedResponse}, parts[1])
					if found != nil {
						return fmt.Sprint(found)
					}
				}
			}
			unresolved = true
			return ""
		}
		if strings.HasPrefix(path, "now()") {
			return time.Now().UTC().Format("2006-01-02")
		}
		if value, ok := env[path]; ok {
			return value
		}
		if dot := strings.IndexByte(path, '.'); dot > 0 {
			if value, ok := env[path[:dot]]; ok {
				if parsed, err := decodeJSONValue(value); err == nil {
					found := lookupPath(parsed, path[dot+1:])
					if found != nil {
						return fmt.Sprint(found)
					}
				}
			}
		}
		unresolved = true
		return ""
	})
	if unresolved {
		return result, errUnresolved
	}
	return result, nil
}

func resolveValue(value any, env map[string]string, previous map[string]EndpointResult) (any, error) {
	switch current := value.(type) {
	case string:
		return interpolate(current, env, previous)
	case []any:
		out := make([]any, len(current))
		for i, value := range current {
			resolved, err := resolveValue(value, env, previous)
			if err != nil {
				return nil, err
			}
			out[i] = resolved
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(current))
		for key, value := range current {
			resolved, err := resolveValue(value, env, previous)
			if err != nil {
				return nil, err
			}
			out[key] = resolved
		}
		return out, nil
	default:
		return value, nil
	}
}

func lookupPath(root any, path string) any {
	path = strings.TrimSpace(strings.TrimPrefix(path, "this."))
	if path == "" {
		return root
	}
	if strings.HasPrefix(path, "$.") {
		path = strings.TrimPrefix(path, "$.")
	}
	parts := strings.Split(path, ".")
	values := []any{root}
	for _, part := range parts {
		if part == "" {
			continue
		}
		index := -1
		if bracket := strings.IndexByte(part, '['); bracket >= 0 && strings.HasSuffix(part, "]") {
			name := part[:bracket]
			indexes := part[bracket+1 : len(part)-1]
			for i := range values {
				if name != "" {
					if objectValue, ok := values[i].(map[string]any); ok {
						values[i] = objectValue[name]
					} else {
						values[i] = nil
					}
				}
			}
			if indexes == "*" {
				next := []any{}
				for _, value := range values {
					next = append(next, listValue(value)...)
				}
				values = next
				continue
			}
			index, _ = strconv.Atoi(indexes)
		} else {
			for i := range values {
				if objectValue, ok := values[i].(map[string]any); ok {
					values[i] = objectValue[part]
				} else {
					values[i] = nil
				}
			}
			continue
		}
		for i := range values {
			if list, ok := values[i].([]any); ok && index >= 0 && index < len(list) {
				values[i] = list[index]
			} else {
				values[i] = nil
			}
		}
	}
	if len(values) == 1 {
		return values[0]
	}
	return values
}

func newClient() *http.Client {
	transport := &http.Transport{Proxy: nil, DialContext: guardedDial, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("integration request exceeded redirect limit")
		}
		if len(via) > 0 && !sameHost(via[len(via)-1].URL, req.URL) {
			return errors.New("integration request redirected to a different host")
		}
		if isMetadataHost(req.URL.Hostname()) {
			return errors.New("integration request redirected to cloud metadata")
		}
		return nil
	}
	return client
}

func guardedDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	if isMetadataHost(host) {
		return nil, errors.New("integration host is a cloud metadata endpoint")
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("integration host did not resolve")
	}
	for _, resolved := range ips {
		if isMetadataIP(resolved.IP) {
			return nil, errors.New("integration host resolves to cloud metadata")
		}
	}
	var last error
	for _, resolved := range ips {
		conn, err := (&net.Dialer{Timeout: 8 * time.Second}).DialContext(ctx, network, net.JoinHostPort(resolved.IP.String(), port))
		if err == nil {
			return conn, nil
		}
		last = err
	}
	return nil, last
}

func isMetadataHost(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	switch host {
	case "metadata", "metadata.google.internal", "metadata.google", "metadata.goog", "instance-data.ec2.internal":
		return true
	}
	return isMetadataIP(net.ParseIP(host))
}
func isMetadataIP(ip net.IP) bool {
	return ip != nil && (ip.IsLinkLocalUnicast() || ip.Equal(net.ParseIP("100.100.100.200")) || ip.Equal(net.ParseIP("fd00:ec2::254")))
}
func sameHost(a, b *url.URL) bool { return a.Scheme == b.Scheme && strings.EqualFold(a.Host, b.Host) }

func parseTimeout(value any) time.Duration {
	if value == nil {
		return 15 * time.Second
	}
	if n, ok := value.(float64); ok {
		if n > 0 && n < 120 {
			return time.Duration(n) * time.Second
		}
	}
	if n, ok := value.(int); ok {
		if n > 0 && n < 120 {
			return time.Duration(n) * time.Second
		}
	}
	if text, ok := value.(string); ok {
		if d, err := time.ParseDuration(text); err == nil && d > 0 && d < 120*time.Second {
			return d
		}
	}
	return 15 * time.Second
}
func parseDuration(value any) time.Duration {
	if n, ok := value.(float64); ok && n > 0 {
		return time.Duration(n) * time.Second
	}
	if n, ok := value.(int); ok && n > 0 {
		return time.Duration(n) * time.Second
	}
	if text, ok := value.(string); ok {
		if d, err := time.ParseDuration(text); err == nil && d > 0 {
			return d
		}
	}
	return 0
}
func applySlice(items []any, value string) []any {
	parts := strings.SplitN(value, ":", 2)
	if len(parts) != 2 {
		return items
	}
	start, _ := strconv.Atoi(parts[0])
	end, _ := strconv.Atoi(parts[1])
	if start < 0 {
		start = 0
	}
	if start > len(items) {
		start = len(items)
	}
	if end <= 0 || end > len(items) {
		end = len(items)
	}
	if end < start {
		end = start
	}
	return items[start:end]
}
func listValue(value any) []any {
	if values, ok := value.([]any); ok {
		return values
	}
	return nil
}
func object(value any) map[string]any {
	if values, ok := value.(map[string]any); ok {
		return values
	}
	return map[string]any{}
}
func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}
func boolValue(value any) bool { yes, _ := value.(bool); return yes }
func first(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
func hasUnresolved(value string) bool { return strings.Contains(value, "${") }
func decodeJSONValue(value string) (any, error) {
	var out any
	err := json.Unmarshal([]byte(value), &out)
	return out, err
}
func numeric(value any) float64 {
	switch n := value.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case string:
		out, _ := strconv.ParseFloat(n, 64)
		return out
	}
	return 0
}
