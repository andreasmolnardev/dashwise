// Package resourcesync materializes native Dashwise domains into the common
// resource store. Domain stores remain authoritative for their workflows.
package resourcesync

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/links"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/monitoring"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

const (
	provider           = "dashwise"
	linksInstance      = "links"
	monitoringInstance = "monitoring"
)

// SyncOwner refreshes built-in resources for one account. Calls are safe to
// repeat; source record IDs remain stable provider identities.
func SyncOwner(ctx context.Context, owner string, linkStore *links.Store, monitorStore *monitoring.Store, resourceStore *resources.Store) error {
	if strings.TrimSpace(owner) == "" || resourceStore == nil {
		return fmt.Errorf("resource sync requires an owner and resource store")
	}
	if linkStore != nil {
		if err := syncLinks(ctx, owner, linkStore, resourceStore); err != nil {
			return err
		}
	}
	if monitorStore != nil {
		if err := syncMonitoring(ctx, owner, monitorStore, resourceStore); err != nil {
			return err
		}
	}
	return nil
}

// SyncMonitoringOwner refreshes only monitoring resources after a monitoring
// domain mutation. The periodic owner sync remains responsible for all native
// resource types.
func SyncMonitoringOwner(ctx context.Context, owner string, monitorStore *monitoring.Store, resourceStore *resources.Store) error {
	if strings.TrimSpace(owner) == "" || monitorStore == nil || resourceStore == nil {
		return fmt.Errorf("monitoring resource sync requires an owner, monitoring store, and resource store")
	}
	return syncMonitoring(ctx, owner, monitorStore, resourceStore)
}

func syncLinks(ctx context.Context, owner string, source *links.Store, target *resources.Store) error {
	collections, err := source.ListCollections(ctx, owner)
	if err != nil {
		return fmt.Errorf("list link collections for resource sync: %w", err)
	}
	collectionNames := make(map[string]string, len(collections))
	wanted := map[string]bool{}
	for _, collection := range collections {
		collectionNames[collection.ID] = collection.Name
		items, err := source.ListItems(ctx, owner, collection.ID, nil)
		if err != nil {
			return fmt.Errorf("list links for resource sync: %w", err)
		}
		for _, item := range items {
			wanted[item.ID] = true
			data := map[string]any{
				"title":        item.Title,
				"url":          item.URL,
				"description":  item.Description,
				"collectionId": item.Collection,
				"favorite":     item.Favorite,
				"createdAt":    item.Created.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"),
			}
			if collectionNames[item.Collection] != "" {
				data["collectionName"] = collectionNames[item.Collection]
			}
			if item.IconURL != "" {
				data["iconUrl"] = item.IconURL
			}
			if item.Folder != "" {
				data["folderId"] = item.Folder
			}
			if len(item.Tags) > 0 {
				data["tags"] = item.Tags
			}
			if len(item.SecondaryURLs) > 0 {
				data["secondaryUrls"] = item.SecondaryURLs
			}
			if _, err := target.Upsert(ctx, resources.Resource{
				Type: "dashwise.link", Provider: provider, ProviderInstanceID: linksInstance,
				ProviderResourceID: item.ID, OwnerID: owner, Data: data,
				Capabilities: []string{"list", "detail", "search", "launch", "actions"}, State: "current",
			}); err != nil {
				return fmt.Errorf("materialize link %q: %w", item.ID, err)
			}
		}
	}
	return reconcile(ctx, owner, target, "dashwise.link", linksInstance, wanted)
}

func syncMonitoring(ctx context.Context, owner string, source *monitoring.Store, target *resources.Store) error {
	wantedHosts := map[string]bool{}
	hosts, err := source.ListHosts(ctx, owner)
	if err != nil {
		return fmt.Errorf("list monitoring hosts for resource sync: %w", err)
	}
	for _, host := range hosts {
		wantedHosts[host.ID] = true
		data := map[string]any{
			"name":     host.Name,
			"hostname": host.Hostname,
			"status":   host.Status,
		}
		if stamp, ok := host.SystemInfo["lastConnectedAt"].(string); ok && stamp != "" {
			data["lastConnectedAt"] = stamp
		}
		if _, err := target.Upsert(ctx, resources.Resource{
			Type: "monitoring.host", Provider: provider, ProviderInstanceID: monitoringInstance,
			ProviderResourceID: host.ID, OwnerID: owner, Data: data,
			Capabilities: []string{"list", "detail", "monitoring", "history"}, State: "current",
		}); err != nil {
			return fmt.Errorf("materialize monitoring host %q: %w", host.ID, err)
		}
	}
	if err := reconcile(ctx, owner, target, "monitoring.host", monitoringInstance, wantedHosts); err != nil {
		return err
	}

	wantedMonitors := map[string]bool{}
	monitors, err := source.ListMonitors(ctx, owner)
	if err != nil {
		return fmt.Errorf("list monitors for resource sync: %w", err)
	}
	for _, monitor := range monitors {
		wantedMonitors[monitor.ID] = true
		name := strings.TrimSpace(monitor.Title)
		if name == "" {
			name = monitor.Endpoint
		}
		data := map[string]any{
			"name":   name,
			"url":    redactEndpoint(monitor.Endpoint),
			"status": monitor.Status,
		}
		if monitor.LinkID != "" {
			data["linkId"] = monitor.LinkID
		}
		if len(monitor.Pings) > 0 {
			data["checkedAt"] = monitor.Pings[0].Created.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
		}
		if _, err := target.Upsert(ctx, resources.Resource{
			Type: "monitoring.service", Provider: provider, ProviderInstanceID: monitoringInstance,
			ProviderResourceID: monitor.ID, OwnerID: owner, Data: data,
			Capabilities: []string{"list", "detail", "monitoring", "history"}, State: "current",
		}); err != nil {
			return fmt.Errorf("materialize monitored service %q: %w", monitor.ID, err)
		}
	}
	return reconcile(ctx, owner, target, "monitoring.service", monitoringInstance, wantedMonitors)
}

func reconcile(ctx context.Context, owner string, target *resources.Store, resourceType, instance string, wanted map[string]bool) error {
	stale := []resources.Resource{}
	for offset := 0; ; offset += 200 {
		page, err := target.Query(ctx, resources.Query{OwnerID: owner, Types: []string{resourceType}, Provider: provider, InstanceID: instance, Limit: 200, Offset: offset})
		if err != nil {
			return fmt.Errorf("query materialized %s resources: %w", resourceType, err)
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
			return fmt.Errorf("remove stale %s resource: %w", resourceType, err)
		}
	}
	return nil
}

func redactEndpoint(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	u.User = nil
	query := u.Query()
	for key := range query {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "password") || strings.Contains(lower, "apikey") || lower == "key" || lower == "auth" {
			query.Del(key)
		}
	}
	u.RawQuery = query.Encode()
	return u.String()
}
