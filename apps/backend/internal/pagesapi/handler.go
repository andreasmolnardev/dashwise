// Package pagesapi exposes saved pages and dashboard view configurations.
package pagesapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/pages"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

const maxBody = 1 << 20

type Handler struct {
	store *pages.Store
	auth  resourceapi.Authenticate
	mux   *http.ServeMux
}

func New(store *pages.Store, authenticate resourceapi.Authenticate) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("pages API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: authenticate, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/pageConfig", h.get)
	h.mux.HandleFunc("PUT /api/v1/pageConfig", h.put)
	h.mux.HandleFunc("GET /api/v1/pageConfig/user-pages", h.list)
	h.mux.HandleFunc("POST /api/v1/pageConfig/home", h.createHome)
	h.mux.HandleFunc("POST /api/v1/pageConfig/migrate-legacy", h.migrateLegacy)
	h.mux.HandleFunc("POST /api/v1/pageConfig/integrationData", h.integrationData)
	return h.mux, nil
}
func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		writeJSON(w, 401, map[string]string{"error": "authentication required"})
		return "", false
	}
	return owner, true
}
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	page := r.URL.Query().Get("pageName")
	if page == "" {
		page = "home"
	}
	record, err := h.store.Get(r.Context(), owner, page)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "could not load page"})
		return
	}
	writeJSON(w, 200, record.Config)
}
func (h *Handler) put(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		PageName string         `json:"pageName"`
		Config   map[string]any `json:"config"`
	}
	if !decode(w, r, &body) {
		return
	}
	page := body.PageName
	if page == "" {
		page = "home"
	}
	record, err := h.store.Put(r.Context(), owner, page, body.Config)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid page configuration"})
		return
	}
	writeJSON(w, 200, record.Config)
}
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.List(r.Context(), owner)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "could not list pages"})
		return
	}
	writeJSON(w, 200, items)
}
func (h *Handler) createHome(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	existing, err := h.store.Get(r.Context(), owner, "home")
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "could not load home page"})
		return
	}
	if existing.Config != nil {
		writeJSON(w, 200, map[string]any{"success": true, "created": false, "config": existing.Config})
		return
	}
	config := map[string]any{"template": "main", "columns": map[string]any{
		"left":   map[string]any{"placeholder": map[string]any{"height": "$main-clock"}},
		"middle": map[string]any{"main-clock": map[string]any{"index": 0, "glanceables": map[string]any{"date": nil, "weather": nil}}, "search-bar": map[string]any{"index": 1}, "link-view": map[string]any{"index": 2}},
		"right":  map[string]any{"placeholder": map[string]any{"height": "$main-clock"}},
	}}
	record, err := h.store.Put(r.Context(), owner, "home", config)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "could not create home page"})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "created": true, "config": record.Config})
}
func (h *Handler) migrateLegacy(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.owner(w, r); !ok {
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "result": map[string]any{"migrated": 0}})
}
func (h *Handler) integrationData(w http.ResponseWriter, r *http.Request) {
	_, ok := h.owner(w, r)
	if !ok {
		return
	}
	page := r.URL.Query().Get("page")
	if page == "" {
		page = "home"
	}
	writeJSON(w, 200, map[string]any{"success": true, "pageName": page, "items": []any{}})
}
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, 400, map[string]string{"error": "invalid request body"})
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
