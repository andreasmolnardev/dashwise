package monitoringapi

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

func (h *Handler) liveStats(w http.ResponseWriter, r *http.Request) {
	request := r.Clone(r.Context())
	request.Header = r.Header.Clone()
	token := strings.TrimSpace(request.URL.Query().Get("token"))
	if token == "" {
		token = bearerToken(request.Header.Get("Authorization"))
	}
	if token == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if sessionID := strings.TrimSpace(request.URL.Query().Get("sessionId")); sessionID != "" {
		request.Header.Set("X-Session-Id", sessionID)
	}
	owner, err := h.auth(request)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	hostID := r.PathValue("id")
	if _, err := h.store.GetHost(r.Context(), owner, hostID); err != nil {
		h.fail(w, err)
		return
	}
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		conn.SetReadLimit(1024)
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	if raw := strings.TrimSpace(r.URL.Query().Get("since")); raw != "" {
		if since, err := time.Parse(time.RFC3339Nano, raw); err == nil {
			if history, err := h.store.HostHistory(r.Context(), owner, hostID, since, 1000); err == nil {
				for _, sample := range history {
					if !writeSample(conn, sample.HostID, sample.Stats, sample.UpdatedAt) {
						return
					}
				}
			}
		}
	}
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	last := ""
	for {
		select {
		case <-r.Context().Done():
			return
		case <-readDone:
			return
		case <-ticker.C:
			if _, err := h.auth(request); err != nil {
				_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "Session ended"), time.Now().Add(time.Second))
				return
			}
			stats, err := h.store.GetHostStats(r.Context(), owner, hostID)
			if err != nil || stats.UpdatedAt.IsZero() {
				continue
			}
			stamp := stats.UpdatedAt.UTC().Format(time.RFC3339Nano)
			if stamp == last {
				continue
			}
			if !writeSample(conn, stats.HostID, stats.Stats, stats.UpdatedAt) {
				return
			}
			last = stamp
		}
	}
}

func writeSample(conn *websocket.Conn, id string, stats map[string]any, stamp time.Time) bool {
	value := map[string]any{"id": id, "hostId": id, "stats": stats, "timestamp": stamp.UTC().Format(time.RFC3339Nano), "created": stamp.UTC().Format(time.RFC3339Nano)}
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return conn.WriteJSON(value) == nil
}

func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

func bearerToken(value string) string {
	if len(value) >= 7 && strings.EqualFold(value[:7], "Bearer ") {
		return strings.TrimSpace(value[7:])
	}
	return ""
}
