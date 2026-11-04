// Package sdkintegrationsapi exposes installed SDK providers and owner-scoped
// instances using the contract consumed by the retained React settings UI.
package sdkintegrationsapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/jsruntime"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/sdkmanager"
)

const maxBodyBytes = 1 << 20

type Handler struct {
	store         *integrations.Store
	manager       *sdkmanager.Manager
	auth          resourceapi.Authenticate
	catalog       map[string]jsruntime.Manifest
	resourceStore *resources.Store
	mux           *http.ServeMux
}

func New(store *integrations.Store, manager *sdkmanager.Manager, authenticate resourceapi.Authenticate, manifests []jsruntime.Manifest, resourceStore *resources.Store) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("SDK integrations API requires a store and authenticator")
	}
	if resourceStore == nil {
		return nil, errors.New("SDK integrations API requires a resource store")
	}
	h := &Handler{store: store, manager: manager, auth: authenticate, catalog: make(map[string]jsruntime.Manifest), resourceStore: resourceStore, mux: http.NewServeMux()}
	for _, manifest := range manifests {
		if manifest.ID != "" {
			h.catalog[manifest.ID] = manifest
		}
	}
	h.mux.HandleFunc("GET /api/v1/sdk-integrations/catalog", h.catalogList)
	h.mux.HandleFunc("GET /api/v1/sdk-integrations/instances", h.instances)
	h.mux.HandleFunc("POST /api/v1/sdk-integrations/instances", h.create)
	h.mux.HandleFunc("GET /api/v1/sdk-integrations/instances/{id}", h.get)
	h.mux.HandleFunc("PATCH /api/v1/sdk-integrations/instances/{id}", h.update)
	h.mux.HandleFunc("DELETE /api/v1/sdk-integrations/instances/{id}", h.delete)
	h.mux.HandleFunc("GET /api/v1/sdk-integrations/instances/{id}/status", h.status)
	h.mux.HandleFunc("POST /api/v1/sdk-integrations/instances/{id}/test-connection", h.testConnection)
	h.mux.HandleFunc("GET /api/v1/sdk-integrations/instances/{id}/resources", h.resources)
	h.mux.HandleFunc("GET /api/v1/sdk-integrations/instances/{id}/contributions/{kind}/{contributionId}", h.contribution)
	h.mux.HandleFunc("POST /api/v1/sdk-integrations/instances/{id}/contributions/{kind}/{contributionId}/resolve", h.resolveContribution)
	h.mux.HandleFunc("POST /api/v1/sdk-integrations/instances/{id}/actions/{actionId}", h.action)
	return h.mux, nil
}

func (h *Handler) catalogList(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.owner(w, r); !ok {
		return
	}
	items := make([]map[string]any, 0, len(h.catalog))
	for _, manifest := range h.catalog {
		items = append(items, publicManifest(manifest))
	}
	sort.Slice(items, func(i, j int) bool { return fmt.Sprint(items[i]["id"]) < fmt.Sprint(items[j]["id"]) })
	writeJSON(w, 200, map[string]any{"integrations": items})
}

func (h *Handler) instances(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.List(r.Context(), owner, true)
	if err != nil {
		writeError(w, 500, "could not load SDK integrations")
		return
	}
	result := make([]map[string]any, 0)
	for _, item := range items {
		if item.Type == "sdk" {
			result = append(result, h.instanceResponse(item))
		}
	}
	writeJSON(w, 200, map[string]any{"instances": result})
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	source := text(body["source"])
	manifest, exists := h.catalog[source]
	if !exists {
		writeError(w, 404, "SDK integration is not installed")
		return
	}
	config, environment, err := normalizeConfig(manifest, object(body["config"]), nil, nil)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	name := text(body["name"])
	if name == "" {
		name = manifest.Name
	}
	enabled := true
	item, err := h.store.Create(r.Context(), owner, integrations.Input{Type: "sdk", Source: source, Name: name, Config: config, Environment: environment, LocalData: map[string]any{}, SDKEnabled: &enabled})
	if err != nil {
		writeError(w, 400, "could not create SDK integration")
		return
	}
	if h.manager != nil {
		// Provider startup awaits real network handshakes; run it detached so
		// finishing this HTTP response does not cancel it midway. Status
		// endpoints surface the eventual result.
		go h.manager.Start(context.WithoutCancel(r.Context()), owner, item.ID)
	}
	writeJSON(w, 201, map[string]any{"instance": h.instanceResponse(item)})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, exists := h.getInstance(w, r, owner)
	if exists {
		writeJSON(w, 200, map[string]any{"instance": h.instanceResponse(item)})
	}
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	current, exists := h.getInstance(w, r, owner)
	if !exists {
		return
	}
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	manifest, installed := h.catalog[current.Source]
	if !installed {
		writeError(w, 404, "SDK integration is not installed")
		return
	}
	name := current.Name
	if value, exists := body["name"]; exists {
		typed, ok := value.(string)
		if !ok {
			writeError(w, 400, "name must be a string")
			return
		}
		name = strings.TrimSpace(typed)
	}
	config, environment := current.Config, current.Environment
	if value, exists := body["config"]; exists {
		incoming, ok := value.(map[string]any)
		if !ok {
			writeError(w, 400, "config must be an object")
			return
		}
		var err error
		config, environment, err = normalizeConfig(manifest, incoming, current.Config, current.Environment)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
	}
	enabled := current.SDKEnabled
	if value, exists := body["enabled"]; exists {
		typed, ok := value.(bool)
		if !ok {
			writeError(w, 400, "enabled must be a boolean")
			return
		}
		enabled = typed
	}
	updated, err := h.store.Update(r.Context(), owner, current.ID, integrations.Input{Type: "sdk", Name: name, Source: current.Source, Config: config, Environment: environment, LocalData: current.LocalData, SDKEnabled: &enabled})
	if err != nil {
		writeError(w, 400, "could not update SDK integration")
		return
	}
	if h.manager != nil {
		if enabled {
			_ = h.manager.Start(r.Context(), owner, current.ID)
		} else {
			_ = h.manager.Stop(r.Context(), owner, current.ID)
		}
	}
	writeJSON(w, 200, map[string]any{"instance": h.instanceResponse(updated)})
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, exists := h.getInstance(w, r, owner)
	if !exists {
		return
	}
	if h.manager != nil {
		_ = h.manager.Stop(r.Context(), owner, item.ID)
	}
	if err := h.store.Delete(r.Context(), owner, item.ID); err != nil {
		writeError(w, 404, "SDK integration instance not found")
		return
	}
	writeJSON(w, 200, map[string]bool{"success": true})
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, exists := h.getInstance(w, r, owner)
	if !exists {
		return
	}
	status := map[string]any{"integrationId": item.ID, "source": item.Source, "state": "stopped"}
	if !item.SDKEnabled {
		status["state"] = "disabled"
	} else if h.manager == nil {
		status["state"] = "error"
		status["message"] = "SDK runtime is not available"
	} else if value, err := h.manager.Status(owner, item.ID); err == nil {
		status = map[string]any{"integrationId": value.IntegrationID, "source": value.Source, "state": value.State, "updatedAt": value.UpdatedAt, "message": value.Message}
	}
	writeJSON(w, 200, map[string]any{"status": status})
}

func (h *Handler) testConnection(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, exists := h.getInstance(w, r, owner)
	if !exists {
		return
	}
	if h.manager == nil {
		writeError(w, 503, "SDK runtime is not available")
		return
	}
	err := h.manager.Start(r.Context(), owner, item.ID)
	status, statusErr := h.manager.Status(owner, item.ID)
	if statusErr != nil {
		writeError(w, 503, "could not load SDK runtime status")
		return
	}
	writeJSON(w, 200, map[string]any{"success": err == nil && status.State == "ready", "status": status})
}

func (h *Handler) resources(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, exists := h.getInstance(w, r, owner)
	if !exists {
		return
	}
	if h.manager == nil {
		writeJSON(w, 200, map[string]any{"resources": []any{}})
		return
	}
	manifest, installed := h.catalog[item.Source]
	if !installed {
		writeError(w, 404, "SDK integration is not installed")
		return
	}
	rows, err := h.manager.Resources(r.Context(), owner, item.ID)
	if err != nil {
		writeError(w, 503, "SDK resources are unavailable")
		return
	}
	collections := queryIDs(r, "collectionIds", "collectionId")
	apps := queryIDs(r, "appIds", "appId")
	ids := queryIDs(r, "resourceIds", "resourceId")
	declaredApps := map[string]bool{}
	for _, app := range manifest.Apps {
		declaredApps[text(app["id"])] = true
	}
	for _, collection := range collections {
		definition := object(manifest.Resources[collection])
		if !boolValue(definition["shortcuts"]) {
			writeError(w, 400, "Unknown Shortcut collection")
			return
		}
	}
	for _, app := range apps {
		if !declaredApps[app] {
			writeError(w, 400, "Unknown integration App")
			return
		}
	}
	out := make([]map[string]any, 0)
	for _, row := range rows {
		collection := strings.TrimPrefix(row.Type, "sdk."+manifest.ID+".")
		if !matches(collections, collection) || !matches(ids, row.ProviderResourceID) || !matchesAny(apps, appIdentifiers(row.Data["apps"])) {
			continue
		}
		value := copyMap(row.Data)
		value["id"] = row.ProviderResourceID
		value["collectionId"] = collection
		value["integrationInstanceId"] = item.ID
		value["updatedAt"] = row.UpdatedAt
		out = append(out, value)
	}
	writeJSON(w, 200, map[string]any{"resources": out})
}

func (h *Handler) contribution(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, exists := h.getInstance(w, r, owner)
	if !exists {
		return
	}
	manifest, installed := h.catalog[item.Source]
	if !installed {
		writeError(w, 404, "SDK integration is not installed")
		return
	}
	kind, id := r.PathValue("kind"), r.PathValue("contributionId")
	contribution := findContribution(manifest, kind, id)
	if contribution == nil {
		writeError(w, 404, "Integration contribution not found")
		return
	}
	writeJSON(w, 200, map[string]any{"contribution": contribution})
}

func (h *Handler) resolveContribution(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, exists := h.getInstance(w, r, owner)
	if !exists {
		return
	}
	manifest, installed := h.catalog[item.Source]
	if !installed {
		writeError(w, 404, "SDK integration is not installed")
		return
	}
	kind, id := r.PathValue("kind"), r.PathValue("contributionId")
	contribution := findContribution(manifest, kind, id)
	if contribution == nil {
		writeError(w, 404, "Integration contribution not found")
		return
	}
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	config, ok := body["config"].(map[string]any)
	if !ok {
		writeError(w, 400, "contribution config must be an object")
		return
	}
	data := map[string]any{}
	schemaRecord := object(contribution["configSchema"])
	schemaFields := object(schemaRecord["properties"])
	if len(schemaFields) == 0 {
		schemaFields = schemaRecord
	}
	for key := range config {
		if _, exists := schemaFields[key]; !exists {
			writeError(w, 400, "Contribution config contains an unknown field")
			return
		}
	}
	required := stringArray(schemaRecord["required"])
	if len(required) == 0 {
		for key, raw := range schemaFields {
			if boolValue(object(raw)["required"]) {
				required = append(required, key)
			}
		}
	}
	for _, key := range required {
		if config[key] == nil && object(schemaFields[key])["default"] == nil {
			writeError(w, 400, "Missing contribution config: "+key)
			return
		}
	}
	// Revisions seed the client's stale-event gate with the owner-scoped
	// change-event sequence baseline for every resource this resolution
	// returned, matching the identities the realtime websocket subscribes to.
	revisions := make([]map[string]any, 0)
	revisionsSeen := map[string]bool{}
	// registerRevision records one resolved resource at most once per
	// identity; absent or ambiguous selections stay out so the client never
	// subscribes to resources the returned data does not reference.
	registerRevision := func(row *resources.Resource) error {
		key := row.Type + "\x00" + row.ProviderResourceID
		if revisionsSeen[key] {
			return nil
		}
		entry, err := h.resourceRevision(r.Context(), owner, item.ID, manifest, row)
		if err != nil {
			return err
		}
		revisionsSeen[key] = true
		revisions = append(revisions, entry)
		return nil
	}
	if h.manager != nil {
		rows, err := h.manager.Resources(r.Context(), owner, item.ID)
		if err != nil {
			writeError(w, 503, "SDK resources are unavailable")
			return
		}
		bindings := object(contribution["resourceBindings"])
		for output, raw := range bindings {
			binding := object(raw)
			configKey := text(binding["configKey"])
			selected := config[configKey]
			field := object(schemaFields[configKey])
			collectionIDs := stringArray(field["collectionIds"])
			appIDs := stringArray(field["appIds"])
			if boolValue(field["multiple"]) {
				ids := stringArray(selected)
				found := make([]map[string]any, 0)
				for _, id := range ids {
					if resource, row, ok := resolveResource(rows, manifest, id, collectionIDs, appIDs); ok {
						found = append(found, resource)
						if err := registerRevision(row); err != nil {
							writeError(w, 503, "SDK resource revisions are unavailable")
							return
						}
					}
				}
				data[output] = found
			} else if selectedID, ok := selected.(string); ok && selectedID != "" {
				if resource, row, found := resolveResource(rows, manifest, selectedID, collectionIDs, appIDs); found {
					data[output] = resource
					if err := registerRevision(row); err != nil {
						writeError(w, 503, "SDK resource revisions are unavailable")
						return
					}
				} else {
					data[output] = nil
				}
			} else {
				data[output] = nil
			}
		}
	}
	// Bindings resolve from a Go map; order the seeded revisions so repeated
	// resolutions with the same selections yield a stable payload.
	sort.Slice(revisions, func(i, j int) bool {
		left, right := revisions[i], revisions[j]
		if left["collectionId"] != right["collectionId"] {
			return left["collectionId"].(string) < right["collectionId"].(string)
		}
		return left["resourceId"].(string) < right["resourceId"].(string)
	})
	writeJSON(w, 200, map[string]any{"data": data, "revisions": revisions})
}

func (h *Handler) action(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, exists := h.getInstance(w, r, owner)
	if !exists {
		return
	}
	if h.manager == nil {
		writeError(w, 503, "SDK runtime is not available")
		return
	}
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	collection, resourceID := text(body["collectionId"]), text(body["resourceId"])
	if collection == "" || resourceID == "" {
		writeError(w, 400, "A resource collection and resource id are required")
		return
	}
	resource := map[string]any{"collectionId": collection, "resourceId": resourceID}
	result, err := h.manager.ExecuteAction(r.Context(), owner, item.ID, r.PathValue("actionId"), resource, body["input"])
	if err != nil {
		writeError(w, 502, "SDK action failed")
		return
	}
	writeJSON(w, 200, map[string]any{"result": result})
}

func (h *Handler) getInstance(w http.ResponseWriter, r *http.Request, owner string) (integrations.Integration, bool) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, 404, "not found")
		return integrations.Integration{}, false
	}
	item, err := h.store.Get(r.Context(), owner, id)
	if err != nil || item.Type != "sdk" {
		writeError(w, 404, "not found")
		return integrations.Integration{}, false
	}
	return item, true
}

func (h *Handler) instanceResponse(item integrations.Integration) map[string]any {
	manifest := h.catalog[item.Source]
	config := make(map[string]any)
	configured := make([]string, 0)
	for key, fieldRaw := range manifest.Config {
		field := object(fieldRaw)
		if text(field["type"]) != "secret" {
			if value, exists := item.Config[key]; exists {
				config[key] = value
			} else if field["default"] != nil {
				config[key] = field["default"]
			}
		}
	}
	for key, value := range item.Environment {
		if value != "" {
			configured = append(configured, key)
		}
	}
	sort.Strings(configured)
	return map[string]any{"id": item.ID, "source": item.Source, "name": item.Name, "userId": item.UserID, "enabled": item.SDKEnabled, "config": config, "configuredSecrets": configured, "created": item.Created, "updated": item.Updated}
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		writeError(w, 401, "authentication required")
		return "", false
	}
	return owner, true
}

func normalizeConfig(manifest jsruntime.Manifest, incoming, current map[string]any, currentSecrets map[string]string) (map[string]any, map[string]string, error) {
	config, secrets := copyMap(current), copyStrings(currentSecrets)
	for key, fieldRaw := range manifest.Config {
		field := object(fieldRaw)
		if _, exists := config[key]; !exists && field["default"] != nil && text(field["type"]) != "secret" {
			config[key] = field["default"]
		}
	}
	for key, value := range incoming {
		field, known := manifest.Config[key].(map[string]any)
		if !known {
			return nil, nil, fmt.Errorf("unknown SDK configuration field %q", key)
		}
		typeName := text(field["type"])
		if typeName == "secret" {
			secret, ok := value.(string)
			if !ok {
				return nil, nil, fmt.Errorf("secret configuration %q must be a string", key)
			}
			if secret == "" {
				delete(secrets, key)
			} else {
				secrets[key] = secret
			}
			delete(config, key)
			continue
		}
		if _, err := json.Marshal(value); err != nil {
			return nil, nil, fmt.Errorf("invalid SDK configuration field %q", key)
		}
		if typeName == "string" || typeName == "url" || typeName == "enum" {
			stringValue, ok := value.(string)
			if !ok {
				return nil, nil, fmt.Errorf("configuration %q must be a string", key)
			}
			if typeName == "url" {
				parsed, err := url.Parse(stringValue)
				if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
					return nil, nil, fmt.Errorf("configuration %q must be a valid HTTP URL", key)
				}
			}
			if typeName == "enum" {
				valid := false
				if options, ok := field["options"].([]any); ok {
					for _, option := range options {
						if option == value || object(option)["value"] == value {
							valid = true
						}
					}
				}
				if !valid {
					return nil, nil, fmt.Errorf("configuration %q has an unsupported value", key)
				}
			}
		}
		if typeName == "boolean" {
			if _, ok := value.(bool); !ok {
				return nil, nil, fmt.Errorf("configuration %q must be a boolean", key)
			}
		}
		if typeName == "number" {
			if _, ok := value.(float64); !ok {
				return nil, nil, fmt.Errorf("configuration %q must be a number", key)
			}
		}
		config[key] = value
	}
	for key, fieldRaw := range manifest.Config {
		field := object(fieldRaw)
		if !boolValue(field["required"]) {
			continue
		}
		value, exists := config[key]
		missing := !exists || value == nil
		if text(field["type"]) == "secret" {
			missing = strings.TrimSpace(secrets[key]) == ""
		} else if stringValue, ok := value.(string); ok {
			missing = strings.TrimSpace(stringValue) == ""
		}
		if missing {
			return nil, nil, fmt.Errorf("missing required SDK configuration: %s", key)
		}
	}
	return config, secrets, nil
}

func publicManifest(m jsruntime.Manifest) map[string]any {
	config := map[string]any{}
	for key, raw := range m.Config {
		field := copyMap(object(raw))
		if text(field["type"]) == "secret" {
			delete(field, "default")
		}
		config[key] = field
	}
	return map[string]any{"id": m.ID, "name": m.Name, "version": m.Version, "description": m.Description, "config": config, "resources": m.Resources, "apps": m.Apps, "activities": m.Activities, "widgets": m.Widgets, "glanceables": m.Glanceables, "actions": m.Actions}
}

func findContribution(m jsruntime.Manifest, kind, id string) map[string]any {
	var rows []map[string]any
	switch kind {
	case "widget":
		rows = m.Widgets
	case "glanceable":
		rows = m.Glanceables
	default:
		return nil
	}
	for _, row := range rows {
		if text(row["id"]) == id {
			return row
		}
	}
	return nil
}

func resolveResource(rows []resources.Resource, manifest jsruntime.Manifest, id string, collections, apps []string) (map[string]any, *resources.Resource, bool) {
	var found *resources.Resource
	for i := range rows {
		row := &rows[i]
		if row.ProviderResourceID != id {
			continue
		}
		collection := strings.TrimPrefix(row.Type, "sdk."+manifest.ID+".")
		definition := object(manifest.Resources[collection])
		if !boolValue(definition["shortcuts"]) || !matches(collections, collection) || !matchesAny(apps, appIdentifiers(row.Data["apps"])) {
			continue
		}
		if found != nil {
			return nil, nil, false
		}
		found = row
	}
	if found == nil {
		return nil, nil, false
	}
	value := copyMap(found.Data)
	value["id"] = found.ProviderResourceID
	return value, found, true
}

// resourceRevision builds the revision-baseline entry for one owner-scoped
// resource row. The revision is the highest change-event sequence already
// recorded for the identity, exactly the counter the realtime websocket emits
// in sdk:resource-revision messages.
func (h *Handler) resourceRevision(ctx context.Context, owner, instanceID string, manifest jsruntime.Manifest, row *resources.Resource) (map[string]any, error) {
	revision, err := h.resourceStore.LatestRevision(ctx, owner, row.Type, instanceID, row.ProviderResourceID)
	if err != nil {
		return nil, err
	}
	collection := strings.TrimPrefix(row.Type, "sdk."+manifest.ID+".")
	return map[string]any{
		"instanceId":   instanceID,
		"collectionId": collection,
		"resourceId":   row.ProviderResourceID,
		"revision":     revision,
	}, nil
}

func readBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var body map[string]any
	if err := decoder.Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON body")
		return nil, false
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		writeError(w, 400, "body must contain one JSON value")
		return nil, false
	}
	if body == nil {
		writeError(w, 400, "body must be an object")
		return nil, false
	}
	return body, true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func object(value any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return map[string]any{}
}
func copyMap(value map[string]any) map[string]any {
	result := make(map[string]any, len(value))
	for key, item := range value {
		result[key] = item
	}
	return result
}
func copyStrings(value map[string]string) map[string]string {
	result := make(map[string]string, len(value))
	for key, item := range value {
		result[key] = item
	}
	return result
}
func text(value any) string    { result, _ := value.(string); return strings.TrimSpace(result) }
func boolValue(value any) bool { result, _ := value.(bool); return result }
func stringArray(value any) []string {
	result := []string{}
	if items, ok := value.([]any); ok {
		for _, item := range items {
			if text := text(item); text != "" {
				result = append(result, text)
			}
		}
	}
	return result
}
func appIdentifiers(value any) []string { return stringArray(value) }
func queryIDs(r *http.Request, plural, singular string) []string {
	values := append(r.URL.Query()[plural], r.URL.Query()[singular]...)
	output := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part != "" && !seen[part] {
				seen[part] = true
				output = append(output, part)
			}
		}
	}
	if len(output) > 200 {
		output = output[:200]
	}
	return output
}
func matches(filter []string, value string) bool {
	if len(filter) == 0 {
		return true
	}
	for _, want := range filter {
		if want == value {
			return true
		}
	}
	return false
}
func matchesAny(filter, values []string) bool {
	if len(filter) == 0 {
		return true
	}
	for _, want := range filter {
		for _, value := range values {
			if want == value {
				return true
			}
		}
	}
	return false
}
