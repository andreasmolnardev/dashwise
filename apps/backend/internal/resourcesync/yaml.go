package resourcesync

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/yamlruntime"
)

var resourceTypeSlugPattern = regexp.MustCompile(`[^a-z0-9_.-]+`)

// SyncYAMLResources executes configured YAML endpoint collections and
// materializes each item into the shared resource store. Failed integrations
// keep their last successful snapshot; other instances continue syncing.
func SyncYAMLResources(ctx context.Context, owner string, source *integrations.Store, runtime *yamlruntime.Runtime, registry *resources.Registry, target *resources.Store) error {
	if strings.TrimSpace(owner) == "" || source == nil || runtime == nil || registry == nil || target == nil {
		return fmt.Errorf("YAML resource sync requires an owner, integration store, runtime, registry, and resource store")
	}
	items, err := source.List(ctx, owner, false)
	if err != nil {
		return fmt.Errorf("list YAML integrations for resource sync: %w", err)
	}
	var firstErr error
	activeInstances := make(map[string]bool, len(items))
	for _, item := range items {
		if item.Type == "sdk" {
			continue
		}
		activeInstances[item.ID] = true
		collections := yamlResourceCollections(item.Config)
		if len(collections) == 0 {
			if err := reconcileYAMLInstance(ctx, owner, target, item.ID, map[string]bool{}); err != nil && firstErr == nil {
				firstErr = err
			}
			continue
		}
		result, err := runtime.Execute(ctx, item.Config, item.Environment)
		if err != nil {
			// Preserve the previous materialization on request or mapping errors.
			if firstErr == nil {
				firstErr = fmt.Errorf("execute YAML integration %q: %w", item.ID, err)
			}
			continue
		}
		wanted := map[string]bool{}
		integrationFailed := false
		for _, collection := range collections {
			definition := collection.definition(item)
			if err := registry.Register(ctx, definition); err != nil {
				integrationFailed = true
				if firstErr == nil {
					firstErr = fmt.Errorf("register YAML resource type %q: %w", definition.Type, err)
				}
				continue
			}
			endpoint, ok := result.Endpoints[collection.endpoint]
			if !ok {
				integrationFailed = true
				if firstErr == nil {
					firstErr = fmt.Errorf("YAML resource collection %q references missing endpoint %q", collection.id, collection.endpoint)
				}
				continue
			}
			rows, ok := asSlice(endpoint.MappedResponse)
			if !ok {
				integrationFailed = true
				if firstErr == nil {
					firstErr = fmt.Errorf("YAML resource endpoint %q must return an array", collection.endpoint)
				}
				continue
			}
			for index, raw := range rows {
				row, ok := raw.(map[string]any)
				if !ok {
					integrationFailed = true
					if firstErr == nil {
						firstErr = fmt.Errorf("YAML resource collection %q item %d must be an object", collection.id, index)
					}
					break
				}
				idValue, found := yamlPath(row, collection.idPath)
				id := fmt.Sprint(idValue)
				if !found || strings.TrimSpace(id) == "" || id == "<nil>" {
					integrationFailed = true
					if firstErr == nil {
						firstErr = fmt.Errorf("YAML resource collection %q item %d has no ID at %q", collection.id, index, collection.idPath)
					}
					break
				}
				data := make(map[string]any, len(collection.fields))
				for _, field := range collection.fields {
					if value, exists := yamlPath(row, field.source); exists {
						data[field.name] = value
					}
				}
				if collection.namePath != "" {
					if value, exists := yamlPath(row, collection.namePath); exists {
						data["name"] = value
					}
				}
				if _, err := target.Upsert(ctx, resources.Resource{
					Type: definition.Type, Provider: "yaml", ProviderInstanceID: item.ID,
					ProviderResourceID: collection.id + ":" + id, OwnerID: owner, Data: data,
					Capabilities: collection.capabilities, State: "current",
				}); err != nil {
					integrationFailed = true
					if firstErr == nil {
						firstErr = fmt.Errorf("materialize YAML resource %q/%q: %w", collection.id, id, err)
					}
					break
				}
				wanted[definition.Type+"\n"+collection.id+":"+id] = true
			}
		}
		if !integrationFailed {
			if err := reconcileYAMLInstance(ctx, owner, target, item.ID, wanted); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	if err := removeOrphanYAMLInstances(ctx, owner, target, activeInstances); err != nil && firstErr == nil {
		firstErr = err
	}
	return firstErr
}

func reconcileYAMLInstance(ctx context.Context, owner string, target *resources.Store, instanceID string, wanted map[string]bool) error {
	stale := make([]resources.Resource, 0)
	for offset := 0; ; offset += 200 {
		page, err := target.Query(ctx, resources.Query{OwnerID: owner, Provider: "yaml", InstanceID: instanceID, Limit: 200, Offset: offset})
		if err != nil {
			return fmt.Errorf("query YAML resources for reconciliation: %w", err)
		}
		for _, item := range page.Items {
			if !wanted[item.Type+"\n"+item.ProviderResourceID] {
				stale = append(stale, item)
			}
		}
		if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
			break
		}
	}
	for _, item := range stale {
		if err := target.Delete(ctx, owner, item.ID); err != nil {
			return fmt.Errorf("remove stale YAML resource: %w", err)
		}
	}
	return nil
}

func removeOrphanYAMLInstances(ctx context.Context, owner string, target *resources.Store, active map[string]bool) error {
	orphans := make([]resources.Resource, 0)
	for offset := 0; ; offset += 200 {
		page, err := target.Query(ctx, resources.Query{OwnerID: owner, Provider: "yaml", Limit: 200, Offset: offset})
		if err != nil {
			return fmt.Errorf("query YAML resources for removed integrations: %w", err)
		}
		for _, item := range page.Items {
			if !active[item.ProviderInstanceID] {
				orphans = append(orphans, item)
			}
		}
		if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
			break
		}
	}
	for _, item := range orphans {
		if err := target.Delete(ctx, owner, item.ID); err != nil {
			return fmt.Errorf("remove YAML resource from deleted integration: %w", err)
		}
	}
	return nil
}

type yamlResourceField struct {
	name, kind, source     string
	filterable, searchable bool
}

type yamlResourceCollection struct {
	id, endpoint, idPath, namePath string
	fields                         []yamlResourceField
	capabilities                   []string
}

func yamlResourceCollections(config map[string]any) []yamlResourceCollection {
	configuration := object(config["configuration"])
	rawCollections, ok := configuration["resources"].(map[string]any)
	if !ok {
		return nil
	}
	out := make([]yamlResourceCollection, 0, len(rawCollections))
	for id, raw := range rawCollections {
		value := object(raw)
		endpoint := strings.TrimSpace(stringValue(value["endpoint"]))
		idPath := strings.TrimSpace(stringValue(value["id_path"]))
		if endpoint == "" || idPath == "" {
			continue
		}
		collection := yamlResourceCollection{id: id, endpoint: endpoint, idPath: idPath, namePath: strings.TrimSpace(stringValue(value["name_path"]))}
		for _, rawField := range asArray(value["fields"]) {
			field := object(rawField)
			name := strings.TrimSpace(stringValue(field["name"]))
			kind := strings.TrimSpace(stringValue(field["type"]))
			source := strings.TrimSpace(stringValue(field["source"]))
			if name == "" || kind == "" || source == "" {
				continue
			}
			collection.fields = append(collection.fields, yamlResourceField{
				name: name, kind: kind, source: source,
				filterable: boolValue(field["filterable"]), searchable: boolValue(field["searchable"]),
			})
		}
		collection.capabilities = stringArray(value["capabilities"])
		if len(collection.capabilities) == 0 {
			collection.capabilities = []string{"list", "detail"}
			for _, field := range collection.fields {
				if field.searchable {
					collection.capabilities = append(collection.capabilities, "search")
					break
				}
			}
		}
		out = append(out, collection)
	}
	return out
}

func (c yamlResourceCollection) definition(item integrations.Integration) resources.Definition {
	base := first(stringValue(object(item.Config["details"])["slug"]), stringValue(object(item.Config["details"])["name"]), item.Name, item.ID)
	slug := strings.ToLower(strings.Trim(resourceTypeSlugPattern.ReplaceAllString(base, "-"), "-."))
	if slug == "" {
		slug = "integration"
	}
	collectionSlug := strings.ToLower(strings.Trim(resourceTypeSlugPattern.ReplaceAllString(c.id, "-"), "-."))
	if collectionSlug == "" {
		collectionSlug = "resources"
	}
	fields := make([]resources.FieldDefinition, 0, len(c.fields)+1)
	if c.namePath != "" {
		fields = append(fields, resources.FieldDefinition{Name: "name", Type: "string", Searchable: true})
	}
	for _, field := range c.fields {
		if field.name == "name" && c.namePath != "" {
			continue
		}
		fields = append(fields, resources.FieldDefinition{Name: field.name, Type: field.kind, Filterable: field.filterable, Searchable: field.searchable})
	}
	return resources.Definition{Type: "integration." + slug + "." + collectionSlug, Version: 1, Title: item.Name + " " + c.id, Fields: fields, Capabilities: c.capabilities}
}

func yamlPath(value any, path string) (any, bool) {
	if path == "" || path == "." {
		return value, true
	}
	current := value
	for _, part := range strings.Split(strings.TrimPrefix(path, "$."), ".") {
		switch node := current.(type) {
		case map[string]any:
			var ok bool
			current, ok = node[part]
			if !ok {
				return nil, false
			}
		case []any:
			index := -1
			for _, char := range part {
				if char < '0' || char > '9' {
					index = -1
					break
				}
				if index < 0 {
					index = 0
				}
				index = index*10 + int(char-'0')
			}
			if index < 0 || index >= len(node) {
				return nil, false
			}
			current = node[index]
		default:
			return nil, false
		}
	}
	return current, true
}

func asSlice(value any) ([]any, bool) { out, ok := value.([]any); return out, ok }
func asArray(value any) []any         { out, _ := value.([]any); return out }
func boolValue(value any) bool        { out, _ := value.(bool); return out }
func stringArray(value any) []string {
	values, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if item, ok := value.(string); ok && strings.TrimSpace(item) != "" {
			out = append(out, strings.TrimSpace(item))
		}
	}
	return out
}

func object(value any) map[string]any {
	out, _ := value.(map[string]any)
	return out
}

func stringValue(value any) string {
	out, _ := value.(string)
	return out
}

func first(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
