package backgroundjobs

import (
	"context"
	"fmt"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/activities"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

func (r *Runner) runBuiltinActivityProviders(ctx context.Context) error {
	owners, err := r.users.ListUserIDs(ctx)
	if err != nil {
		return fmt.Errorf("list accounts for builtin activity providers: %w", err)
	}
	var firstErr error
	for _, owner := range owners {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		settings, err := r.activities.DefinitionSettings(ctx, owner)
		if err == nil {
			err = r.reconcileUnreadNotificationActivity(ctx, owner, settings)
		}
		if err == nil {
			err = r.reconcileCalendarActivities(ctx, owner, settings)
		}
		if err == nil {
			err = r.reconcileNewsFeedFailureActivities(ctx, owner)
		}
		if err == nil {
			err = r.reconcileIntegrationUpdateActivities(ctx, owner)
		}
		if err != nil {
			r.logger.Error("reconcile builtin activities", "owner_id", owner, "error", err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func (r *Runner) reconcileIntegrationUpdateActivities(ctx context.Context, owner string) error {
	existing, err := listActivities(ctx, r.activities, owner, "integration", "integrations.updates")
	if err != nil {
		return err
	}
	settings, err := r.activities.DefinitionSettings(ctx, owner)
	if err != nil {
		return err
	}
	if !activityDefinitionEnabled(settings, "integrations.updates") {
		return clearActivities(ctx, r.activities, owner, "integration", existing)
	}
	items, err := r.integrations.List(ctx, owner, false)
	if err != nil {
		return err
	}
	active := make(map[string]bool, len(items))
	for _, item := range items {
		available, _ := item.LocalData["updateAvailable"].(bool)
		if !available {
			continue
		}
		active[item.ID] = true
		version, _ := item.LocalData["remoteVersion"].(string)
		name := item.Name
		if name == "" {
			name = "Integration"
		}
		title := name + " update available"
		description := "A newer YAML integration version is available."
		if version != "" {
			description = "Version " + version + " is available to install."
		}
		alreadyPublished := false
		for _, record := range existing {
			if record.Current && record.SourceID == item.ID && record.Title == title && record.Description == description {
				alreadyPublished = true
				break
			}
		}
		if alreadyPublished {
			continue
		}
		_, _, err := r.activities.Publish(ctx, owner, activities.Input{
			Source: "integration", SourceID: item.ID, Type: "integrations.updates",
			Title: title, Description: description, Severity: "info",
			IdempotencyKey: "integration:update", Current: true,
			Metadata: map[string]any{"integrationId": item.ID, "version": version},
			Action:   &activities.Action{Label: "Review integrations", Target: "/settings/integrations"},
		})
		if err != nil {
			return err
		}
	}
	for _, record := range existing {
		if active[record.SourceID] {
			continue
		}
		if _, err := r.activities.Clear(ctx, owner, "integration", record.SourceID, record.IdempotencyKey); err != nil {
			return err
		}
	}
	return nil
}

func (r *Runner) reconcileUnreadNotificationActivity(ctx context.Context, owner string, settings activities.DefinitionSettings) error {
	key := "notifications:unread-count"
	existing, err := listActivities(ctx, r.activities, owner, "notifications", "notifications.unread")
	if err != nil {
		return err
	}
	if !activityDefinitionEnabled(settings, "notifications.unread") {
		return clearActivities(ctx, r.activities, owner, "notifications", existing)
	}
	items, err := r.notifications.ListItems(ctx, owner, true)
	if err != nil {
		return err
	}
	configuredTopics := activities.DefinitionTopicPreference(settings, "notifications.unread")
	if len(configuredTopics) > 0 {
		allowed := make(map[string]struct{}, len(configuredTopics))
		for _, topicID := range configuredTopics {
			allowed[topicID] = struct{}{}
		}
		filtered := items[:0]
		for _, item := range items {
			if _, ok := allowed[item.TopicID]; ok {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	if len(items) == 0 {
		return clearActivities(ctx, r.activities, owner, "notifications", existing)
	}
	description := fmt.Sprintf("%d unread notification(s).", len(items))
	for _, record := range existing {
		if record.Current && record.SourceID == owner && record.Title == "Unread notifications" && record.Description == description {
			return nil
		}
	}
	_, _, err = r.activities.Publish(ctx, owner, activities.Input{
		Source: "notifications", SourceID: owner, Type: "notifications.unread",
		Title: "Unread notifications", Description: description,
		Severity: "info", IdempotencyKey: key, Current: true,
		Metadata: map[string]any{"unreadCount": len(items)},
	})
	return err
}

func (r *Runner) reconcileCalendarActivities(ctx context.Context, owner string, settings activities.DefinitionSettings) error {
	active := map[string]bool{}
	existing, err := listActivities(ctx, r.activities, owner, "calendar", "calendar.upcoming")
	if err != nil {
		return err
	}
	if activityDefinitionEnabled(settings, "calendar.upcoming") {
		window := activityWindow(settings.Config["calendar.upcoming"], 30)
		lead := time.Duration(window) * time.Minute
		now := time.Now().UTC()
		for offset := 0; ; offset += 200 {
			page, err := r.resources.Query(ctx, resources.Query{OwnerID: owner, Types: []string{"calendar.event"}, Limit: 200, Offset: offset})
			if err != nil {
				return err
			}
			for _, event := range page.Items {
				start, ok := parseResourceTime(event.Data["startAt"])
				if !ok {
					continue
				}
				end, ok := parseResourceTime(event.Data["endAt"])
				if !ok {
					end = start
				}
				if now.Before(start.Add(-lead)) || !now.Before(end) {
					continue
				}
				active[event.ID] = true
				title, _ := event.Data["title"].(string)
				if title == "" {
					title = "Upcoming calendar event"
				}
				alreadyPublished := false
				for _, record := range existing {
					if record.Current && record.SourceID == event.ID && record.Title == title {
						alreadyPublished = true
						break
					}
				}
				if alreadyPublished {
					continue
				}
				_, _, err := r.activities.Publish(ctx, owner, activities.Input{
					Source: "calendar", SourceID: event.ID, Type: "calendar.upcoming",
					Title: title, Description: "An upcoming calendar event is in its configured visibility window.",
					Severity: "info", IdempotencyKey: "calendar:upcoming", Current: true,
					Metadata: map[string]any{"resourceId": event.ID, "startAt": start.Format(time.RFC3339Nano), "endAt": end.Format(time.RFC3339Nano)},
				})
				if err != nil {
					return err
				}
			}
			if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
				break
			}
		}
	}
	for _, record := range existing {
		if active[record.SourceID] {
			continue
		}
		if _, err := r.activities.Clear(ctx, owner, "calendar", record.SourceID, record.IdempotencyKey); err != nil {
			return err
		}
	}
	return nil
}

func listActivities(ctx context.Context, store *activities.Store, owner, source, activityType string) ([]activities.Record, error) {
	items := make([]activities.Record, 0)
	for pageNumber := 1; ; pageNumber++ {
		page, err := store.List(ctx, owner, activities.Query{Source: source, Type: activityType, Page: pageNumber, PerPage: 100})
		if err != nil {
			return nil, err
		}
		items = append(items, page.Items...)
		if len(page.Items) < page.PerPage || pageNumber*page.PerPage >= page.TotalItems {
			return items, nil
		}
	}
}

func clearActivities(ctx context.Context, store *activities.Store, owner, source string, records []activities.Record) error {
	for _, record := range records {
		if _, err := store.Clear(ctx, owner, source, record.SourceID, record.IdempotencyKey); err != nil {
			return err
		}
	}
	return nil
}

func activityDefinitionEnabled(settings activities.DefinitionSettings, id string) bool {
	enabled, exists := settings.Enabled[id]
	return !exists || enabled
}

func activityWindow(settings map[string]any, fallback int) int {
	value, ok := settings["windowMinutes"]
	if !ok {
		return fallback
	}
	switch value := value.(type) {
	case float64:
		if value >= 0 && value <= 1440 {
			return int(value)
		}
	case int:
		if value >= 0 && value <= 1440 {
			return value
		}
	}
	return fallback
}

func parseResourceTime(value any) (time.Time, bool) {
	text, ok := value.(string)
	if !ok {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339Nano, text)
	return parsed.UTC(), err == nil
}
