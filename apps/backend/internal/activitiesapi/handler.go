// Package activitiesapi exposes the authenticated Activities event API.
package activitiesapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/activities"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/notifications"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

const maxBodyBytes = 100 * 1024

type Handler struct {
	store         *activities.Store
	integrations  *integrations.Store
	notifications *notifications.Store
	resources     *resources.Store
	registry      *resources.Registry
	manifests     []activities.SDKManifest
	auth          resourceapi.Authenticate
	mux           *http.ServeMux
	mu            sync.Mutex
	limits        map[string]rateWindow
}
type rateWindow struct {
	started time.Time
	count   int
}

func New(store *activities.Store, authenticate resourceapi.Authenticate, integrationStores ...*integrations.Store) (http.Handler, error) {
	var integrationStore *integrations.Store
	if len(integrationStores) > 0 {
		integrationStore = integrationStores[0]
	}
	return NewWithDefinitions(store, authenticate, integrationStore, nil, nil, nil)
}

func NewWithDefinitions(store *activities.Store, authenticate resourceapi.Authenticate, integrationStore *integrations.Store, notificationStore *notifications.Store, resourceStore *resources.Store, registry *resources.Registry, manifests ...activities.SDKManifest) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("activities API requires a store and authenticator")
	}
	h := &Handler{store: store, integrations: integrationStore, notifications: notificationStore, resources: resourceStore, registry: registry, manifests: append([]activities.SDKManifest(nil), manifests...), auth: authenticate, mux: http.NewServeMux(), limits: map[string]rateWindow{}}
	h.mux.HandleFunc("GET /api/v1/activities/definitions", h.definitions)
	h.mux.HandleFunc("PATCH /api/v1/activities/definitions/{id}", h.patchDefinition)
	h.mux.HandleFunc("POST /api/v1/activities/definitions/resource-conditions", h.createResourceCondition)
	h.mux.HandleFunc("DELETE /api/v1/activities/definitions/resource-conditions/{conditionId}", h.deleteResourceCondition)
	h.mux.HandleFunc("GET /api/v1/activities", h.list)
	h.mux.HandleFunc("POST /api/v1/activities", h.publish)
	h.mux.HandleFunc("GET /api/v1/activities/{id}", h.get)
	h.mux.HandleFunc("DELETE /api/v1/activities/{id}", h.delete)
	h.mux.HandleFunc("POST /api/v1/integrations/{integrationId}/activities", h.integrationActivity)
	return h.mux, nil
}
func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return "", false
	}
	return owner, true
}

func (h *Handler) definitions(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	settings, err := h.store.DefinitionSettings(r.Context(), owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load activity definitions")
		return
	}
	if h.resources != nil && h.registry != nil {
		for _, condition := range settings.Conditions {
			if err := activities.ReconcileResourceConditionSnapshot(r.Context(), h.store, h.notifications, owner, condition, h.resources, h.registry); err != nil {
				writeError(w, http.StatusInternalServerError, "could not reconcile resource activity conditions")
				return
			}
		}
	}
	definitions, err := activities.ListDefinitionViews(r.Context(), h.store, owner, h.notifications, h.integrations, h.manifests)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load activity definitions")
		return
	}
	catalog, err := h.resourceCatalog(r.Context(), owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the resource catalog")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"definitions": definitions, "resourceCatalog": catalog})
}

func (h *Handler) patchDefinition(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Enabled *bool          `json:"enabled"`
		Config  map[string]any `json:"config"`
	}
	if !decode(w, r, &body) {
		return
	}
	definition, err := activities.SaveDefinitionPreference(r.Context(), h.store, h.notifications, owner, r.PathValue("id"), body.Enabled, body.Config, h.integrations, h.manifests)
	if err != nil {
		h.writeDefinitionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"definition": definition})
}

func (h *Handler) createResourceCondition(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if h.integrations == nil || h.resources == nil || h.registry == nil {
		writeError(w, http.StatusServiceUnavailable, "resource activity conditions are unavailable")
		return
	}
	var input map[string]any
	if !decode(w, r, &input) {
		return
	}
	instanceID, _ := input["instanceId"].(string)
	instance, err := h.integrations.Get(r.Context(), owner, strings.TrimSpace(instanceID))
	if errors.Is(err, integrations.ErrNotFound) || err == nil && instance.Type != "sdk" {
		writeError(w, http.StatusNotFound, "SDK integration instance not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load SDK integration instance")
		return
	}
	definition, err := activities.CreateResourceCondition(r.Context(), h.store, h.notifications, h.resources, h.registry, owner, instance.Source, input, h.integrations, h.manifests)
	if err != nil {
		h.writeDefinitionError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"definition": definition})
}

func (h *Handler) deleteResourceCondition(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	deleted, err := activities.DeleteResourceCondition(r.Context(), h.store, owner, r.PathValue("conditionId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete activity condition")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "activity definition not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) resourceCatalog(ctx context.Context, owner string) ([]activities.ActivityResourceCatalogEntry, error) {
	if h.resources == nil || h.registry == nil || h.integrations == nil {
		return []activities.ActivityResourceCatalogEntry{}, nil
	}
	types, err := h.registry.List(ctx)
	if err != nil {
		return nil, err
	}
	instances, err := h.integrations.List(ctx, owner, true)
	if err != nil {
		return nil, err
	}
	ownedSDKInstances := make(map[string]integrations.Integration)
	sdkInstances := make([]integrations.Integration, 0)
	for _, instance := range instances {
		if instance.Type == "sdk" {
			ownedSDKInstances[instance.ID] = instance
			sdkInstances = append(sdkInstances, instance)
		}
	}
	catalog := make([]activities.ActivityResourceCatalogEntry, 0)
	// Include one collection-level entry per owned instance and declared SDK
	// collection so users can define conditions before the first resource sync.
	for _, instance := range sdkInstances {
		for _, definition := range types {
			collectionID, ok := sdkCollectionID(definition.Type, instance.Source)
			if !ok {
				continue
			}
			fields := make([]string, 0, len(definition.Fields))
			for _, field := range definition.Fields {
				fields = append(fields, field.Name)
			}
			sort.Strings(fields)
			name := apiFirstText(definition.Title, collectionID)
			catalog = append(catalog, activities.ActivityResourceCatalogEntry{
				InstanceID: instance.ID, InstanceName: apiFirstText(instance.Name, instance.Source),
				CollectionID: collectionID, Name: name, Fields: fields,
			})
		}
	}
	for _, definition := range types {
		if !strings.HasPrefix(definition.Type, "sdk.") {
			continue
		}
		for offset := 0; ; offset += 200 {
			page, err := h.resources.Query(ctx, resources.Query{OwnerID: owner, Types: []string{definition.Type}, Limit: 200, Offset: offset})
			if err != nil {
				return nil, err
			}
			for _, item := range page.Items {
				instance, exists := ownedSDKInstances[item.ProviderInstanceID]
				if !exists {
					continue
				}
				name := apiTextValue(item.Data["name"])
				if name == "" {
					name = apiTextValue(item.Data["title"])
				}
				if name == "" {
					name = item.ProviderResourceID
				}
				collectionID, ok := sdkCollectionID(definition.Type, instance.Source)
				if !ok {
					continue
				}
				catalog = append(catalog, activities.ActivityResourceCatalogEntry{InstanceID: instance.ID, InstanceName: apiFirstText(instance.Name, instance.Source), CollectionID: collectionID, ResourceID: item.ProviderResourceID, Name: name, Fields: activities.ResourceFieldPaths(item.Data)})
			}
			if len(page.Items) < 200 {
				break
			}
		}
	}
	sort.SliceStable(catalog, func(i, j int) bool {
		left, right := catalog[i], catalog[j]
		if left.InstanceName != right.InstanceName {
			return left.InstanceName < right.InstanceName
		}
		if left.CollectionID != right.CollectionID {
			return left.CollectionID < right.CollectionID
		}
		return left.ResourceID < right.ResourceID
	})
	return catalog, nil
}

func sdkCollectionID(resourceType, source string) (string, bool) {
	prefix := "sdk." + strings.ToLower(strings.TrimSpace(source)) + "."
	if !strings.HasPrefix(strings.ToLower(resourceType), prefix) {
		return "", false
	}
	collection := resourceType[len(prefix):]
	return collection, collection != ""
}

func apiTextValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func apiFirstText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (h *Handler) writeDefinitionError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, activities.ErrNotFound):
		writeError(w, http.StatusNotFound, "activity definition not found")
	case errors.Is(err, activities.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid activity definition")
	default:
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		}
		writeError(w, status, err.Error())
	}
}
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	q := activities.Query{Page: queryInt(r, "page", 1, 1000000), PerPage: queryInt(r, "perPage", 20, 100), Source: r.URL.Query().Get("source"), Type: r.URL.Query().Get("type"), Severity: r.URL.Query().Get("severity")}
	var err error
	if raw := r.URL.Query().Get("from"); raw != "" {
		q.From, err = parseDate(raw)
		if err != nil {
			writeError(w, 400, "invalid from date")
			return
		}
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		q.To, err = parseDate(raw)
		if err != nil {
			writeError(w, 400, "invalid to date")
			return
		}
	}
	if q.Severity != "" && !validSeverity(q.Severity) {
		writeError(w, 400, "invalid severity filter")
		return
	}
	if !q.From.IsZero() && !q.To.IsZero() && q.From.After(q.To) {
		writeError(w, 400, "from must be earlier than or equal to to")
		return
	}
	page, err := h.store.List(r.Context(), owner, q)
	if err != nil {
		writeError(w, 500, "could not list activities")
		return
	}
	writeJSON(w, 200, page)
}
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, err := h.store.Get(r.Context(), owner, r.PathValue("id"))
	if errors.Is(err, activities.ErrNotFound) {
		writeError(w, 404, "activity not found")
		return
	}
	if err != nil {
		writeError(w, 500, "could not load activity")
		return
	}
	writeJSON(w, 200, map[string]any{"activity": item})
}
func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	err := h.store.Delete(r.Context(), owner, r.PathValue("id"))
	if errors.Is(err, activities.ErrNotFound) {
		writeError(w, 404, "activity not found")
		return
	}
	if err != nil {
		writeError(w, 500, "could not delete activity")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (h *Handler) publish(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if !h.allow(owner) {
		writeError(w, 429, "activity publish rate limit exceeded")
		return
	}
	var body publishBody
	if !decode(w, r, &body) {
		return
	}
	record, duplicate, err := h.store.Publish(r.Context(), owner, body.input("dashwise", "", false, ""))
	if errors.Is(err, activities.ErrInvalid) {
		writeError(w, 400, "invalid activity payload")
		return
	}
	if err != nil {
		writeError(w, 500, "could not publish activity")
		return
	}
	status := http.StatusCreated
	if duplicate {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"activity": record, "duplicate": duplicate})
}
func (h *Handler) integrationActivity(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if !h.allow(owner) {
		writeError(w, 429, "activity publish rate limit exceeded")
		return
	}
	var body struct {
		Operation string          `json:"operation"`
		Key       string          `json:"key"`
		Activity  json.RawMessage `json:"activity"`
		publishBody
	}
	if !decode(w, r, &body) {
		return
	}
	integrationID := strings.TrimSpace(r.PathValue("integrationId"))
	if integrationID == "" || len(integrationID) > 200 {
		writeError(w, 400, "invalid integration id")
		return
	}
	if h.integrations == nil {
		writeError(w, http.StatusNotFound, "integration not found")
		return
	}
	if _, err := h.integrations.Get(r.Context(), owner, integrationID); err != nil {
		// Keep absent and foreign-owned IDs indistinguishable to prevent probing.
		writeError(w, http.StatusNotFound, "integration not found")
		return
	}
	if body.Operation == "clear" {
		key := strings.TrimSpace(body.Key)
		if key == "" || len(key) > 256 {
			writeError(w, 400, "activity key must be 1 to 256 characters")
			return
		}
		cleared, err := h.store.Clear(r.Context(), owner, "integration", integrationID, key)
		if err != nil {
			writeError(w, 500, "could not clear activity")
			return
		}
		writeJSON(w, 200, map[string]any{"operation": "clear", "cleared": cleared})
		return
	}
	if body.Operation == "upsert" {
		key := strings.TrimSpace(body.Key)
		if key == "" || len(key) > 256 {
			writeError(w, 400, "activity key must be 1 to 256 characters")
			return
		}
		if len(body.Activity) == 0 || json.Unmarshal(body.Activity, &body.publishBody) != nil {
			writeError(w, 400, "invalid activity payload")
			return
		}
		rec, duplicate, err := h.store.Publish(r.Context(), owner, body.input("integration", integrationID, true, key))
		if errors.Is(err, activities.ErrInvalid) {
			writeError(w, 400, "invalid activity payload")
			return
		}
		if err != nil {
			writeError(w, 500, "could not publish activity")
			return
		}
		status := 201
		if duplicate {
			status = 200
		}
		writeJSON(w, status, map[string]any{"operation": "upsert", "activity": rec, "duplicate": duplicate})
		return
	}
	if len(body.Activity) > 0 {
		if json.Unmarshal(body.Activity, &body.publishBody) != nil {
			writeError(w, 400, "invalid activity payload")
			return
		}
	}
	rec, duplicate, err := h.store.Publish(r.Context(), owner, body.input("integration", integrationID, false, ""))
	if errors.Is(err, activities.ErrInvalid) {
		writeError(w, 400, "invalid activity payload")
		return
	}
	if err != nil {
		writeError(w, 500, "could not publish activity")
		return
	}
	status := 201
	if duplicate {
		status = 200
	}
	writeJSON(w, status, map[string]any{"activity": rec, "duplicate": duplicate})
}

type publishBody struct {
	Type           string             `json:"type"`
	Title          string             `json:"title"`
	Description    string             `json:"description"`
	Severity       string             `json:"severity"`
	EventID        string             `json:"eventId"`
	IdempotencyKey string             `json:"idempotencyKey"`
	OccurredAt     string             `json:"occurredAt"`
	Metadata       map[string]any     `json:"metadata"`
	Action         *activities.Action `json:"action"`
}

func (b publishBody) input(source, sourceID string, current bool, key string) activities.Input {
	occurred, _ := parseDate(b.OccurredAt)
	if key == "" {
		key = b.IdempotencyKey
	}
	return activities.Input{Source: source, SourceID: sourceID, Type: b.Type, Title: b.Title, Description: b.Description, Severity: b.Severity, EventID: b.EventID, IdempotencyKey: key, OccurredAt: occurred, Current: current, Metadata: b.Metadata, Action: b.Action}
}
func (h *Handler) allow(owner string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	w := h.limits[owner]
	if now.Sub(w.started) >= time.Minute {
		w = rateWindow{started: now}
	}
	w.count++
	h.limits[owner] = w
	return w.count <= 120
}
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, 413, "activity payload exceeds the 100 KB limit")
		} else {
			writeError(w, 400, "invalid JSON body")
		}
		return false
	}
	if dec.Decode(new(any)) != io.EOF {
		writeError(w, 400, "request body must contain one JSON value")
		return false
	}
	return true
}
func queryInt(r *http.Request, key string, def, max int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return def
	}
	n, e := strconv.Atoi(raw)
	if e != nil || n < 1 {
		return def
	}
	if n > max {
		return max
	}
	return n
}
func parseDate(raw string) (time.Time, error) {
	if strings.TrimSpace(raw) == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339, raw)
}
func validSeverity(s string) bool {
	return s == "info" || s == "success" || s == "warning" || s == "error"
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
