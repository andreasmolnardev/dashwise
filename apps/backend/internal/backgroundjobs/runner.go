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
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/news"
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
	NewsInterval          time.Duration
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
	newsInterval          time.Duration
	activityInterval      time.Duration
	activityRetentionDays int
	logger                *slog.Logger
}

func New(options Options) (*Runner, error) {
	if options.Users == nil || options.News == nil || options.NewsFetcher == nil || options.Resources == nil || options.Activities == nil {
		return nil, fmt.Errorf("background jobs require user, News, resource, and Activities stores")
	}
	if options.NewsInterval <= 0 {
		options.NewsInterval = 30 * time.Minute
	}
	if options.ActivityInterval <= 0 {
		options.ActivityInterval = 24 * time.Hour
	}
	if options.ActivityRetentionDays < 1 || options.ActivityRetentionDays > 3650 {
		options.ActivityRetentionDays = 90
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	return &Runner{
		users: options.Users, news: options.News, newsFetcher: options.NewsFetcher,
		resources: options.Resources, activities: options.Activities,
		newsInterval: options.NewsInterval, activityInterval: options.ActivityInterval,
		activityRetentionDays: options.ActivityRetentionDays, logger: options.Logger,
	}, nil
}

// Run performs both maintenance jobs immediately, then repeats them until the
// application shuts down. Errors are logged per cycle; transient feed/network
// failures do not stop unrelated owners or future refreshes.
func (r *Runner) Run(ctx context.Context) error {
	workers := 2
	done := make(chan struct{}, workers)
	go func() {
		defer func() { done <- struct{}{} }()
		r.runLoop(ctx, "news feed refresh", r.newsInterval, r.refreshNews)
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		r.runLoop(ctx, "activity retention", r.activityInterval, r.pruneActivities)
	}()
	<-ctx.Done()
	for i := 0; i < workers; i++ {
		<-done
	}
	return ctx.Err()
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
			continue
		}
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
	return firstErr
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
			data := map[string]any{"title": article.Title, "summary": summary, "url": url, "source": sourceName}
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
