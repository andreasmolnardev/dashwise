// Package systemapi implements retained small application-wide endpoints.
package systemapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

type Handler struct {
	auth          resourceapi.Authenticate
	client        *http.Client
	mux           *http.ServeMux
	iconsDir      string
	iconsMu       sync.Mutex
	versions      *VersionChecker
	disableSignup bool
}

type Options struct {
	Version       string
	GitHubRepo    string
	DisableSignup bool
}

func New(auth resourceapi.Authenticate) (http.Handler, error) {
	handler, err := NewWithOptions(auth, Options{})
	if err != nil {
		return nil, err
	}
	return handler, nil
}

func NewWithOptions(auth resourceapi.Authenticate, options Options) (*Handler, error) {
	if auth == nil {
		return nil, errors.New("system API requires an authenticator")
	}
	webDist := strings.TrimSpace(os.Getenv("WEB_DIST"))
	if webDist == "" {
		webDist = "../../web/dist"
	}
	h := &Handler{auth: auth, client: &http.Client{Timeout: 8 * time.Second}, mux: http.NewServeMux(), iconsDir: filepath.Join(webDist, "icons"), versions: NewVersionChecker(options.Version, options.GitHubRepo), disableSignup: options.DisableSignup}
	h.mux.HandleFunc("GET /api/v1/appInfo", h.appInfo)
	h.mux.HandleFunc("GET /api/v1/locations", h.locations)
	h.mux.HandleFunc("GET /api/v1/jobs/pullIcons", h.pullIcons)
	return h, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) { h.mux.ServeHTTP(w, r) }

func (h *Handler) RunVersionChecks(ctx context.Context) error { return h.versions.Run(ctx) }

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

func (h *Handler) appInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"updateAvailable":    h.versions.UpdateAvailable(),
		"currentAppVersion":  h.versions.version,
		"userSignupDisabled": h.disableSignup,
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
