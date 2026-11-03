// Package importexportapi exposes an authenticated migration archive endpoint.
package importexportapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/importexport"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

const maxArchiveBytes = importexport.MaxArchiveBytes

type Handler struct {
	store *importexport.Store
	auth  resourceapi.Authenticate
	mux   *http.ServeMux
}

func New(store *importexport.Store, authenticate resourceapi.Authenticate) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("migration API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: authenticate, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/migration/export", h.export)
	h.mux.HandleFunc("POST /api/v1/migration/import", h.importArchive)
	return h.mux, nil
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return "", false
	}
	return owner, true
}

func (h *Handler) export(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	archive, err := h.store.Export(r.Context(), owner)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not export account data"})
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="dashwise-export.json"`)
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, archive)
}

func (h *Handler) importArchive(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxArchiveBytes)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var archive importexport.Archive
	if err := decoder.Decode(&archive); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid migration archive"})
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "archive must contain one JSON value"})
		return
	}
	result, err := h.store.Import(r.Context(), owner, archive)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
