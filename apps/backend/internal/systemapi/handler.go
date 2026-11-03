// Package systemapi implements retained small application-wide endpoints.
package systemapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

type Handler struct {
	auth   resourceapi.Authenticate
	client *http.Client
	mux    *http.ServeMux
}

func New(auth resourceapi.Authenticate) (http.Handler, error) {
	if auth == nil {
		return nil, errors.New("system API requires an authenticator")
	}
	h := &Handler{auth: auth, client: &http.Client{Timeout: 8 * time.Second}, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/locations", h.locations)
	h.mux.HandleFunc("GET /api/v1/weather", h.weather)
	h.mux.HandleFunc("GET /api/v1/test/bookmarks", h.bookmarks)
	return h.mux, nil
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) bool {
	if _, err := h.auth(r); err != nil {
		writeJSON(w, 401, map[string]string{"error": "authentication required"})
		return false
	}
	return true
}

func (h *Handler) locations(w http.ResponseWriter, r *http.Request) {
	if !h.owner(w, r) {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeJSON(w, 200, []any{})
		return
	}
	if len(query) > 200 {
		writeJSON(w, 400, map[string]string{"error": "location query is too long"})
		return
	}
	endpoint := "https://nominatim.openstreetmap.org/search?format=json&limit=6&q=" + url.QueryEscape(query)
	ctx, cancel := context.WithTimeout(r.Context(), 7*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "could not create geocoding request"})
		return
	}
	req.Header.Set("User-Agent", "Dashwise/2 location search")
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "location search unavailable"})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeJSON(w, 502, map[string]string{"error": fmt.Sprintf("location search returned HTTP %d", resp.StatusCode)})
		return
	}
	var result []map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, resp.Body, 1<<20)).Decode(&result); err != nil {
		writeJSON(w, 502, map[string]string{"error": "invalid location search response"})
		return
	}
	writeJSON(w, 200, result)
}

func (h *Handler) weather(w http.ResponseWriter, r *http.Request) {
	if h.owner(w, r) {
		writeJSON(w, 200, map[string]any{})
	}
}

func (h *Handler) bookmarks(w http.ResponseWriter, r *http.Request) {
	if h.owner(w, r) {
		writeJSON(w, 200, map[string]any{})
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
