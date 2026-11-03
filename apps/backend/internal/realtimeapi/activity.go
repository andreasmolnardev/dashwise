// Package realtimeapi serves the authenticated activity websocket consumed by
// the React ActivityProvider.
package realtimeapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/activities"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/auth"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/caldav"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/notifications"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/pages"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourcesync"
	"github.com/gorilla/websocket"
)

const (
	maxMessageSize     = 16 * 1024
	snapshotInterval   = 30 * time.Second
	pageRefreshDelay   = 10 * time.Second
	eventPollDelay     = 2 * time.Second
	pageResolveTimeout = 15 * time.Second
	maxSubscriptions   = 200
	maxChangeBatch     = 500
)

type ActivityHandler struct {
	auth            *auth.Store
	activities      *activities.Store
	notifications   *notifications.Store
	integrations    *integrations.Store
	resources       *resources.Store
	pages           *pages.Store
	resolvePageData PageDataResolver
	calendarMu      sync.Mutex
	calendarCache   map[string]calendarSnapshot
	upgrader        websocket.Upgrader
}

// PageDataResolver resolves YAML-backed widget and glanceable consumer items
// for one saved page configuration.
type PageDataResolver func(context.Context, string, map[string]any) []map[string]any

type calendarSnapshot struct {
	updatedAt time.Time
	events    []caldav.Event
}

type resourceIdentity struct {
	instanceID   string
	collectionID string
	resourceID   string
	resourceType string
}

func (identity resourceIdentity) key() string {
	return identity.resourceType + "\x00" + identity.instanceID + "\x00" + identity.resourceID
}

func (identity resourceIdentity) request() map[string]any {
	return map[string]any{"instanceId": identity.instanceID, "collectionId": identity.collectionID, "resourceId": identity.resourceID}
}

// subscriptionState is the per-connection view of page and SDK resource
// subscriptions. It is guarded by its own mutex and safe to touch from the
// read loop while background refresh loops run.
type subscriptionState struct {
	mu            sync.Mutex
	pageID        string
	subscriptions map[string]resourceIdentity
	refreshing    map[string]bool
}

func newSubscriptionState() *subscriptionState {
	return &subscriptionState{subscriptions: map[string]resourceIdentity{}, refreshing: map[string]bool{}}
}

func (s *subscriptionState) setPage(pageID string) (previous string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pageID, previous = pageID, s.pageID
	return previous
}

func (s *subscriptionState) page() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pageID
}

func (s *subscriptionState) upsertSubscription(identity resourceIdentity) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subscriptions[identity.key()] = identity
}

func (s *subscriptionState) removeSubscription(identity resourceIdentity) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subscriptions, resourceIdentity{
		instanceID:   identity.instanceID,
		resourceID:   identity.resourceID,
		resourceType: identity.resourceType,
	}.key())
}

func (s *subscriptionState) subscriptionCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.subscriptions)
}

// claimRefresh prevents concurrent page widget resolutions for one page.
func (s *subscriptionState) claimRefresh(pageID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.refreshing[pageID] {
		return false
	}
	s.refreshing[pageID] = true
	return true
}

func (s *subscriptionState) releaseRefresh(pageID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.refreshing, pageID)
}

func NewActivityHandler(
	authStore *auth.Store, activityStore *activities.Store, notificationStore *notifications.Store,
	integrationStore *integrations.Store, resourceStore *resources.Store, pageStore *pages.Store,
	pageResolver PageDataResolver,
) (http.Handler, error) {
	if authStore == nil || activityStore == nil || notificationStore == nil {
		return nil, errors.New("activity websocket requires auth, activities, and notifications stores")
	}
	if resourceStore == nil || pageStore == nil || pageResolver == nil {
		return nil, errors.New("activity websocket requires resource, page stores, and a page data resolver")
	}
	h := &ActivityHandler{
		auth: authStore, activities: activityStore, notifications: notificationStore,
		resources: resourceStore, pages: pageStore, resolvePageData: pageResolver,
		calendarCache: map[string]calendarSnapshot{},
		upgrader:      websocket.Upgrader{HandshakeTimeout: 10 * time.Second},
	}
	h.integrations = integrationStore
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

	// gorilla/websocket requires a single concurrent writer on one connection;
	// every send goes through this mutex-guarded helper.
	var writeMu sync.Mutex
	write := func(value any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteJSON(value)
	}
	state := newSubscriptionState()
	sess := &connectionSession{
		handler: h, conn: conn, token: token, owner: user.ID, write: write, state: state,
	}
	lastSequence, err := h.resources.LatestChangeSequence(r.Context())
	if err != nil {
		return
	}
	sess.lastSequence.Store(lastSequence)

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
		calendarEvents := h.calendarEvents(ctx, user.ID)
		return write(map[string]any{"type": "activity:snapshot", "notifications": items, "calendarEvents": calendarEvents, "activities": page.Items})
	}
	if err := snapshot(r.Context()); err != nil {
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	snapshotTicker := time.NewTicker(snapshotInterval)
	defer snapshotTicker.Stop()
	pageTicker := time.NewTicker(pageRefreshDelay)
	defer pageTicker.Stop()
	eventTicker := time.NewTicker(eventPollDelay)
	defer eventTicker.Stop()
	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		for {
			select {
			case <-ctx.Done():
				return
			case <-snapshotTicker.C:
				if err := snapshot(ctx); err != nil {
					sess.close(websocket.ClosePolicyViolation, "session ended")
					return
				}
			case <-pageTicker.C:
				// Refresh the active page only; sendPageWidgets revalidates ownership.
				if pageID := state.page(); pageID != "" {
					sess.sendPageWidgets(ctx, pageID)
				}
			case <-eventTicker.C:
				if state.subscriptionCount() == 0 {
					continue
				}
				if err := sess.pollResourceRevisions(ctx); err != nil && !errors.Is(err, context.Canceled) {
					sess.close(websocket.ClosePolicyViolation, "session ended")
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
		if err := sess.handleMessage(ctx, raw, snapshot); err != nil {
			return
		}
	}
}

// connectionSession carries the per-connection collaborators needed to answer
// client messages while background loops continue.
type connectionSession struct {
	handler      *ActivityHandler
	conn         *websocket.Conn
	token        string
	owner        string
	write        func(any) error
	state        *subscriptionState
	lastSequence atomic.Int64
}

func (s *connectionSession) close(code int, reason string) {
	_ = s.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
	_ = s.conn.Close()
}

func (s *connectionSession) handleMessage(ctx context.Context, raw []byte, snapshot func(context.Context) error) error {
	var message struct {
		Type      string            `json:"type"`
		Resources []json.RawMessage `json:"resources"`
		PageID    string            `json:"pageId"`
	}
	if json.Unmarshal(raw, &message) != nil {
		return nil
	}
	switch message.Type {
	case "activity:subscribe", "activity:refresh":
		if err := snapshot(ctx); err != nil {
			s.close(websocket.ClosePolicyViolation, "session ended")
			return err
		}
	case "page-hello":
		pageID, ok := normalizePageID(message.PageID)
		if !ok {
			return nil
		}
		previous := s.state.setPage(pageID)
		if previous != pageID {
			_ = s.write(map[string]any{"type": "page:subscribed", "pageId": pageID})
		}
		go s.sendPageWidgets(ctx, pageID)
	case "page-goodbye":
		if pageID, ok := normalizePageID(message.PageID); ok && s.state.page() == pageID {
			s.state.setPage("")
		}
	case "sdk:resources:subscribe":
		return s.handleSDKSubscribe(ctx, message.Resources)
	case "sdk:resources:unsubscribe":
		for _, raw := range message.Resources {
			if identity, ok := parseResourceIdentity(raw); ok {
				s.state.removeSubscription(identity)
			}
		}
	case "shortcut:result":
	}
	return nil
}

func (s *connectionSession) pollResourceRevisions(ctx context.Context) error {
	after := s.lastSequence.Load()
	events, err := s.handler.resources.ChangeEventsSince(ctx, s.owner, after, maxChangeBatch)
	if err != nil {
		return err
	}
	if next := maxSequence(events); next > after {
		s.lastSequence.Store(next)
	}
	s.state.mu.Lock()
	subscriptions := map[string]resourceIdentity{}
	for key, identity := range s.state.subscriptions {
		subscriptions[key] = identity
	}
	s.state.mu.Unlock()
	if len(subscriptions) == 0 || len(events) == 0 {
		return nil
	}
	for i := len(events) - 1; i >= 0; i-- {
		event := events[i]
		key := event.ResourceType + "\x00" + event.ProviderInstanceID + "\x00" + event.ProviderResourceID
		identity, subscribed := subscriptions[key]
		if !subscribed {
			continue
		}
		// Walk backwards so the newest event per resource wins when one poll
		// batch recorded several changes for the same resource.
		delete(subscriptions, key)
		operation := event.Operation
		if operation != "delete" {
			operation = "upsert"
		}
		if err := s.write(map[string]any{
			"type":         "sdk:resource-revision",
			"instanceId":   identity.instanceID,
			"collectionId": identity.collectionID,
			"resourceId":   identity.resourceID,
			"revision":     event.Sequence,
			"operation":    operation,
		}); err != nil {
			return err
		}
	}
	return nil
}

func maxSequence(events []resources.ChangeEvent) int64 {
	sequence := int64(0)
	for _, event := range events {
		if event.Sequence > sequence {
			sequence = event.Sequence
		}
	}
	return sequence
}

func (s *connectionSession) handleSDKSubscribe(ctx context.Context, raw []json.RawMessage) error {
	if len(raw) == 0 {
		return s.write(map[string]any{"type": "sdk:resources:subscribed", "resources": []any{}})
	}
	if len(raw) > maxSubscriptions {
		raw = raw[:maxSubscriptions]
	}
	accepted := make([]map[string]any, 0, len(raw))
	revisions := make([]map[string]any, 0, len(raw))
	instanceSources := map[string]string{}
	for _, item := range raw {
		identity, ok := parseResourceIdentity(item)
		if !ok {
			continue
		}
		source, cached := instanceSources[identity.instanceID]
		if !cached {
			instance, err := s.handler.integrations.Get(ctx, s.owner, identity.instanceID)
			if err != nil || instance.Type != "sdk" {
				// Unowned or missing SDK instance: never subscribe. Cache the
				// rejection so repeated identities resolve once.
				instanceSources[identity.instanceID] = ""
				continue
			}
			source = strings.ToLower(instance.Source)
			instanceSources[identity.instanceID] = source
		}
		if source == "" {
			continue
		}
		identity.resourceType = "sdk." + source + "." + strings.ToLower(identity.collectionID)
		s.state.upsertSubscription(identity)
		accepted = append(accepted, identity.request())
		present, err := s.handler.resources.ProviderIdentityExists(ctx, s.owner, identity.resourceType, identity.instanceID, identity.resourceID)
		if err != nil {
			return err
		}
		revision, err := s.handler.resources.LatestRevision(ctx, s.owner, identity.resourceType, identity.instanceID, identity.resourceID)
		if err != nil {
			return err
		}
		operation := "remove"
		if present {
			operation = "upsert"
		}
		revisions = append(revisions, map[string]any{
			"type":         "sdk:resource-revision",
			"instanceId":   identity.instanceID,
			"collectionId": identity.collectionID,
			"resourceId":   identity.resourceID,
			"revision":     revision,
			"operation":    operation,
		})
	}
	if err := s.write(map[string]any{"type": "sdk:resources:subscribed", "resources": accepted}); err != nil {
		return err
	}
	for _, revision := range revisions {
		if err := s.write(revision); err != nil {
			return err
		}
	}
	return nil
}

// sendPageWidgets resolves the active page's consumers and delivers one
// page-widget message per item, matching the retained initial page data
// contract from the TypeScript realtime implementation.
func (s *connectionSession) sendPageWidgets(ctx context.Context, pageID string) {
	if !s.state.claimRefresh(pageID) {
		return
	}
	defer s.state.releaseRefresh(pageID)
	if s.state.page() != pageID {
		return
	}
	resolveCtx, cancel := context.WithTimeout(ctx, pageResolveTimeout)
	defer cancel()
	config := s.handler.pageConfig(resolveCtx, s.owner, pageID)
	items := s.handler.resolvePageData(resolveCtx, s.owner, config)
	if s.state.page() != pageID {
		return
	}
	for _, item := range items {
		if err := s.write(map[string]any{"type": "page-widget", "pageId": pageID, "item": item}); err != nil {
			return
		}
	}
}

// pageConfig loads the saved page configuration for one normalized page ID,
// falling back to a case-insensitive match when the stored page name preserves
// casing that the websocket page ID does not.
func (h *ActivityHandler) pageConfig(ctx context.Context, owner, pageID string) map[string]any {
	record, err := h.pages.Get(ctx, owner, pageID)
	if err == nil && record.Config != nil {
		return record.Config
	}
	saved, err := h.pages.List(ctx, owner)
	if err == nil {
		for _, item := range saved {
			name := strings.TrimSpace(item["pageName"])
			if name != "" && strings.ToLower(name) == pageID {
				if record, err := h.pages.Get(ctx, owner, name); err == nil && record.Config != nil {
					return record.Config
				}
			}
		}
	}
	return map[string]any{}
}

func (h *ActivityHandler) calendarEvents(ctx context.Context, owner string) []caldav.Event {
	if h.integrations == nil {
		return []caldav.Event{}
	}
	h.calendarMu.Lock()
	cached, ok := h.calendarCache[owner]
	if ok && time.Since(cached.updatedAt) < 5*time.Minute {
		events := append([]caldav.Event(nil), cached.events...)
		h.calendarMu.Unlock()
		return events
	}
	h.calendarMu.Unlock()
	items, err := h.integrations.List(ctx, owner, true)
	if err != nil {
		return append([]caldav.Event(nil), cached.events...)
	}
	events := make([]caldav.Event, 0)
	for _, item := range items {
		if item.Type != "caldav" {
			continue
		}
		found, err := caldav.UpcomingEvents(ctx, item.Environment)
		if err != nil {
			continue
		}
		if h.resources != nil {
			if err := resourcesync.SyncCalendar(ctx, owner, item.ID, found, h.resources); err != nil {
				continue
			}
		}
		for i := range found {
			found[i].ID = item.ID + ":" + found[i].ID
		}
		events = append(events, found...)
	}
	if len(events) > 0 || len(items) == 0 {
		h.calendarMu.Lock()
		h.calendarCache[owner] = calendarSnapshot{updatedAt: time.Now(), events: append([]caldav.Event(nil), events...)}
		h.calendarMu.Unlock()
		return events
	}
	return append([]caldav.Event(nil), cached.events...)
}

var (
	instanceIDPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	collectionIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,120}$`)
	resourceIDPattern   = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,200}$`)
)

func parseResourceIdentity(raw json.RawMessage) (resourceIdentity, bool) {
	var requested struct {
		InstanceID   string `json:"instanceId"`
		CollectionID string `json:"collectionId"`
		ResourceID   string `json:"resourceId"`
	}
	if json.Unmarshal(raw, &requested) != nil {
		return resourceIdentity{}, false
	}
	if !instanceIDPattern.MatchString(requested.InstanceID) ||
		!collectionIDPattern.MatchString(requested.CollectionID) ||
		!resourceIDPattern.MatchString(requested.ResourceID) {
		return resourceIdentity{}, false
	}
	return resourceIdentity{
		instanceID:   requested.InstanceID,
		collectionID: requested.CollectionID,
		resourceID:   requested.ResourceID,
	}, true
}

func normalizePageID(pageID string) (string, bool) {
	cleaned := strings.ToLower(strings.TrimSpace(pageID))
	if cleaned == "" || len(cleaned) > 128 {
		return "", false
	}
	return cleaned, true
}
