// Package realtimeapi serves the authenticated activity websocket consumed by
// the React ActivityProvider.
package realtimeapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/activities"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/auth"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/notifications"
	"github.com/gorilla/websocket"
)

const maxMessageSize = 16 * 1024

type ActivityHandler struct {
	auth          *auth.Store
	activities    *activities.Store
	notifications *notifications.Store
	upgrader      websocket.Upgrader
}

func NewActivityHandler(authStore *auth.Store, activityStore *activities.Store, notificationStore *notifications.Store) (http.Handler, error) {
	if authStore == nil || activityStore == nil || notificationStore == nil {
		return nil, errors.New("activity websocket requires auth, activities, and notifications stores")
	}
	h := &ActivityHandler{auth: authStore, activities: activityStore, notifications: notificationStore, upgrader: websocket.Upgrader{HandshakeTimeout: 10 * time.Second}}
	return http.HandlerFunc(h.serve), nil
}

func (h *ActivityHandler) serve(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	user, session, err := h.auth.Validate(r.Context(), token)
	if err != nil || (r.URL.Query().Get("sessionId") != "" && r.URL.Query().Get("sessionId") != session.ID) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(maxMessageSize)
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })

	var writeMu sync.Mutex
	write := func(value any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteJSON(value)
	}
	snapshot := func(ctx context.Context) error {
		// Revalidate periodically and before responding to client refreshes so a
		// revoked session cannot keep a websocket alive indefinitely.
		if _, _, err := h.auth.Validate(ctx, token); err != nil {
			return err
		}
		items, err := h.notifications.ListItems(ctx, user.ID, false)
		if err != nil {
			return err
		}
		page, err := h.activities.List(ctx, user.ID, activities.Query{Page: 1, PerPage: 20})
		if err != nil {
			return err
		}
		return write(map[string]any{"type": "activity:snapshot", "notifications": items, "calendarEvents": []any{}, "activities": page.Items})
	}
	if err := snapshot(r.Context()); err != nil {
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := snapshot(ctx); err != nil {
					_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "session ended"), time.Now().Add(time.Second))
					_ = conn.Close()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-writeDone }()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		var message struct {
			Type      string            `json:"type"`
			Resources []json.RawMessage `json:"resources"`
			PageID    string            `json:"pageId"`
		}
		if json.Unmarshal(raw, &message) != nil {
			continue
		}
		switch message.Type {
		case "activity:subscribe", "activity:refresh":
			if err := snapshot(r.Context()); err != nil {
				_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "session ended"), time.Now().Add(time.Second))
				return
			}
		case "page-hello":
			// Page widget rendering is still provided by the TypeScript runtime;
			// acknowledge the page lifecycle while that runtime is being ported.
			if len(message.PageID) > 0 && len(message.PageID) <= 128 {
				_ = write(map[string]any{"type": "page:subscribed", "pageId": message.PageID})
			}
		case "page-goodbye":
		case "sdk:resources:subscribe":
			// SDK resource subscriptions are enabled once the Go SDK host is wired.
			_ = write(map[string]any{"type": "sdk:resources:subscribed", "resources": []any{}})
		case "sdk:resources:unsubscribe", "shortcut:result":
		}
	}
}
