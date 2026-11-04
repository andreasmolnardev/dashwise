// Package backgroundjobs runs recurring work that maintains derived and
// time-bounded data. It is deliberately separate from the HTTP app so the
// worker schedules can be reused by embedded deployments.
package backgroundjobs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/activities"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/monitoring"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/news"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/notifications"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

type UserLister interface {
	ListUserIDs(context.Context) ([]string, error)
}

type Options struct {
	Users                 UserLister
	News                  *news.Store
	NewsFetcher           *news.Fetcher
	Resources             *resources.Store
	Activities            *activities.Store
	Integrations          *integrations.Store
	Monitoring            *monitoring.Store
	Notifications         *notifications.Store
	NewsInterval          time.Duration
	MonitorInterval       time.Duration
	ActivityInterval      time.Duration
	ActivityRetentionDays int
	Logger                *slog.Logger
}

type Runner struct {
	users                 UserLister
	news                  *news.Store
	newsFetcher           *news.Fetcher
	resources             *resources.Store
	activities            *activities.Store
	integrations          *integrations.Store
	monitoring            *monitoring.Store
	notifications         *notifications.Store
	newsInterval          time.Duration
	monitorInterval       time.Duration
	activityInterval      time.Duration
	activityRetentionDays int
	logger                *slog.Logger
}

func New(options Options) (*Runner, error) {
	if options.Users == nil || options.News == nil || options.NewsFetcher == nil || options.Resources == nil || options.Activities == nil || options.Integrations == nil || options.Monitoring == nil || options.Notifications == nil {
		return nil, fmt.Errorf("background jobs require user, News, resource, Activities, Integrations, Monitoring, and Notifications stores")
	}
	if options.NewsInterval <= 0 {
		options.NewsInterval = 30 * time.Minute
	}
	if options.ActivityInterval <= 0 {
		options.ActivityInterval = 24 * time.Hour
	}
	if options.MonitorInterval <= 0 {
		options.MonitorInterval = time.Minute
	}
	if options.ActivityRetentionDays < 1 || options.ActivityRetentionDays > 3650 {
		options.ActivityRetentionDays = 90
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	return &Runner{
		users: options.Users, news: options.News, newsFetcher: options.NewsFetcher,
		resources: options.Resources, activities: options.Activities, integrations: options.Integrations,
		monitoring: options.Monitoring, notifications: options.Notifications,
		newsInterval: options.NewsInterval, monitorInterval: options.MonitorInterval, activityInterval: options.ActivityInterval,
		activityRetentionDays: options.ActivityRetentionDays, logger: options.Logger,
	}, nil
}

// Run performs both maintenance jobs immediately, then repeats them until the
// application shuts down. Errors are logged per cycle; transient feed/network
// failures do not stop unrelated owners or future refreshes.
func (r *Runner) Run(ctx context.Context) error {
	workers := 4
	done := make(chan struct{}, workers)
	go func() {
		defer func() { done <- struct{}{} }()
		r.runLoop(ctx, "news feed refresh", r.newsInterval, r.refreshNews)
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		r.runLoop(ctx, "activity retention", r.activityInterval, r.pruneActivities)
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		r.runLoop(ctx, "HTTP monitor checks", r.monitorInterval, r.runMonitorChecks)
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		r.runLoop(ctx, "builtin activity providers", time.Minute, r.runBuiltinActivityProviders)
	}()
	<-ctx.Done()
	for i := 0; i < workers; i++ {
		<-done
	}
	return ctx.Err()
}

func (r *Runner) runMonitorChecks(ctx context.Context) error {
	owners, err := r.users.ListUserIDs(ctx)
	if err != nil {
		return fmt.Errorf("list accounts for HTTP monitor checks: %w", err)
	}
	var firstErr error
	for _, owner := range owners {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		monitors, err := r.monitoring.ListMonitors(ctx, owner)
		if err != nil {
			r.logger.Error("list HTTP monitors", "owner_id", owner, "error", err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		previous := make(map[string]string, len(monitors))
		for _, monitor := range monitors {
			previous[monitor.ID] = canonicalMonitorStatus(monitor.Status)
		}
		results, err := r.monitoring.RunAll(ctx, owner)
		if err != nil {
			r.logger.Error("run HTTP monitor checks", "owner_id", owner, "error", err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		byID := make(map[string]monitoring.Monitor, len(monitors))
		for _, monitor := range monitors {
			byID[monitor.ID] = monitor
		}
		for _, result := range results {
			monitor, exists := byID[result.JobID]
			if !exists {
				continue
			}
			current := canonicalMonitorStatus(result.RawStatus)
			if current == "" {
				current = canonicalMonitorStatus(result.Status)
			}
			prior := previous[monitor.ID]
			if current == "" || current == prior {
				continue
			}
			r.publishMonitorTransition(ctx, owner, monitor, prior, current)
		}
	}
	return firstErr
}

func (r *Runner) publishMonitorTransition(ctx context.Context, owner string, monitor monitoring.Monitor, previous, current string) {
	const idempotencyKeySuffix = ":unavailable"
	key := "monitor:" + monitor.ID + idempotencyKeySuffix
	if current == "healthy" {
		if _, err := r.activities.Clear(ctx, owner, "monitoring", monitor.ID, key); err != nil {
			r.logger.Warn("could not clear monitor activity", "owner_id", owner, "monitor_id", monitor.ID, "error", err)
		}
	} else {
		_, _, err := r.activities.Publish(ctx, owner, activities.Input{
			Source: "monitoring", SourceID: monitor.ID, Type: "monitor.unavailable",
			Title: "A monitored service is unavailable", Description: "A monitored service stopped responding.",
			Severity: "warning", IdempotencyKey: key, Current: true,
			Metadata: map[string]any{"monitorId": monitor.ID, "previousStatus": previous, "status": current},
		})
		if err != nil {
			r.logger.Warn("could not publish monitor activity", "owner_id", owner, "monitor_id", monitor.ID, "error", err)
		}
	}
	if !monitor.NotifyOnStatusChange || monitor.NotifyTopicID == "" {
		return
	}
	if _, err := r.notifications.GetTopic(ctx, owner, monitor.NotifyTopicID); err != nil {
		r.logger.Warn("monitor notification topic is not owned by monitor owner", "owner_id", owner, "monitor_id", monitor.ID)
		return
	}
	title := monitor.Title
	if title == "" {
		title = monitor.Endpoint
	}
	if title == "" {
		title = "Unnamed"
	}
	content := fmt.Sprintf("Monitor %q changed from %s to %s", title, previous, current)
	if _, err := r.notifications.Publish(ctx, monitor.NotifyTopicID, content, "monitoring"); err != nil {
		r.logger.Error("failed to notify monitor status change", "owner_id", owner, "monitor_id", monitor.ID, "error", err)
	}
}

func canonicalMonitorStatus(status string) string {
	switch status {
	case "healthy", "up":
		return "healthy"
	case "unhealthy", "down":
		return "unhealthy"
	case "initiated", "", "disabled":
		return status
	default:
		return status
	}
}

func (r *Runner) runLoop(ctx context.Context, name string, interval time.Duration, run func(context.Context) error) {
	if err := run(ctx); err != nil && ctx.Err() == nil {
		r.logger.Error("background maintenance cycle failed", "job", name, "error", err)
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := run(ctx); err != nil && ctx.Err() == nil {
				r.logger.Error("background maintenance cycle failed", "job", name, "error", err)
			}
		}
	}
}

func (r *Runner) refreshNews(ctx context.Context) error {
	owners, err := r.users.ListUserIDs(ctx)
	if err != nil {
		return fmt.Errorf("list accounts for News refresh: %w", err)
	}
	var firstErr error
	for _, owner := range owners {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		result, err := r.news.Refresh(ctx, owner, nil, r.newsFetcher)
		if err != nil {
			r.logger.Error("refresh News feeds", "owner_id", owner, "error", err)
			if firstErr == nil {
				firstErr = err
			}
		} else {
			if result.Failed > 0 {
				r.logger.Warn("some News feeds could not be refreshed", "owner_id", owner, "failed", result.Failed, "refreshed", result.Fetched)
			}
			if err := r.materializeNewsResources(ctx, owner); err != nil {
				r.logger.Error("materialize News resources", "owner_id", owner, "error", err)
				if firstErr == nil {
					firstErr = err
				}
			}
		}
		if err := r.reconcileNewsFeedFailureActivities(ctx, owner); err != nil {
			r.logger.Error("reconcile News feed failure activities", "owner_id", owner, "error", err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func (r *Runner) reconcileNewsFeedFailureActivities(ctx context.Context, owner string) error {
	settings, err := r.activities.DefinitionSettings(ctx, owner)
	if err != nil {
		return err
	}
	threshold := 3
	if configured, ok := settings.Config["news.feed-failures"]["repeatFailures"]; ok {
		switch value := configured.(type) {
		case float64:
			if value >= 1 && value <= 20 {
				threshold = int(value)
			}
		case int:
			if value >= 1 && value <= 20 {
				threshold = value
			}
		}
	}
	enabled := true
	if value, exists := settings.Enabled["news.feed-failures"]; exists {
		enabled = value
	}
	subscriptions, err := r.news.ListSubscriptions(ctx, owner)
	if err != nil {
		return err
	}
	activeSubscriptions := make(map[string]struct{}, len(subscriptions))
	for _, subscription := range subscriptions {
		activeSubscriptions[subscription.ID] = struct{}{}
		key := "feed:" + subscription.ID + ":failure"
		if !enabled || subscription.FetchErrorCount < threshold {
			_, err := r.activities.Clear(ctx, owner, "news", subscription.ID, key)
			if err != nil {
				return err
			}
			continue
		}
		title := subscription.Title
		if title == "" {
			title = "News feed"
		}
		_, _, err := r.activities.Publish(ctx, owner, activities.Input{
			Source: "news", SourceID: subscription.ID, Type: "news.feed-failure",
			Title:       "News feed is failing: " + title,
			Description: fmt.Sprintf("The feed has failed to refresh %d consecutive times.", subscription.FetchErrorCount),
			Severity:    "warning", IdempotencyKey: key, Current: true,
			Metadata: map[string]any{"subscriptionId": subscription.ID, "failureCount": subscription.FetchErrorCount},
		})
		if err != nil {
			return err
		}
	}
	stale := make([]activities.Record, 0)
	for pageNumber := 1; ; pageNumber++ {
		page, err := r.activities.List(ctx, owner, activities.Query{Source: "news", Type: "news.feed-failure", Page: pageNumber, PerPage: 100})
		if err != nil {
			return err
		}
		for _, item := range page.Items {
			if _, exists := activeSubscriptions[item.SourceID]; !exists {
				stale = append(stale, item)
			}
		}
		if len(page.Items) < page.PerPage || pageNumber*page.PerPage >= page.TotalItems {
			break
		}
	}
	for _, item := range stale {
		if _, err := r.activities.Clear(ctx, owner, "news", item.SourceID, item.IdempotencyKey); err != nil {
			return err
		}
	}
	return nil
}

func (r *Runner) materializeNewsResources(ctx context.Context, owner string) error {
	for offset := 0; ; offset += 100 {
		page, err := r.news.QueryArticles(ctx, owner, "all", offset, 100)
		if err != nil {
			return err
		}
		for _, article := range page.Items {
			url, _ := article.Data["link"].(string)
			if url == "" {
				url = article.CanonicalURL
			}
			summary, _ := article.Data["description"].(string)
			sourceName, _ := article.Data["subscription_name"].(string)
			data := map[string]any{
				"title": article.Title, "summary": summary, "url": url, "source": sourceName,
				"feedIds": article.SourceIDs, "isRead": article.IsRead,
			}
			if article.PublishedAt != nil {
				data["publishedAt"] = article.PublishedAt.UTC().Format(time.RFC3339Nano)
			}
			if len(article.SourceIDs) > 0 {
				data["feedId"] = article.SourceIDs[0]
			}
			if _, err := r.resources.Upsert(ctx, resources.Resource{
				Type: "news.article", Provider: "dashwise", ProviderInstanceID: "news",
				ProviderResourceID: article.ID, OwnerID: owner, Data: data,
				Capabilities: []string{"list", "detail", "search", "save", "mark_read"}, State: "current",
			}); err != nil {
				return fmt.Errorf("upsert News article %s: %w", article.ID, err)
			}
		}
		if len(page.Items) < 100 || offset+len(page.Items) >= page.Total {
			return nil
		}
	}
}

func (r *Runner) pruneActivities(ctx context.Context) error {
	deleted, err := r.activities.DeleteExpired(ctx, r.activityRetentionDays)
	if err != nil {
		return err
	}
	if deleted > 0 {
		r.logger.Info("expired historical activities removed", "deleted", deleted, "retention_days", r.activityRetentionDays)
	}
	return nil
}
