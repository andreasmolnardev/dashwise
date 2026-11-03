// Package consumersapi adapts configured YAML integrations into the existing
// Widgets, Glanceables, and consumerData frontend contracts.
package consumersapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/yamlruntime"
)

const maxBodyBytes = 1 << 20

type Handler struct {
	store   *integrations.Store
	auth    resourceapi.Authenticate
	runtime *yamlruntime.Runtime
	mux     *http.ServeMux
}

func New(store *integrations.Store, authenticate resourceapi.Authenticate, runtime *yamlruntime.Runtime) (http.Handler, error) {
	if store == nil || authenticate == nil || runtime == nil {
		return nil, errors.New("consumer API requires integration storage, auth, and YAML runtime")
	}
	h := &Handler{store: store, auth: authenticate, runtime: runtime, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/widgets", h.widgets)
	h.mux.HandleFunc("GET /api/v1/glanceables", h.glanceables)
	h.mux.HandleFunc("GET /api/v1/glanceables/glanceable", h.glanceables)
	h.mux.HandleFunc("GET /api/v1/widgets/glanceable", h.glanceables)
	h.mux.HandleFunc("GET /api/v1/widgets/glanceables", h.glanceables)
	h.mux.HandleFunc("GET /api/v1/widgets/by-integration", h.widgetIntegration)
	h.mux.HandleFunc("GET /api/v1/glanceables/by-integration", h.glanceableIntegration)
	h.mux.HandleFunc("GET /api/v1/integrations/widget-properties", h.widgetProperties)
	h.mux.HandleFunc("GET /api/v1/integrations/consumerData", h.consumerGet)
	h.mux.HandleFunc("POST /api/v1/integrations/consumerData", h.consumerPost)
	return h.mux, nil
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		write(w, 401, map[string]string{"error": "authentication required"})
		return "", false
	}
	return owner, true
}
func (h *Handler) widgets(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	out := builtinWidgetCatalog()
	list, err := h.store.List(r.Context(), owner, false)
	if err != nil {
		writeError(w, 500, "could not load widget integrations")
		return
	}
	for _, item := range list {
		cfg := object(item.Config)
		configuration := object(cfg["configuration"])
		entries := array(configuration["widgets"])
		if len(entries) == 0 {
			continue
		}
		name := slug(stringValue(object(cfg["details"])["name"]))
		if name == "" {
			name = slug(item.Name)
		}
		category := "integration-" + name
		if out[category] == nil {
			out[category] = []map[string]any{}
		}
		for _, raw := range entries {
			entry := object(raw)
			key := consumerKey(entry)
			if key == "" {
				continue
			}
			if containsWidget(out[category], key) {
				continue
			}
			value := normalizeWidget(entry)
			value["integrationId"] = item.ID
			out[category] = append(out[category], value)
		}
	}
	for key := range out {
		sort.SliceStable(out[key], func(i, j int) bool {
			ai, _ := out[key][i]["index"].(float64)
			aj, _ := out[key][j]["index"].(float64)
			if ai == 0 {
				return false
			}
			if aj == 0 {
				return true
			}
			return ai < aj
		})
	}
	write(w, 200, out)
}
func (h *Handler) glanceables(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	result := builtinGlanceables()
	list, err := h.store.List(r.Context(), owner, false)
	if err != nil {
		writeError(w, 500, "could not load glanceables")
		return
	}
	seen := map[string]bool{}
	for _, g := range result {
		seen[strings.ToLower(stringValue(g["type"]))] = true
	}
	for _, item := range list {
		cfg := object(item.Config)
		entries := array(object(cfg["configuration"])["glanceables"])
		name := first(stringValue(object(cfg["details"])["name"]), item.Name, item.ID)
		for _, raw := range entries {
			entry := object(raw)
			key := consumerKey(entry)
			if key == "" {
				key = slug(stringValue(entry["name"]))
			}
			if key == "" {
				continue
			}
			typeName := item.ID + "#" + key
			if seen[strings.ToLower(typeName)] {
				continue
			}
			seen[strings.ToLower(typeName)] = true
			value := normalizeGlanceable(entry)
			value["type"] = typeName
			value["integrationId"] = item.ID
			value["integrationName"] = name
			value["integrationDisplayName"] = name
			value["appName"] = name
			result = append(result, value)
		}
	}
	write(w, 200, result)
}
func (h *Handler) widgetIntegration(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	key := strings.TrimSpace(r.URL.Query().Get("widgetKey"))
	if key == "" {
		writeError(w, 400, "missing widgetKey")
		return
	}
	integration, entry, found := h.findConsumer(r, owner, "widget", key)
	if !found {
		write(w, 200, map[string]any{"integration": nil, "widget": nil})
		return
	}
	write(w, 200, map[string]any{"integrationId": integration.ID, "integration": integration.Config, "widget": merge(entry, map[string]any{"key": consumerKey(entry)})})
}
func (h *Handler) glanceableIntegration(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	key := strings.TrimSpace(r.URL.Query().Get("glanceableType"))
	if key == "" {
		writeError(w, 400, "missing glanceableType")
		return
	}
	integration, entry, found := h.findConsumer(r, owner, "glanceable", key)
	if !found {
		write(w, 200, map[string]any{"integration": nil, "glanceable": nil})
		return
	}
	write(w, 200, map[string]any{"integrationId": integration.ID, "integration": integration.Config, "glanceable": merge(entry, map[string]any{"type": consumerKey(entry)})})
}
func (h *Handler) widgetProperties(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	key := strings.TrimSpace(r.URL.Query().Get("widgetSlug"))
	if key == "" {
		writeError(w, 400, "Missing widget slug")
		return
	}
	integration, entry, found := h.findConsumer(r, owner, "widget", key)
	if !found {
		write(w, 200, map[string]any{"widget": nil, "integration": nil})
		return
	}
	entry["slug"] = consumerKey(entry)
	write(w, 200, map[string]any{"widget": entry, "integration": map[string]any{"id": integration.ID, "name": integration.Name}})
}

func (h *Handler) consumerGet(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	props := map[string]any{}
	if raw := r.URL.Query().Get("input"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &props)
	}
	h.consumer(w, r, key, stringValue(r.URL.Query().Get("type")), props, map[string]string{}, false)
}
func (h *Handler) consumerPost(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	defer r.Body.Close()
	var body struct {
		Key                  string            `json:"key"`
		Type                 string            `json:"type"`
		Properties           map[string]any    `json:"properties"`
		EnvironmentOverrides map[string]string `json:"environmentOverrides"`
		IsPreview            bool              `json:"isPreview"`
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&body); err != nil {
		writeError(w, 400, "invalid request body")
		return
	}
	h.consumer(w, r, strings.TrimSpace(body.Key), body.Type, body.Properties, body.EnvironmentOverrides, body.IsPreview)
}
func (h *Handler) consumer(w http.ResponseWriter, r *http.Request, key, kind string, properties map[string]any, overrides map[string]string, preview bool) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if key == "" {
		writeError(w, 400, "Missing key")
		return
	}
	if kind != "glanceable" {
		kind = "widget"
	}
	integration, entry, found := h.findConsumer(r, owner, kind, key)
	if !found {
		writeError(w, 404, "Integration consumer not found")
		return
	}
	environment := cloneEnv(integration.Environment)
	for k, v := range overrides {
		if len(k) < 128 && len(v) < 4096 {
			environment[k] = v
		}
	}
	config := object(integration.Config)
	configuration := object(config["configuration"])
	envDefs := object(configuration["environment_variables"])
	for name, def := range envDefs {
		if environment[name] == "" {
			if value, ok := object(def)["default"]; ok {
				environment[name] = fmt.Sprint(value)
			}
		}
	}
	result, err := h.runtime.Execute(r.Context(), config, environment)
	if err != nil {
		writeError(w, 502, "integration data could not be resolved")
		return
	}
	data := result.Computed
	if data == nil {
		data = map[string]any{}
	}
	for id, endpoint := range result.Endpoints {
		if _, exists := object(data)[id]; !exists {
			object(data)[id] = endpoint.MappedResponse
		}
	}
	input := merge(properties, object(object(entry["data"])["input"]))
	widgetJSON := applyInput(entry, input)
	resolved := object(entry["properties"])
	if resolved == nil {
		resolved = map[string]any{}
	}
	for k, v := range input {
		if _, ok := resolved[k]; ok {
			resolved[k] = v
		}
	}
	payload := map[string]any{"consumer": kind, "key": key, "integrationId": integration.ID, "data": data, "blueprint": map[string]any{"template": first(stringValue(entry["template"]), "columns"), "resolved": resolved, "widgetJSON": widgetJSON}, "fresh": nil}
	if !preview {
		payload["cache"] = map[string]any{"fresh": true, "stale": false}
	}
	write(w, 200, payload)
}

func (h *Handler) findConsumer(r *http.Request, owner, kind, key string) (integrations.Integration, map[string]any, bool) {
	list, err := h.store.List(r.Context(), owner, false)
	if err != nil {
		return integrations.Integration{}, nil, false
	}
	wantedID, wantedKey := splitComposite(key)
	for _, item := range list {
		if wantedID != "" && item.ID != wantedID {
			continue
		}
		config := object(item.Config)
		name := stringValue(object(config["details"])["name"])
		section := "widgets"
		if kind == "glanceable" {
			section = "glanceables"
		}
		for _, raw := range array(object(config["configuration"])[section]) {
			entry := object(raw)
			candidate := consumerKey(entry)
			if candidate == "" {
				candidate = slug(stringValue(entry["name"]))
			}
			if normalizeKey(candidate) == normalizeKey(wantedKey) || kind == "glanceable" && normalizeKey(stringValue(entry["type"])) == normalizeKey(wantedKey) {
				if item.Name == "" {
					item.Name = name
				}
				return item, entry, true
			}
		}
	}
	return integrations.Integration{}, nil, false
}

func builtinWidgetCatalog() map[string][]map[string]any {
	items := []map[string]any{{"key": "main-clock", "name": "Glanceable Clock", "template": "glanceable-clock", "properties": map[string]any{}}, {"key": "search-bar", "name": "Search Bar", "template": "search-bar", "properties": map[string]any{}}, {"key": "shortcuts", "name": "Shortcuts", "template": "columns", "properties": map[string]any{}, "data": map[string]any{"input": map[string]any{"shortcutIds": []any{}}}}, {"key": "link-view", "name": "Link View", "template": "link-view", "properties": map[string]any{}}, {"key": "latest-links", "name": "Latest Links", "template": "latest-links", "properties": map[string]any{}, "data": map[string]any{"input": map[string]any{"maxItems": 8, "title": "Latest Links"}}}, {"key": "placeholder", "name": "Placeholder", "template": "placeholder", "properties": map[string]any{}}, {"key": "calendar-week", "name": "Weekly view", "template": "calendar-week", "properties": map[string]any{}}, {"key": "calendar-today", "name": "Today's date", "template": "calendar-today", "properties": map[string]any{}}, {"key": "calendar-upcoming", "name": "Upcoming events", "template": "calendar-upcoming", "properties": map[string]any{}}, {"key": "rss-feed", "name": "Latest RSS Articles", "template": "rss-feed", "properties": map[string]any{}, "data": map[string]any{"input": map[string]any{"feedId": "all", "maxItems": 8, "title": "Latest Articles"}}}, {"key": "countdown", "name": "Countdown", "template": "countdown", "properties": map[string]any{}}, {"key": "iframe", "name": "Iframe", "template": "iframe", "properties": map[string]any{}}, {"key": "image", "name": "Image", "template": "image", "properties": map[string]any{}}, {"key": "progress", "name": "Progress", "template": "progress", "properties": map[string]any{}}}
	return map[string][]map[string]any{"default": items}
}
func builtinGlanceables() []map[string]any {
	return []map[string]any{{"type": "date", "displayName": "Date", "exampleProps": map[string]any{}, "integrationName": "Builtin", "appName": "Builtin"}, {"type": "greeting", "displayName": "Greeting", "exampleProps": map[string]any{}, "integrationName": "Builtin", "appName": "Builtin"}, {"type": "local-timezone", "displayName": "Local Timezone", "exampleProps": map[string]any{}, "integrationName": "Builtin", "appName": "Builtin"}, {"type": "world-clock", "displayName": "World Clock", "exampleProps": map[string]any{}, "integrationName": "Builtin", "appName": "Builtin"}, {"type": "activity-stream", "displayName": "Activity Stream", "description": "Recent activity from integrations and Dashwise.", "exampleProps": map[string]any{"limit": 10}, "integrationName": "Builtin", "appName": "Builtin"}, {"type": "latest-activities", "displayName": "Latest Activities", "exampleProps": map[string]any{}, "integrationName": "Builtin", "appName": "Builtin"}}
}
func normalizeWidget(in map[string]any) map[string]any {
	key := consumerKey(in)
	name := first(stringValue(in["name"]), "Integration Widget")
	properties := object(in["properties"])
	if properties == nil {
		properties = map[string]any{}
	}
	return map[string]any{"key": key, "slug": key, "name": name, "description": in["description"], "template": first(stringValue(in["template"]), "columns"), "properties": properties, "data": in["data"], "preview": map[string]any{"template": first(stringValue(in["template"]), "columns"), "properties": properties}}
}
func normalizeGlanceable(in map[string]any) map[string]any {
	name := first(stringValue(in["name"]), stringValue(in["displayName"]), "Glanceable")
	key := first(stringValue(in["key"]), stringValue(in["type"]), slug(name))
	example := object(in["exampleProps"])
	if example == nil {
		example = object(in["properties"])
	}
	if example == nil {
		example = map[string]any{}
	}
	result := map[string]any{"type": key, "displayName": name, "exampleProps": example}
	for _, k := range []string{"description", "properties", "icon", "text", "columns"} {
		if v, ok := in[k]; ok {
			result[k] = v
		}
	}
	return result
}
func applyInput(widget, input map[string]any) map[string]any {
	out := merge(widget, map[string]any{})
	data := object(out["data"])
	if data == nil {
		data = map[string]any{}
	}
	data["input"] = merge(object(data["input"]), input)
	out["data"] = data
	return out
}
func merge(a, b map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}
func object(v any) map[string]any { m, _ := v.(map[string]any); return m }
func array(v any) []any           { a, _ := v.([]any); return a }
func stringValue(v any) string    { s, _ := v.(string); return strings.TrimSpace(s) }
func first(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
func slug(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	v = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(v, "-")
	return strings.Trim(v, "-")
}
func consumerKey(in map[string]any) string {
	return first(stringValue(in["key"]), stringValue(in["slug"]), slug(stringValue(in["name"])), stringValue(in["type"]))
}
func splitComposite(v string) (string, string) {
	parts := strings.SplitN(v, "#", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", v
}
func normalizeKey(v string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(v, "integration-")))
}
func containsWidget(list []map[string]any, key string) bool {
	for _, item := range list {
		if normalizeKey(stringValue(item["key"])) == normalizeKey(key) {
			return true
		}
	}
	return false
}
func cloneEnv(input map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range input {
		out[k] = v
	}
	return out
}
func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	write(w, status, map[string]string{"error": message})
}
func (h *Handler) decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	defer r.Body.Close()
	d := json.NewDecoder(r.Body)
	if err := d.Decode(dst); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, 400, "invalid request body")
		return false
	}
	return true
}
