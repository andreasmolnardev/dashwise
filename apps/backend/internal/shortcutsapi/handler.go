// Package shortcutsapi exposes the existing shortcut endpoints over resources.
package shortcutsapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/shortcuts"
)

const maxBody = 1 << 20

type Handler struct {
	store *shortcuts.Store
	auth  resourceapi.Authenticate
	mux   *http.ServeMux
}

func New(store *shortcuts.Store, auth resourceapi.Authenticate) (http.Handler, error) {
	if store == nil || auth == nil {
		return nil, errors.New("shortcuts API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: auth, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/shortcuts", h.list)
	h.mux.HandleFunc("POST /api/v1/shortcuts/apps", h.createApp)
	h.mux.HandleFunc("PUT /api/v1/shortcuts/on-demand/{appId}", h.syncApp)
	h.mux.HandleFunc("PATCH /api/v1/shortcuts/{id}", h.patch)
	h.mux.HandleFunc("POST /api/v1/shortcuts/usageStats", h.usage)
	h.mux.HandleFunc("GET /api/v1/shortcuts/frequentlyUsed", h.frequent)
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
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.List(r.Context(), owner)
	if err != nil {
		write(w, 500, map[string]string{"error": "could not list shortcuts"})
		return
	}
	write(w, 200, items)
}
func (h *Handler) patch(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body map[string]any
	if !decode(w, r, &body) {
		return
	}
	err := h.store.Patch(r.Context(), owner, r.PathValue("id"), body)
	if err != nil {
		h.fail(w, err)
		return
	}
	write(w, 200, map[string]bool{"success": true})
}
func (h *Handler) usage(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		ID        string `json:"id"`
		Timestamp string `json:"timestamp"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.ID == "" || body.Timestamp == "" {
		write(w, 400, map[string]string{"error": "Missing id or timestamp"})
		return
	}
	if err := h.store.RecordUsage(r.Context(), owner, body.ID, body.Timestamp); err != nil {
		h.fail(w, err)
		return
	}
	write(w, 200, map[string]bool{"success": true})
}
func (h *Handler) frequent(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	write(w, 200, h.store.FrequentlyUsed(r.Context(), owner))
}
func (h *Handler) createApp(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body shortcuts.AppInput
	if !decode(w, r, &body) {
		return
	}
	item, err := h.store.CreateApp(r.Context(), owner, body)
	if err != nil {
		h.fail(w, err)
		return
	}
	write(w, 200, item)
}
func (h *Handler) syncApp(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Shortcuts []shortcuts.OnDemandInput `json:"shortcuts"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Shortcuts == nil {
		write(w, 400, map[string]string{"error": "shortcuts must be an array"})
		return
	}
	result, err := h.store.SyncOnDemand(r.Context(), owner, r.PathValue("appId"), body.Shortcuts)
	if err != nil {
		h.fail(w, err)
		return
	}
	write(w, 200, result)
}
func (h *Handler) fail(w http.ResponseWriter, err error) {
	if errors.Is(err, shortcuts.ErrNotFound) {
		write(w, 404, map[string]string{"error": "not found"})
		return
	}
	if errors.Is(err, shortcuts.ErrInvalid) {
		write(w, 400, map[string]string{"error": "invalid shortcut input"})
		return
	}
	write(w, 500, map[string]string{"error": "shortcut operation failed"})
}
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil && !errors.Is(err, io.EOF) {
		write(w, 400, map[string]string{"error": "invalid JSON request body"})
		return false
	}
	var trailing any
	if !errors.Is(dec.Decode(&trailing), io.EOF) {
		write(w, 400, map[string]string{"error": "request body must contain one JSON value"})
		return false
	}
	return true
}
func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
