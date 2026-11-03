// Package deviceauthapi exposes device authorization lookup/approval and the
// temporary WebSocket used by the device that is requesting a login.
package deviceauthapi

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/auth"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/deviceauth"
	"github.com/gorilla/websocket"
)

type Options struct{ RequireTLS bool }
type Handler struct {
	store       *deviceauth.Store
	auth        *auth.Store
	options     Options
	mux         *http.ServeMux
	connections sync.Map // request ID -> *connection
	active      atomic.Int64
	upgrader    websocket.Upgrader
}
type connection struct {
	mu sync.Mutex
	ws *websocket.Conn
}
type clientMessage struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	Secret    string `json:"secret"`
}

func New(store *deviceauth.Store, authStore *auth.Store, options Options) (http.Handler, error) {
	if store == nil || authStore == nil {
		return nil, errors.New("device auth API requires a device store and auth store")
	}
	h := &Handler{store: store, auth: authStore, options: options, mux: http.NewServeMux(), upgrader: websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 2048, CheckOrigin: func(r *http.Request) bool { return sameOrigin(r) }}}
	h.mux.HandleFunc("GET /api/v1/auth/device-code", h.socket)
	h.mux.HandleFunc("POST /api/v1/auth/device-code/lookup", h.lookup)
	h.mux.HandleFunc("POST /api/v1/auth/device-code/approve", h.approve)
	h.mux.HandleFunc("POST /api/v1/auth/device-code/cancel", h.cancel)
	return h.mux, nil
}

func (h *Handler) socket(w http.ResponseWriter, r *http.Request) {
	if h.options.RequireTLS && !requestHTTPS(r) {
		http.Error(w, "HTTPS is required", http.StatusUpgradeRequired)
		return
	}
	ws, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	ip := clientIP(r)
	userAgent := r.UserAgent()
	active := int(h.active.Add(1))
	created, err := h.store.Create(r.Context(), active-1, ip, userAgent)
	if err != nil {
		h.active.Add(-1)
		_ = ws.WriteJSON(map[string]any{"type": "error", "message": "Device login is temporarily unavailable"})
		_ = ws.Close()
		return
	}
	conn := &connection{ws: ws}
	h.connections.Store(created.ID, conn)
	defer func() {
		h.connections.Delete(created.ID)
		h.active.Add(-1)
		h.store.CloseRequest(r.Context(), created.ID)
		conn.close()
	}()
	if err := conn.write(map[string]any{"type": "device-code", "code": created.Code, "secret": created.Secret, "requestId": created.ID, "expiresAt": created.ExpiresAt}); err != nil {
		return
	}
	_ = ws.SetReadDeadline(created.ExpiresAt)
	for {
		kind, raw, err := ws.ReadMessage()
		if err != nil {
			return
		}
		if kind != websocket.TextMessage {
			_ = conn.closeWith(1008, "Invalid device login")
			return
		}
		var message clientMessage
		if json.Unmarshal(raw, &message) != nil || message.Type != "authenticate" || message.RequestID != created.ID || !h.store.AuthenticateSocket(r.Context(), created.ID, message.Secret) {
			_ = conn.closeWith(1008, "Invalid device login")
			return
		}
		_ = conn.write(map[string]string{"type": "authenticated"})
	}
}

func (h *Handler) lookup(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := h.user(w, r); !ok {
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &body) {
		return
	}
	item, err := h.store.Lookup(r.Context(), body.Code, clientIP(r))
	if err != nil {
		write(w, 400, map[string]string{"error": deviceauth.ErrInvalidCode.Error()})
		return
	}
	write(w, 200, item)
}
func (h *Handler) approve(w http.ResponseWriter, r *http.Request) {
	user, session, ok := h.user(w, r)
	if !ok {
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &body) {
		return
	}
	request, err := h.store.Lookup(r.Context(), body.Code, clientIP(r))
	if err != nil {
		write(w, 400, map[string]string{"error": deviceauth.ErrInvalidCode.Error()})
		return
	}
	approved, err := h.store.Approve(r.Context(), body.Code, clientIP(r), user.ID, session.ID, request.UserAgent)
	if err != nil {
		write(w, 400, map[string]string{"error": deviceauth.ErrInvalidCode.Error()})
		return
	}
	if value, ok := h.connections.Load(request.ID); ok {
		conn := value.(*connection)
		_ = conn.write(map[string]any{"type": "approved", "token": approved.Token, "user": approved.User, "sessionId": approved.SessionID})
		_ = conn.closeWith(1000, "Approved")
	}
	write(w, 200, map[string]bool{"success": true})
}
func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := h.user(w, r); !ok {
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &body) {
		return
	}
	item, err := h.store.Cancel(r.Context(), body.Code, clientIP(r))
	if err != nil {
		write(w, 400, map[string]string{"error": deviceauth.ErrInvalidCode.Error()})
		return
	}
	if value, ok := h.connections.Load(item.ID); ok {
		conn := value.(*connection)
		_ = conn.write(map[string]string{"type": "cancelled"})
		_ = conn.closeWith(1000, "Cancelled")
	}
	write(w, 200, map[string]bool{"success": true})
}
func (h *Handler) user(w http.ResponseWriter, r *http.Request) (auth.User, auth.Session, bool) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 7 || !strings.EqualFold(header[:7], "Bearer ") {
		write(w, 401, map[string]string{"error": "authentication required"})
		return auth.User{}, auth.Session{}, false
	}
	user, session, err := h.auth.Validate(r.Context(), strings.TrimSpace(header[7:]))
	if err != nil {
		write(w, 401, map[string]string{"error": "authentication required"})
		return auth.User{}, auth.Session{}, false
	}
	if sessionID := strings.TrimSpace(r.Header.Get("X-Session-Id")); sessionID != "" && sessionID != session.ID {
		write(w, 401, map[string]string{"error": "authentication required"})
		return auth.User{}, auth.Session{}, false
	}
	return user, session, true
}
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		write(w, 400, map[string]string{"error": "invalid request body"})
		return false
	}
	return true
}
func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func clientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	if host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr)); err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
func requestHTTPS(r *http.Request) bool {
	if proto := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))); proto != "" {
		return proto == "https"
	}
	return r.TLS != nil
}
func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	return strings.EqualFold(originHost(origin), r.Host)
}
func originHost(raw string) string {
	raw = strings.TrimPrefix(strings.TrimPrefix(raw, "https://"), "http://")
	return strings.Split(raw, "/")[0]
}
func (c *connection) write(value any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return c.ws.WriteJSON(value)
}
func (c *connection) close() error { c.mu.Lock(); defer c.mu.Unlock(); return c.ws.Close() }
func (c *connection) closeWith(code int, reason string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.ws.SetWriteDeadline(time.Now().Add(time.Second))
	_ = c.ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
	return c.ws.Close()
}
