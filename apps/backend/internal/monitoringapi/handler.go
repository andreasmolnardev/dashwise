// Package monitoringapi exposes the authenticated HTTP surface for retained
// monitor and System Agent host configuration and cached telemetry.
package monitoringapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/monitoring"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

const maxBodyBytes = 1 << 20

// RefreshFunc performs a live System Agent refresh and persists any received
// telemetry through the monitoring store. It is injected because the agent
// transport protocol belongs to the System Agent integration layer.
type RefreshFunc func(*http.Request, monitoring.Host) error

type Handler struct {
	store   *monitoring.Store
	auth    resourceapi.Authenticate
	refresh RefreshFunc
	mux     *http.ServeMux
}

func New(store *monitoring.Store, authenticate resourceapi.Authenticate, refresh RefreshFunc) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("monitoring API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: authenticate, refresh: refresh, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/monitors", h.listMonitors)
	h.mux.HandleFunc("POST /api/v1/monitors", h.createMonitor)
	h.mux.HandleFunc("GET /api/v1/monitors/{id}", h.getMonitor)
	h.mux.HandleFunc("PUT /api/v1/monitors/{id}", h.updateMonitor)
	h.mux.HandleFunc("DELETE /api/v1/monitors/{id}", h.deleteMonitor)
	h.mux.HandleFunc("GET /api/v1/monitoringStatus", h.status)
	h.mux.HandleFunc("POST /api/v1/monitoringStatus", h.runCheck)
	h.mux.HandleFunc("GET /api/v1/monitoring/hosts", h.listHosts)
	h.mux.HandleFunc("POST /api/v1/monitoring/hosts", h.createHost)
	h.mux.HandleFunc("PUT /api/v1/monitoring/hosts/{id}", h.updateHost)
	h.mux.HandleFunc("DELETE /api/v1/monitoring/hosts/{id}", h.deleteHost)
	h.mux.HandleFunc("GET /api/v1/monitoring/hosts/{id}/stats", h.hostStats)
	h.mux.HandleFunc("GET /api/v1/monitoring/hosts/{id}/history", h.hostHistory)
	h.mux.HandleFunc("POST /api/v1/monitoring/hosts/{id}/refresh", h.refreshHost)
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
func (h *Handler) listMonitors(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.ListMonitors(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}
func (h *Handler) createMonitor(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in monitoring.MonitorInput
	if !decodeJSON(w, r, &in) {
		return
	}
	item, err := h.store.CreateMonitor(r.Context(), owner, in)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}
func (h *Handler) getMonitor(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	item, err := h.store.GetMonitor(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}
func (h *Handler) updateMonitor(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in monitoring.MonitorInput
	if !decodeJSON(w, r, &in) {
		return
	}
	item, err := h.store.UpdateMonitor(r.Context(), owner, r.PathValue("id"), in)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}
func (h *Handler) deleteMonitor(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if err := h.store.DeleteMonitor(r.Context(), owner, r.PathValue("id")); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	summaries, err := h.store.Status(r.Context(), owner, r.URL.Query().Get("jobId"))
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summaries)
}
func (h *Handler) runCheck(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		JobID  string `json:"jobId"`
		LinkID string `json:"linkId"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.JobID) == "" && strings.TrimSpace(in.LinkID) == "" {
		writeError(w, http.StatusBadRequest, "provide linkId or jobId")
		return
	}
	monitors, err := h.store.ListMonitors(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	target := ""
	for _, m := range monitors {
		if in.JobID != "" && m.ID == in.JobID || in.JobID == "" && m.LinkID == in.LinkID {
			target = m.ID
			break
		}
	}
	if target == "" {
		writeError(w, http.StatusNotFound, "monitoring job not found")
		return
	}
	result, err := h.store.RunCheck(r.Context(), owner, target)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (h *Handler) listHosts(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.ListHosts(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}
func (h *Handler) createHost(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in monitoring.HostInput
	if !decodeJSON(w, r, &in) {
		return
	}
	host, err := h.store.CreateHost(r.Context(), owner, in)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, host)
}
func (h *Handler) updateHost(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in monitoring.HostInput
	if !decodeJSON(w, r, &in) {
		return
	}
	host, err := h.store.UpdateHost(r.Context(), owner, r.PathValue("id"), in)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, host)
}
func (h *Handler) deleteHost(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if err := h.store.DeleteHost(r.Context(), owner, r.PathValue("id")); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
func (h *Handler) hostStats(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	stats, err := h.store.GetHostStats(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": stats.HostID, "stats": stats.Stats, "updated": stats.UpdatedAt})
}
func (h *Handler) hostHistory(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	from := time.Time{}
	if raw := r.URL.Query().Get("timestamp"); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "timestamp must be RFC3339")
			return
		}
		from = parsed
	}
	limit := 1000
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = parsed
	}
	items, err := h.store.HostHistory(r.Context(), owner, r.PathValue("id"), from, limit)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}
func (h *Handler) refreshHost(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	host, err := h.store.GetHost(r.Context(), owner, r.PathValue("id"))
	if err != nil {
		h.fail(w, err)
		return
	}
	if h.refresh == nil {
		writeError(w, http.StatusServiceUnavailable, "System Agent live refresh is not configured")
		return
	}
	if err := h.refresh(r, host); err != nil {
		writeError(w, http.StatusBadGateway, "System Agent refresh failed")
		return
	}
	stats, err := h.store.GetHostStats(r.Context(), owner, host.ID)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": stats.HostID, "stats": stats.Stats, "updated": stats.UpdatedAt})
}

func (h *Handler) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, monitoring.ErrNotFound):
		writeError(w, http.StatusNotFound, "monitoring record not found")
	case errors.Is(err, monitoring.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "monitoring operation failed")
	}
}
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "request body must contain one JSON value")
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
