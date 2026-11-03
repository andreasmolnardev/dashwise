// Package activitiesapi exposes the authenticated Activities event API.
package activitiesapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/activities"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

const maxBodyBytes = 100 * 1024

type Handler struct {
	store        *activities.Store
	integrations *integrations.Store
	auth         resourceapi.Authenticate
	mux          *http.ServeMux
	mu           sync.Mutex
	limits       map[string]rateWindow
}
type rateWindow struct {
	started time.Time
	count   int
}

func New(store *activities.Store, authenticate resourceapi.Authenticate, integrationStores ...*integrations.Store) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("activities API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: authenticate, mux: http.NewServeMux(), limits: map[string]rateWindow{}}
	if len(integrationStores) > 0 {
		h.integrations = integrationStores[0]
	}
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
