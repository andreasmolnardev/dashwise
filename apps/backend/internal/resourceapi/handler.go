// Package resourceapi exposes the authenticated HTTP surface for Dashwise
// resources. It does not decide how authentication is implemented; the
// application injects that policy when it wires the handler.
package resourceapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

const maxBodyBytes = 1 << 20
const maxFilterBytes = 4096

// Authenticate must return the authenticated owner ID. Handlers always use
// this value as the owner scope and never accept an owner from client input.
type Authenticate func(*http.Request) (ownerID string, err error)

type Handler struct {
	store        *resources.Store
	registry     *resources.Registry
	authenticate Authenticate
	mux          *http.ServeMux
}

// New registers the resource HTTP routes and returns their handler.
func New(store *resources.Store, registry *resources.Registry, authenticate Authenticate) (http.Handler, error) {
	if store == nil || registry == nil || authenticate == nil {
		return nil, errors.New("resource API requires a store, registry, and authenticator")
	}
	h := &Handler{store: store, registry: registry, authenticate: authenticate, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/resource-types", h.listTypes)
	h.mux.HandleFunc("GET /api/v1/resources", h.queryResources)
	h.mux.HandleFunc("POST /api/v1/resources", h.upsertResource)
	h.mux.HandleFunc("GET /api/v1/resources/{id}", h.getResource)
	h.mux.HandleFunc("DELETE /api/v1/resources/{id}", h.deleteResource)
	return h.mux, nil
}

func (h *Handler) listTypes(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.owner(w, r); !ok {
		return
	}
	types, err := h.registry.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list resource types")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"types": types})
}

func (h *Handler) queryResources(w http.ResponseWriter, r *http.Request) {
	ownerID, ok := h.owner(w, r)
	if !ok {
		return
	}
	query, err := parseQuery(r.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	query.OwnerID = ownerID
	page, err := h.store.Query(r.Context(), query)
	if err != nil {
		if errors.Is(err, resources.ErrTypeNotFound) {
			writeError(w, http.StatusBadRequest, "unknown resource type")
			return
		}
		if isQueryValidationError(err) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "could not query resources")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *Handler) upsertResource(w http.ResponseWriter, r *http.Request) {
	ownerID, ok := h.owner(w, r)
	if !ok {
		return
	}
	var input struct {
		Type               string         `json:"type"`
		Provider           string         `json:"provider"`
		ProviderInstanceID string         `json:"providerInstanceId"`
		ProviderResourceID string         `json:"providerResourceId"`
		Data               map[string]any `json:"data"`
		Capabilities       []string       `json:"capabilities"`
		State              string         `json:"state"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := h.registry.Get(r.Context(), input.Type); err != nil {
		if errors.Is(err, resources.ErrTypeNotFound) {
			writeError(w, http.StatusBadRequest, "unknown resource type")
		} else {
			writeError(w, http.StatusInternalServerError, "could not load resource type")
		}
		return
	}
	resource, err := h.store.Upsert(r.Context(), resources.Resource{
		Type: input.Type, Provider: input.Provider,
		ProviderInstanceID: input.ProviderInstanceID, ProviderResourceID: input.ProviderResourceID,
		OwnerID: ownerID, Data: input.Data, Capabilities: input.Capabilities, State: input.State,
	})
	if err != nil {
		if isInputError(err) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "could not save resource")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"resource": resource})
}

func (h *Handler) getResource(w http.ResponseWriter, r *http.Request) {
	ownerID, ok := h.owner(w, r)
	if !ok {
		return
	}
	resource, err := h.store.Get(r.Context(), ownerID, r.PathValue("id"))
	if errors.Is(err, resources.ErrNotFound) {
		writeError(w, http.StatusNotFound, "resource not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load resource")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"resource": resource})
}

func (h *Handler) deleteResource(w http.ResponseWriter, r *http.Request) {
	ownerID, ok := h.owner(w, r)
	if !ok {
		return
	}
	if err := h.store.Delete(r.Context(), ownerID, r.PathValue("id")); errors.Is(err, resources.ErrNotFound) {
		writeError(w, http.StatusNotFound, "resource not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete resource")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	ownerID, err := h.authenticate(r)
	if err != nil || strings.TrimSpace(ownerID) == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return "", false
	}
	return ownerID, true
}

func parseQuery(values url.Values) (resources.Query, error) {
	query := resources.Query{
		Types: values["type"], Provider: values.Get("provider"),
		InstanceID: values.Get("providerInstanceId"), Capabilities: values["capability"],
		Search: values.Get("search"), OrderBy: values.Get("orderBy"),
		Limit: 50, Offset: 0,
	}
	if len(query.Types) > 16 || len(query.Capabilities) > 32 {
		return resources.Query{}, errors.New("too many resource type or capability filters")
	}
	if raw := values.Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 200 {
			return resources.Query{}, errors.New("limit must be between 1 and 200")
		}
		query.Limit = limit
	}
	if raw := values.Get("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 {
			return resources.Query{}, errors.New("offset must be a non-negative integer")
		}
		query.Offset = offset
	}
	if raw := values.Get("filters"); raw != "" {
		if len(raw) > maxFilterBytes {
			return resources.Query{}, errors.New("filters query is too large")
		}
		if err := json.Unmarshal([]byte(raw), &query.Filters); err != nil {
			return resources.Query{}, errors.New("filters must be a JSON array")
		}
		if len(query.Filters) > 20 {
			return resources.Query{}, errors.New("too many resource filters")
		}
	}
	if len(query.Search) > 256 || len(query.Provider) > 128 || len(query.InstanceID) > 256 {
		return resources.Query{}, errors.New("resource query parameter is too long")
	}
	return query, nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func isInputError(err error) bool {
	if errors.Is(err, resources.ErrTypeNotFound) {
		return true
	}
	message := err.Error()
	for _, marker := range []string{"must be", "is required", "invalid", "unsupported", "duplicate", "unknown resource type"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func isQueryValidationError(err error) bool {
	message := err.Error()
	for _, marker := range []string{"must be", "requires", "is not filterable", "unsupported", "invalid", "no searchable fields", "unknown resource type"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
