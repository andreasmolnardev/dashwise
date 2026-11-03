// Package calendarapi exposes calendar resources from configured CalDAV
// integrations through the existing integration endpoints.
package calendarapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/caldav"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

type Handler struct {
	store     *integrations.Store
	resources *resources.Store
	auth      resourceapi.Authenticate
	mux       *http.ServeMux
}

func New(store *integrations.Store, authenticate resourceapi.Authenticate, resourceStores ...*resources.Store) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("calendar API requires integration storage and authentication")
	}
	h := &Handler{store: store, auth: authenticate, mux: http.NewServeMux()}
	if len(resourceStores) > 0 {
		h.resources = resourceStores[0]
	}
	h.mux.HandleFunc("GET /api/v1/integrations/caldav/calendars", h.calendars)
	h.mux.HandleFunc("GET /api/v1/integrations/caldav/events", h.events)
	return h.mux, nil
}

func (h *Handler) calendars(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(r.URL.Query().Get("integrationId"))
	if id == "" {
		writeError(w, 400, "Integration ID is required")
		return
	}
	integration, err := h.store.Get(r.Context(), owner, id)
	if err != nil || integration.Type != "caldav" {
		writeError(w, 404, "Calendar integration not found")
		return
	}
	items, err := caldav.DiscoverCalendars(r.Context(), integration.Environment)
	if err != nil {
		writeError(w, 502, "could not load calendars")
		return
	}
	writeJSON(w, 200, map[string]any{"calendars": items})
}

func (h *Handler) events(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(r.URL.Query().Get("integrationId"))
	integrationsForOwner := []integrations.Integration{}
	if id != "" {
		item, err := h.store.Get(r.Context(), owner, id)
		if err != nil || item.Type != "caldav" {
			writeError(w, 404, "Calendar integration not found")
			return
		}
		integrationsForOwner = append(integrationsForOwner, item)
	} else {
		items, err := h.store.List(r.Context(), owner, true)
		if err != nil {
			writeError(w, 500, "could not load calendar integrations")
			return
		}
		for _, item := range items {
			if item.Type == "caldav" {
				integrationsForOwner = append(integrationsForOwner, item)
			}
		}
	}
	allEvents := make([]caldav.Event, 0)
	for _, item := range integrationsForOwner {
		events, err := caldav.UpcomingEvents(r.Context(), item.Environment)
		if err != nil {
			// One unavailable calendar should not hide events from other configured
			// providers; a specifically requested integration returns its error.
			if id != "" {
				writeError(w, 502, "could not load calendar events")
				return
			}
			continue
		}
		for i := range events {
			events[i].ID = item.ID + ":" + events[i].ID
		}
		if h.resources != nil {
			if err := h.syncResources(r, owner, item.ID, events); err != nil {
				writeError(w, 500, "could not materialize calendar events")
				return
			}
		}
		allEvents = append(allEvents, events...)
	}
	writeJSON(w, 200, map[string]any{"events": allEvents})
}

func (h *Handler) syncResources(r *http.Request, owner, integrationID string, events []caldav.Event) error {
	wanted := make(map[string]bool, len(events))
	for _, event := range events {
		id := strings.TrimPrefix(event.ID, integrationID+":")
		wanted[id] = true
		data := map[string]any{
			"title":    event.Title,
			"startAt":  event.Start.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"),
			"endAt":    event.End.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"),
			"isAllDay": event.IsAllDay,
		}
		if event.Description != "" {
			data["description"] = event.Description
		}
		if event.Location != "" {
			data["location"] = event.Location
		}
		if _, err := h.resources.Upsert(r.Context(), resources.Resource{
			Type: "calendar.event", Provider: "caldav", ProviderInstanceID: integrationID,
			ProviderResourceID: id, OwnerID: owner, Data: data,
			Capabilities: []string{"list", "detail"}, State: "current",
		}); err != nil {
			return err
		}
	}
	stale := []resources.Resource{}
	for offset := 0; ; offset += 200 {
		page, err := h.resources.Query(r.Context(), resources.Query{OwnerID: owner, Types: []string{"calendar.event"}, Provider: "caldav", InstanceID: integrationID, Limit: 200, Offset: offset})
		if err != nil {
			return err
		}
		for _, resource := range page.Items {
			if !wanted[resource.ProviderResourceID] {
				stale = append(stale, resource)
			}
		}
		if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
			break
		}
	}
	for _, resource := range stale {
		if err := h.resources.Delete(r.Context(), owner, resource.ID); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		writeError(w, 401, "authentication required")
		return "", false
	}
	return owner, true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
