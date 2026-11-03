package resourcesync

import (
	"context"
	"fmt"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/caldav"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

// SyncCalendar materializes one integration's current event window. Expired or
// removed events are deleted so resource views reflect the latest window.
func SyncCalendar(ctx context.Context, owner, integrationID string, events []caldav.Event, target *resources.Store) error {
	if owner == "" || integrationID == "" || target == nil {
		return fmt.Errorf("calendar resource sync requires owner, integration ID, and resource store")
	}
	wanted := make(map[string]bool, len(events))
	for _, event := range events {
		if event.ID == "" {
			continue
		}
		wanted[event.ID] = true
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
		if _, err := target.Upsert(ctx, resources.Resource{
			Type: "calendar.event", Provider: "caldav", ProviderInstanceID: integrationID,
			ProviderResourceID: event.ID, OwnerID: owner, Data: data,
			Capabilities: []string{"list", "detail"}, State: "current",
		}); err != nil {
			return fmt.Errorf("materialize calendar event %q: %w", event.ID, err)
		}
	}
	stale := []resources.Resource{}
	for offset := 0; ; offset += 200 {
		page, err := target.Query(ctx, resources.Query{OwnerID: owner, Types: []string{"calendar.event"}, Provider: "caldav", InstanceID: integrationID, Limit: 200, Offset: offset})
		if err != nil {
			return fmt.Errorf("query calendar events for reconciliation: %w", err)
		}
		for _, item := range page.Items {
			if !wanted[item.ProviderResourceID] {
				stale = append(stale, item)
			}
		}
		if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
			break
		}
	}
	for _, item := range stale {
		if err := target.Delete(ctx, owner, item.ID); err != nil {
			return fmt.Errorf("delete expired calendar event: %w", err)
		}
	}
	return nil
}
