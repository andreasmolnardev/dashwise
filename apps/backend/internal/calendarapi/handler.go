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
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourcesync"
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
		if h.resources != nil {
			if err := resourcesync.SyncCalendar(r.Context(), owner, item.ID, events, h.resources); err != nil {
				writeError(w, 500, "could not materialize calendar events")
				return
			}
		}
		for i := range events {
			events[i].ID = item.ID + ":" + events[i].ID
		}
		allEvents = append(allEvents, events...)
	}
	writeJSON(w, 200, map[string]any{"events": allEvents})
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
