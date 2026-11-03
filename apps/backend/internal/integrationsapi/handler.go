// Package integrationsapi exposes authenticated integration instance management.
package integrationsapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

const maxBody = 1 << 20

type Handler struct {
	store *integrations.Store
	auth  resourceapi.Authenticate
	mux   *http.ServeMux
}

func New(store *integrations.Store, authenticate resourceapi.Authenticate) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("integrations API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: authenticate, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/integrations", h.listOrGet)
	h.mux.HandleFunc("POST /api/v1/integrations", h.create)
	h.mux.HandleFunc("PUT /api/v1/integrations/{id}", h.update)
	h.mux.HandleFunc("DELETE /api/v1/integrations/{id}", h.delete)
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
