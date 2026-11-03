package consumersapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourcesync"
)

// readIntegrationView evaluates the integration's materialized endpoint and
// computed resources into the shape the retained YAML widget renderer expects.
// The resource query remains owner and provider-instance scoped.
func readIntegrationView(ctx context.Context, owner string, integration integrations.Integration, store *resources.Store) (map[string]any, error) {
	if store == nil {
		return nil, fmt.Errorf("resource store is unavailable")
	}
	typeName := resourcesync.YAMLResultResourceType(integration)
	endpoints, computed := map[string]any{}, map[string]any{}
	for offset := 0; ; offset += 200 {
		page, err := store.Query(ctx, resources.Query{
			OwnerID: owner, Types: []string{typeName}, Provider: "yaml", InstanceID: integration.ID, Limit: 200, Offset: offset,
		})
		if err != nil {
			return nil, fmt.Errorf("query integration view resources: %w", err)
		}
		for _, item := range page.Items {
			id := item.ProviderResourceID
			switch {
			case strings.HasPrefix(id, "endpoint:"):
				endpoints[strings.TrimPrefix(id, "endpoint:")] = item.Data["payload"]
			case strings.HasPrefix(id, "computed:"):
				computed[strings.TrimPrefix(id, "computed:")] = item.Data["payload"]
			}
		}
		if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
			break
		}
	}
	for key, value := range endpoints {
		if _, exists := computed[key]; !exists {
			computed[key] = value
		}
	}
	return computed, nil
}
