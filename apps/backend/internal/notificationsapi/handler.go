// Package notificationsapi exposes authenticated inbox and topic routes.
package notificationsapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/notifications"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

const maxBody = 1 << 20

type Handler struct {
	store *notifications.Store
	auth  resourceapi.Authenticate
	mux   *http.ServeMux
}

func New(store *notifications.Store, auth resourceapi.Authenticate) (http.Handler, error) {
	if store == nil || auth == nil {
		return nil, errors.New("notifications API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: auth, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/notifications", h.listItems)
	h.mux.HandleFunc("POST /api/v1/notifications", h.postRoot)
	h.mux.HandleFunc("GET /api/v1/notifications/topics", h.listTopics)
	h.mux.HandleFunc("POST /api/v1/notifications/topics", h.createTopic)
	h.mux.HandleFunc("DELETE /api/v1/notifications/topics", h.deleteTopic)
	h.mux.HandleFunc("POST /api/v1/notifications/markAsRead", h.markRead)
	h.mux.HandleFunc("POST /api/v1/notifications/test", h.test)
	h.mux.HandleFunc("GET /api/v1/notifications/topicTokens", h.listTokens)
	h.mux.HandleFunc("POST /api/v1/notifications/topicTokens", h.createToken)
	h.mux.HandleFunc("DELETE /api/v1/notifications/topicTokens", h.deleteToken)
	h.mux.HandleFunc("PUT /api/v1/notifications/topicTokens", h.updateToken)
	h.mux.HandleFunc("GET /api/v1/notifications/forwarders", h.listForwarders)
	h.mux.HandleFunc("POST /api/v1/notifications/forwarders", h.createForwarder)
	h.mux.HandleFunc("PUT /api/v1/notifications/forwarders", h.updateForwarder)
	h.mux.HandleFunc("DELETE /api/v1/notifications/forwarders", h.deleteForwarder)
	h.mux.HandleFunc("POST /api/v1/notifications/forwarders/test", h.testForwarder)
	h.mux.HandleFunc("POST /api/v1/notifications/{topic}", h.publish)
	return h.mux, nil
}
func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	v, e := h.auth(r)
	if e != nil || strings.TrimSpace(v) == "" {
		write(w, 401, map[string]string{"error": "authentication required"})
		return "", false
	}
	return v, true
}
func (h *Handler) listItems(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if r.URL.Query().Get("count") == "true" {
		v, e := h.store.Counts(r.Context(), owner)
		if e != nil {
			h.fail(w, e)
			return
		}
		write(w, 200, v)
		return
	}
	items, e := h.store.ListItems(r.Context(), owner, r.URL.Query().Get("unread") == "true")
	if e != nil {
		h.fail(w, e)
		return
	}
	write(w, 200, map[string]any{"items": items})
}
func (h *Handler) listTopics(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	v, e := h.store.ListTopics(r.Context(), owner)
	if e != nil {
		h.fail(w, e)
		return
	}
	out := make([]map[string]any, 0, len(v))
	for _, t := range v {
		out = append(out, map[string]any{"id": t.ID, "title": t.Title})
	}
	write(w, 200, map[string]any{"items": out})
}
func (h *Handler) createTopic(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		Title string `json:"title"`
	}
	if !decode(w, r, &in) {
		return
	}
	t, e := h.store.CreateTopic(r.Context(), owner, in.Title)
	if e != nil {
		h.fail(w, e)
		return
	}
	_, _ = h.store.Publish(r.Context(), t.ID, "Topic has been created", "web")
	write(w, 200, map[string]any{"ok": true, "topicId": t.ID})
}
func (h *Handler) deleteTopic(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		TopicID string `json:"topicId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if e := h.store.DeleteTopic(r.Context(), owner, in.TopicID); e != nil {
		h.fail(w, e)
		return
	}
	write(w, 200, map[string]bool{"success": true})
}
func (h *Handler) markRead(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		IDs []string `json:"ids"`
	}
	if !decode(w, r, &in) {
		return
	}
	if e := h.store.MarkRead(r.Context(), owner, in.IDs); e != nil {
		h.fail(w, e)
		return
	}
	write(w, 200, nil)
}
func (h *Handler) test(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		TopicID string `json:"topicId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if _, e := h.store.GetTopic(r.Context(), owner, in.TopicID); e != nil {
		h.fail(w, e)
		return
	}
	item, e := h.store.Publish(r.Context(), in.TopicID, "This is a test notification from Dashwise.", "test")
	if e != nil {
		h.fail(w, e)
		return
	}
	write(w, 200, map[string]any{"ok": true, "itemId": item.ID})
}
func (h *Handler) postRoot(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.owner(w, r); !ok {
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (h *Handler) publish(w http.ResponseWriter, r *http.Request) {
	topicRef := r.PathValue("topic")
	var body any
	if !decode(w, r, &body) {
		return
	}
	content := body
	source := "api"
	if m, ok := body.(map[string]any); ok {
		if v, exists := m["content"]; exists {
			content = v
		}
		if v, exists := m["source"].(string); exists && v != "" {
			source = v
		}
	}
	topic, e := h.store.ResolveToken(r.Context(), topicRef)
	if e == nil {
		item, err := h.store.Publish(r.Context(), topic.ID, content, "token")
		if err != nil {
			h.fail(w, err)
			return
		}
		write(w, 200, map[string]any{"ok": true, "topicId": topic.ID, "itemId": item.ID})
		return
	}
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	topic, e = h.store.GetTopic(r.Context(), owner, topicRef)
	if e != nil {
		h.fail(w, e)
		return
	}
	item, e := h.store.Publish(r.Context(), topic.ID, content, source)
	if e != nil {
		h.fail(w, e)
		return
	}
	write(w, 200, map[string]any{"ok": true, "topicId": topic.ID, "itemId": item.ID})
}
func (h *Handler) listTokens(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	v, e := h.store.ListTokens(r.Context(), owner)
	if e != nil {
		h.fail(w, e)
		return
	}
	write(w, 200, map[string]any{"items": v})
}
func (h *Handler) createToken(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		TopicID   string  `json:"topicId"`
		TopicName string  `json:"topicName"`
		Expires   *string `json:"expires"`
	}
	if !decode(w, r, &in) {
		return
	}
	topicID := in.TopicID
	if topicID == "" {
		t, e := h.store.GetTopicByTitle(r.Context(), owner, in.TopicName)
		if e != nil {
			h.fail(w, e)
			return
		}
		topicID = t.ID
	}
	var exp *time.Time
	if in.Expires != nil && *in.Expires != "" {
		v, e := time.Parse(time.RFC3339, *in.Expires)
		if e != nil {
			h.fail(w, notifications.ErrInvalid)
			return
		}
		exp = &v
	}
	token, e := h.store.CreateToken(r.Context(), owner, topicID, exp)
	if e != nil {
		h.fail(w, e)
		return
	}
	write(w, 200, map[string]any{"item": token})
}
func (h *Handler) deleteToken(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		TokenID string `json:"tokenId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if e := h.store.DeleteToken(r.Context(), owner, in.TokenID); e != nil {
		h.fail(w, e)
		return
	}
	write(w, 200, map[string]bool{"success": true})
}
func (h *Handler) updateToken(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		TokenID string  `json:"tokenId"`
		TopicID *string `json:"topicId"`
		Expires *string `json:"expires"`
	}
	if !decode(w, r, &in) {
		return
	}
	var exp *time.Time
	if in.Expires != nil && *in.Expires != "" {
		v, e := time.Parse(time.RFC3339, *in.Expires)
		if e != nil {
			h.fail(w, notifications.ErrInvalid)
			return
		}
		exp = &v
	}
	if in.TopicID != nil && *in.TopicID != "" {
		if _, e := h.store.GetTopic(r.Context(), owner, *in.TopicID); e != nil {
			h.fail(w, e)
			return
		}
		if e := h.store.MoveToken(r.Context(), owner, in.TokenID, *in.TopicID); e != nil {
			h.fail(w, e)
			return
		}
	}
	if in.Expires != nil {
		if e := h.store.UpdateTokenExpiry(r.Context(), owner, in.TokenID, exp); e != nil {
			h.fail(w, e)
			return
		}
	}
	write(w, 200, map[string]any{"success": true})
}

func (h *Handler) listForwarders(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.ListForwarders(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	write(w, 200, map[string]any{"items": items})
}

func (h *Handler) createForwarder(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		Topic    string `json:"topic"`
		Target   string `json:"target"`
		IsActive *bool  `json:"isActive"`
	}
	if !decode(w, r, &in) {
		return
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	item, err := h.store.CreateForwarder(r.Context(), owner, in.Topic, in.Target, active)
	if err != nil {
		h.fail(w, err)
		return
	}
	write(w, 200, map[string]any{"item": item})
}

func (h *Handler) updateForwarder(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		ForwarderID string  `json:"forwarderId"`
		Target      *string `json:"target"`
		IsActive    *bool   `json:"isActive"`
	}
	if !decode(w, r, &in) {
		return
	}
	item, err := h.store.UpdateForwarder(r.Context(), owner, in.ForwarderID, in.Target, in.IsActive)
	if err != nil {
		h.fail(w, err)
		return
	}
	write(w, 200, map[string]any{"item": item})
}

func (h *Handler) deleteForwarder(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		ForwarderID string `json:"forwarderId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := h.store.DeleteForwarder(r.Context(), owner, in.ForwarderID); err != nil {
		h.fail(w, err)
		return
	}
	write(w, 200, map[string]bool{"success": true})
}

func (h *Handler) testForwarder(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in struct {
		ForwarderID string `json:"forwarderId"`
		Target      string `json:"target"`
	}
	if !decode(w, r, &in) {
		return
	}
	target := strings.TrimSpace(in.Target)
	if in.ForwarderID != "" {
		forwarder, err := h.store.GetForwarder(r.Context(), owner, in.ForwarderID)
		if err != nil {
			h.fail(w, err)
			return
		}
		target = forwarder.Target
	}
	if err := sendViaShoutrrr(r, target, "This is a test notification from Dashwise."); err != nil {
		write(w, 502, map[string]string{"error": "notification delivery failed"})
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}

func sendViaShoutrrr(r *http.Request, target, message string) error {
	if strings.TrimSpace(target) == "" || len(target) > 4096 {
		return notifications.ErrInvalid
	}
	binary := strings.TrimSpace(os.Getenv("SHOUTRRR_BINARY_PATH"))
	if binary == "" {
		binary = "shoutrrr"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, binary, "send", "--url", target, "--message", message).CombinedOutput()
	if err != nil {
		return fmt.Errorf("Shoutrrr delivery failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
func (h *Handler) fail(w http.ResponseWriter, e error) {
	if errors.Is(e, notifications.ErrNotFound) {
		write(w, 404, map[string]string{"error": "not found"})
		return
	}
	if errors.Is(e, notifications.ErrInvalid) {
		write(w, 400, map[string]string{"error": "invalid input"})
		return
	}
	write(w, 500, map[string]string{"error": "notification operation failed"})
}
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	e := json.NewDecoder(r.Body).Decode(dst)
	if e != nil && e != io.EOF {
		write(w, 400, map[string]string{"error": "invalid JSON body"})
		return false
	}
	return true
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
