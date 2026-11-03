package consumersapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

// ResolvePageData resolves YAML-backed widget and glanceable consumers saved
// in one page configuration. Per-consumer failures are returned in that item,
// matching the existing pageConfig integrationData contract.
func ResolvePageData(ctx context.Context, owner string, pageConfig map[string]any, store *integrations.Store, resourceStore *resources.Store) []map[string]any {
	candidates := collectPageCandidates(pageConfig)
	out := make([]map[string]any, 0, len(candidates))
	items, listErr := store.List(ctx, owner, false)
	for _, candidate := range candidates {
		base := map[string]any{"consumer": candidate.consumer, "key": candidate.key, "properties": candidate.properties, "integrationId": nil, "consumerKey": candidate.key}
		if listErr != nil {
			base["success"], base["error"] = false, "could not load integrations"
			out = append(out, base)
			continue
		}
		integration, entry, ok := findPageConsumer(items, candidate)
		if !ok {
			base["success"], base["error"] = false, "integration consumer not found"
			out = append(out, base)
			continue
		}
		base["integrationId"] = integration.ID
		if !strings.Contains(candidate.key, "#") {
			base["consumerKey"] = integration.ID + "#" + candidate.key
		}
		data, err := readIntegrationView(ctx, owner, integration, resourceStore)
		if err != nil {
			base["success"], base["error"] = false, "integration resource view is not available"
			out = append(out, base)
			continue
		}
		input := merge(candidate.properties, object(object(entry["data"])["input"]))
		widget := applyInput(entry, input)
		resolved := merge(object(entry["properties"]), map[string]any{})
		for key, value := range input {
			if _, exists := resolved[key]; exists {
				resolved[key] = value
			}
		}
		base["success"] = true
		base["data"] = data
		base["blueprint"] = map[string]any{"template": first(stringValue(entry["template"]), "columns"), "resolved": resolved, "widgetJSON": widget}
		out = append(out, base)
	}
	return out
}

type pageCandidate struct {
	consumer, key string
	properties    map[string]any
}

func collectPageCandidates(config map[string]any) []pageCandidate {
	items := make([]pageCandidate, 0)
	seen := map[string]bool{}
	push := func(kind, key string, properties map[string]any) {
		key = strings.TrimSpace(key)
		if key == "" || kind == "glanceable" && frontendPageGlanceable(key) {
			return
		}
		props := merge(properties, map[string]any{})
		delete(props, "index")
		delete(props, "_rev")
		identity := kind + ":" + key + ":" + fmt.Sprint(props)
		if seen[identity] {
			return
		}
		seen[identity] = true
		items = append(items, pageCandidate{consumer: kind, key: key, properties: props})
	}
	if columns := object(config["columns"]); columns != nil {
		for _, columnRaw := range columns {
			for key, raw := range object(columnRaw) {
				if frontendPageWidget(key) {
					if key == "main-clock" {
						for name, props := range object(object(raw)["glanceables"]) {
							push("glanceable", name, object(props))
						}
					}
					continue
				}
				push("widget", key, object(raw))
			}
		}
	}
	for _, raw := range array(config["glanceables"]) {
		entry := object(raw)
		kind := stringValue(entry["type"])
		props := merge(entry, map[string]any{})
		delete(props, "type")
		push("glanceable", kind, props)
	}
	return items
}

func findPageConsumer(items []integrations.Integration, candidate pageCandidate) (integrations.Integration, map[string]any, bool) {
	wantedID, wantedKey := splitComposite(candidate.key)
	for _, item := range items {
		if wantedID != "" && item.ID != wantedID {
			continue
		}
		section := "widgets"
		if candidate.consumer == "glanceable" {
			section = "glanceables"
		}
		for _, raw := range array(object(object(item.Config["configuration"])[section])) {
			entry := object(raw)
			key := consumerKey(entry)
			if key == "" && candidate.consumer == "glanceable" {
				key = slug(stringValue(entry["name"]))
			}
			if normalizeKey(key) == normalizeKey(wantedKey) || candidate.consumer == "glanceable" && normalizeKey(stringValue(entry["type"])) == normalizeKey(wantedKey) {
				return item, entry, true
			}
		}
	}
	return integrations.Integration{}, nil, false
}

func frontendPageWidget(key string) bool {
	switch key {
	case "placeholder", "main-clock", "glanceable-clock", "search-bar", "link-view":
		return true
	default:
		return false
	}
}

func frontendPageGlanceable(key string) bool {
	switch key {
	case "date", "greeting", "local-timezone", "world-clock", "latest-activities":
		return true
	default:
		return false
	}
}
