package consumersapi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourcesync"
)

func consumerResourceQuery(consumer map[string]any) (any, bool) {
	query, ok := consumer["resource_query"]
	if !ok {
		query, ok = consumer["resourceQuery"]
	}
	return query, ok
}

// queryConsumerResources executes a consumer-declared ResourceQuery under the
// authenticated owner. A manifest can select types and filters, but cannot
// supply or override the owner scope.
func queryConsumerResources(ctx context.Context, owner string, declaration any, store *resources.Store) (map[string]any, error) {
	if store == nil {
		return nil, fmt.Errorf("resource store is unavailable")
	}
	encoded, err := json.Marshal(declaration)
	if err != nil {
		return nil, fmt.Errorf("encode widget resource query: %w", err)
	}
	var query resources.Query
	if err := json.Unmarshal(encoded, &query); err != nil {
		return nil, fmt.Errorf("decode widget resource query: %w", err)
	}
	if len(query.Types) == 0 {
		return nil, fmt.Errorf("widget resource query must select at least one type")
	}
	query.OwnerID = owner
	page, err := store.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query widget resources: %w", err)
	}
	return map[string]any{"items": page.Items, "total": page.Total, "limit": page.Limit, "offset": page.Offset}, nil
}

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
