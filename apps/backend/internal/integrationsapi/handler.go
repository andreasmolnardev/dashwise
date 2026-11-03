// Package integrationsapi exposes authenticated integration instance management.
package integrationsapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/auth"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/realtimebroker"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/shortcuts"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/yamlruntime"
)

const maxBody = 1 << 20

type Handler struct {
	store     *integrations.Store
	auth      resourceapi.Authenticate
	runtime   *yamlruntime.Runtime
	shortcuts *shortcuts.Store
	sessions  *auth.Store
	broker    *realtimebroker.Broker
	mux       *http.ServeMux
}

func New(store *integrations.Store, authenticate resourceapi.Authenticate, runtimes ...*yamlruntime.Runtime) (http.Handler, error) {
	return newHandler(store, authenticate, nil, nil, nil, runtimes...)
}

// NewWithShortcuts constructs the integrations API with owner-scoped shortcut
// action lookup enabled for the legacy proxyAction endpoint. The realtime
// session broker enables routed shortcut:<session>.<shortcut> actions; when
// the broker or session store is missing, routed actions stay unavailable.
func NewWithShortcuts(store *integrations.Store, authenticate resourceapi.Authenticate, shortcutStore *shortcuts.Store, sessionStore *auth.Store, broker *realtimebroker.Broker, runtimes ...*yamlruntime.Runtime) (http.Handler, error) {
	if shortcutStore == nil {
		return nil, errors.New("integrations API requires a shortcuts store for proxy actions")
	}
	return newHandler(store, authenticate, shortcutStore, sessionStore, broker, runtimes...)
}

func newHandler(store *integrations.Store, authenticate resourceapi.Authenticate, shortcutStore *shortcuts.Store, sessionStore *auth.Store, broker *realtimebroker.Broker, runtimes ...*yamlruntime.Runtime) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("integrations API requires a store and authenticator")
	}
	runtime := yamlruntime.New()
	if len(runtimes) > 0 && runtimes[0] != nil {
		runtime = runtimes[0]
	}
	h := &Handler{store: store, auth: authenticate, runtime: runtime, shortcuts: shortcutStore, sessions: sessionStore, broker: broker, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/integrations", h.listOrGet)
	h.mux.HandleFunc("POST /api/v1/integrations", h.create)
	h.mux.HandleFunc("PUT /api/v1/integrations/{id}", h.update)
	h.mux.HandleFunc("DELETE /api/v1/integrations/{id}", h.delete)
	h.mux.HandleFunc("POST /api/v1/integrations/preview-json", h.previewJSON)
	h.mux.HandleFunc("POST /api/v1/integrations/test-endpoint", h.testEndpoint)
	h.mux.HandleFunc("POST /api/v1/integrations/proxyAction", h.proxyAction)
	return h.mux, nil
}

func (h *Handler) testEndpoint(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var input struct {
		Target string `json:"target"`
	}
	if !decode(w, r, &input) {
		return
	}
	target := strings.TrimSpace(input.Target)
	dot := strings.IndexByte(target, '.')
	if dot <= 0 || dot == len(target)-1 {
		writeJSON(w, 400, map[string]string{"error": "Invalid target format"})
		return
	}
	integrationID, endpointKey := target[:dot], target[dot+1:]
	integration, err := h.store.Get(r.Context(), owner, integrationID)
	if err != nil || integration.Type == "sdk" {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	endpointID, endpointConfig, found := findEndpoint(integration.Config, endpointKey)
	if !found {
		writeJSON(w, 404, map[string]string{"error": "Endpoint not found"})
		return
	}
	result, executeErr := h.runtime.Execute(r.Context(), integration.Config, integration.Environment)
	if executeErr != nil {
		// Execute returns only normalized endpoint results. When the target fails,
		// its partial HTTP result is not available through the current runtime API.
		writeJSON(w, 502, map[string]string{"error": "could not execute integration endpoint"})
		return
	}
	endpoint, ok := result.Endpoints[endpointID]
	if !ok {
		writeJSON(w, 502, map[string]string{"error": "integration endpoint did not return a response"})
		return
	}
	if !sameEnvironment(integration.Environment, result.Environment) {
		if _, err := h.store.Update(r.Context(), owner, integration.ID, integrations.Input{
			Type: integration.Type, Name: integration.Name, Source: integration.Source,
			Config: integration.Config, Environment: result.Environment, LocalData: integration.LocalData,
			SDKEnabled: &integration.SDKEnabled,
		}); err != nil {
			writeJSON(w, 500, map[string]string{"error": "could not save integration environment"})
			return
		}
	}
	method := strings.ToUpper(firstNonempty(stringValue(endpointConfig["method"]), "GET"))
	configuredURL := stringValue(endpointConfig["url"])
	name := nullableString(stringValue(endpointConfig["name"]))
	description := nullableString(stringValue(endpointConfig["description"]))
	body, parsed := responseBody(endpoint.RawResponse)
	writeJSON(w, 200, map[string]any{
		"integration": map[string]any{"id": integration.ID, "name": nullableString(integration.Name)},
		"endpoint":    map[string]any{"id": endpointID, "name": name, "description": description, "method": method, "url": configuredURL},
		"request":     map[string]any{"url": configuredURL, "method": method, "headers": map[string]string{}, "body": nil},
		"response":    map[string]any{"status": endpoint.Status, "statusText": "", "headers": map[string]string{}, "body": body, "parsedBody": parsed},
	})
}

func findEndpoint(blueprint map[string]any, selector string) (string, map[string]any, bool) {
	configuration, _ := blueprint["configuration"].(map[string]any)
	switch endpoints := configuration["endpoints"].(type) {
	case map[string]any:
		if raw, exists := endpoints[selector]; exists {
			if endpoint, ok := raw.(map[string]any); ok {
				return selector, endpoint, true
			}
		}
		for key, raw := range endpoints {
			if endpoint, ok := raw.(map[string]any); ok && stringValue(endpoint["name"]) == selector {
				return key, endpoint, true
			}
		}
	case []any:
		for index, raw := range endpoints {
			endpoint, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			key := firstNonempty(stringValue(endpoint["id"]), stringValue(endpoint["key"]), stringValue(endpoint["name"]), strconv.Itoa(index))
			if key == selector || stringValue(endpoint["name"]) == selector {
				return key, endpoint, true
			}
		}
	}
	return "", nil, false
}

func responseBody(value any) (string, any) {
	if value == nil {
		return "", nil
	}
	if body, ok := value.(string); ok {
		var parsed any
		if json.Unmarshal([]byte(body), &parsed) == nil {
			return body, parsed
		}
		return body, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", nil
	}
	return string(encoded), value
}

func sameEnvironment(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func firstNonempty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		writeJSON(w, 401, map[string]string{"error": "authentication required"})
		return "", false
	}
	return owner, true
}

func (h *Handler) listOrGet(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if id := strings.TrimSpace(r.URL.Query().Get("id")); id != "" {
		item, err := h.store.Get(r.Context(), owner, id)
		if err != nil {
			h.fail(w, err)
			return
		}
		if item.Type == "sdk" {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		if r.URL.Query().Get("resolveEndpoints") == "true" || r.URL.Query().Get("resolveEndpoints") == "1" {
			resolved, executeErr := h.runtime.Execute(r.Context(), item.Config, item.Environment)
			if executeErr != nil {
				writeJSON(w, 502, map[string]string{"error": "could not resolve integration endpoints"})
				return
			}
			if !sameEnvironment(item.Environment, resolved.Environment) {
				updated, updateErr := h.store.Update(r.Context(), owner, item.ID, integrations.Input{
					Type: item.Type, Name: item.Name, Source: item.Source,
					Config: item.Config, Environment: resolved.Environment, LocalData: item.LocalData,
					SDKEnabled: &item.SDKEnabled,
				})
				if updateErr != nil {
					writeJSON(w, 500, map[string]string{"error": "could not save integration environment"})
					return
				}
				item = updated
			}
			writeJSON(w, 200, map[string]any{
				"integration":       item,
				"resolvedEndpoints": resolvedEndpointDebugList(item.Config, item.Environment, resolved.Endpoints),
				"resolvedComputed":  resolved.Computed,
			})
			return
		}
		writeJSON(w, 200, map[string]any{"integration": item})
		return
	}
	items, err := h.store.List(r.Context(), owner, false)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"integrations": items})
}

// resolvedEndpointDebugList returns the resolved request preview and the
// response data produced by the YAML runtime for the settings debug dialog.
func resolvedEndpointDebugList(config map[string]any, environment map[string]string, results map[string]yamlruntime.EndpointResult) []map[string]any {
	configuration, _ := config["configuration"].(map[string]any)
	var endpoints []map[string]any
	switch raw := configuration["endpoints"].(type) {
	case map[string]any:
		for id, value := range raw {
			if endpoint, ok := value.(map[string]any); ok {
				endpoints = append(endpoints, resolvedEndpointDebug(id, endpoint, environment, results))
			}
		}
	case []any:
		for index, value := range raw {
			if endpoint, ok := value.(map[string]any); ok {
				id := firstNonempty(stringValue(endpoint["id"]), stringValue(endpoint["key"]), stringValue(endpoint["name"]), fmt.Sprint(index))
				endpoints = append(endpoints, resolvedEndpointDebug(id, endpoint, environment, results))
			}
		}
	}
	return endpoints
}

func resolvedEndpointDebug(id string, endpoint map[string]any, environment map[string]string, results map[string]yamlruntime.EndpointResult) map[string]any {
	method := firstNonempty(stringValue(endpoint["method"]), "GET")
	url := stringValue(endpoint["url"])
	headers := map[string]any{}
	for _, key := range []string{"headers", "custom_headers"} {
		if values, ok := endpoint[key].(map[string]any); ok {
			for name, value := range values {
				headers[name] = resolveDebugValue(value, environment)
			}
		}
	}
	resolvedHeaders := map[string]string{}
	for key, value := range headers {
		resolvedHeaders[key] = fmt.Sprint(value)
	}
	resolvedURL := resolveDebugString(url, environment)
	resolvedAuth := resolveDebugString(stringValue(endpoint["auth"]), environment)
	if resolvedAuth == "" {
		for key, value := range resolvedHeaders {
			if strings.EqualFold(key, "authorization") {
				resolvedAuth = value
				break
			}
		}
	}
	response := any(nil)
	if result, ok := results[id]; ok {
		response = map[string]any{"id": id, "name": nullableString(stringValue(endpoint["name"])), "method": method, "url": url, "resolvedUrl": resolvedURL, "requestHeaders": resolvedHeaders, "requestBody": resolveDebugValue(endpoint["body"], environment), "rawResponse": result.RawResponse, "mappedResponse": result.MappedResponse}
	}
	return map[string]any{
		"id": nullableString(firstNonempty(stringValue(endpoint["id"]), id)), "name": nullableString(stringValue(endpoint["name"])),
		"description": nullableString(stringValue(endpoint["description"])), "method": method, "url": url,
		"auth": stringValue(endpoint["auth"]), "allow_insecure_ssl": endpoint["allow_insecure_ssl"], "timeout": endpoint["timeout"],
		"body": endpoint["body"], "custom_headers": endpoint["custom_headers"], "response_body_types": endpoint["response_body_types"],
		"response_mappings": endpoint["response_mappings"], "resolvedUrl": resolvedURL, "resolvedAuth": resolvedAuth,
		"resolvedHeaders": resolvedHeaders, "resolvedBody": resolveDebugValue(endpoint["body"], environment), "response": response,
	}
}

func resolveDebugValue(value any, environment map[string]string) any {
	switch current := value.(type) {
	case string:
		return resolveDebugString(current, environment)
	case []any:
		resolved := make([]any, len(current))
		for index, child := range current {
			resolved[index] = resolveDebugValue(child, environment)
		}
		return resolved
	case map[string]any:
		resolved := make(map[string]any, len(current))
		for key, child := range current {
			resolved[key] = resolveDebugValue(child, environment)
		}
		return resolved
	default:
		return value
	}
}

func resolveDebugString(value string, environment map[string]string) string {
	for key, replacement := range environment {
		value = strings.ReplaceAll(value, "${"+key+"}", replacement)
	}
	return value
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var input integrations.Input
	if !decode(w, r, &input) {
		return
	}
	item, err := h.store.Create(r.Context(), owner, input)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"integration": item})
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	current, err := h.store.Get(r.Context(), owner, id)
	if err != nil {
		h.fail(w, err)
		return
	}
	if current.Type == "sdk" {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	var input integrations.Input
	if !decode(w, r, &input) {
		return
	}
	item, err := h.store.Update(r.Context(), owner, id, input)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"integration": item})
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, err := h.store.Get(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		h.fail(w, err)
		return
	}
	if item.Type == "sdk" {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	if err := h.store.Delete(r.Context(), owner, item.ID); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"success": true})
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid JSON body"})
		return false
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeJSON(w, 400, map[string]string{"error": "request body must contain one JSON value"})
		return false
	}
	return true
}

func (h *Handler) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, integrations.ErrNotFound):
		writeJSON(w, 404, map[string]string{"error": "not found"})
	case errors.Is(err, integrations.ErrInvalid):
		writeJSON(w, 400, map[string]string{"error": "invalid integration"})
	default:
		writeJSON(w, 500, map[string]string{"error": "internal server error"})
	}
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
