// Package viewapi exposes authenticated CRUD and evaluation for saved views.
package viewapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/views"
)

type Handler struct {
	views        *views.Store
	resources    *resources.Store
	authenticate resourceapi.Authenticate
}

func New(viewStore *views.Store, resourceStore *resources.Store, authenticate resourceapi.Authenticate) (http.Handler, error) {
	if viewStore == nil || resourceStore == nil || authenticate == nil {
		return nil, errors.New("view API requires view/resource stores and authentication")
	}
	h := &Handler{views: viewStore, resources: resourceStore, authenticate: authenticate}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/views", h.list)
	mux.HandleFunc("POST /api/v1/views", h.create)
	mux.HandleFunc("GET /api/v1/views/{id}", h.get)
	mux.HandleFunc("PUT /api/v1/views/{id}", h.update)
	mux.HandleFunc("DELETE /api/v1/views/{id}", h.delete)
	mux.HandleFunc("GET /api/v1/views/{id}/resources", h.query)
	return mux, nil
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.views.List(r.Context(), owner)
	if err != nil {
		writeError(w, 500, "could not list views")
		return
	}
	writeJSON(w, 200, map[string]any{"views": items})
}
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	input, ok := decode(w, r)
	if !ok {
		return
	}
	item, err := h.views.Create(r.Context(), owner, input.Name, input.Definition)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"view": item})
}
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, err := h.views.Get(r.Context(), owner, r.PathValue("id"))
	if errors.Is(err, views.ErrNotFound) {
		writeError(w, 404, "view not found")
		return
	}
	if err != nil {
		writeError(w, 500, "could not load view")
		return
	}
	writeJSON(w, 200, map[string]any{"view": item})
}
func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	input, ok := decode(w, r)
	if !ok {
		return
	}
	item, err := h.views.Update(r.Context(), owner, r.PathValue("id"), input.Name, input.Definition)
	if errors.Is(err, views.ErrNotFound) {
		writeError(w, 404, "view not found")
		return
	}
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"view": item})
}
func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	err := h.views.Delete(r.Context(), owner, r.PathValue("id"))
	if errors.Is(err, views.ErrNotFound) {
		writeError(w, 404, "view not found")
		return
	}
	if err != nil {
		writeError(w, 500, "could not delete view")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *Handler) query(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	view, err := h.views.Get(r.Context(), owner, r.PathValue("id"))
	if errors.Is(err, views.ErrNotFound) {
		writeError(w, 404, "view not found")
		return
	}
	if err != nil {
		writeError(w, 500, "could not load view")
		return
	}
	var query resources.Query
	if err := json.Unmarshal(view.Definition.Query, &query); err != nil {
		writeError(w, 400, "view query is invalid")
		return
	}
	query.OwnerID = owner
	if rawLimit := r.URL.Query().Get("limit"); rawLimit != "" {
		writeError(w, 400, "view query pagination is defined by the saved view")
		return
	}
	page, err := h.resources.Query(r.Context(), query)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, page)
}

type writeInput struct {
	Name       string           `json:"name"`
	Definition views.Definition `json:"definition"`
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.authenticate(r)
	if err != nil || owner == "" {
		writeError(w, 401, "authentication required")
		return "", false
	}
	return owner, true
}
func decode(w http.ResponseWriter, r *http.Request) (writeInput, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	var in writeInput
	if err := d.Decode(&in); err != nil {
		writeError(w, 400, "invalid view body")
		return in, false
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		writeError(w, 400, "body must contain one JSON value")
		return in, false
	}
	var query resources.Query
	queryDecoder := json.NewDecoder(strings.NewReader(string(in.Definition.Query)))
	queryDecoder.DisallowUnknownFields()
	if err := queryDecoder.Decode(&query); err != nil {
		writeError(w, 400, "view definition requires a valid resource query")
		return in, false
	}
	query.OwnerID = ""
	queryJSON, err := json.Marshal(query)
	if err != nil {
		writeError(w, 400, "view resource query is invalid")
		return in, false
	}
	in.Definition.Query = queryJSON
	return in, true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
