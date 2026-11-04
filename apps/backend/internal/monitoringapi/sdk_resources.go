package monitoringapi

import (
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

// sdkMonitoringResources returns SDK resources explicitly marked for
// monitoring and retained Beszel YAML system resources. It mirrors the
// monitoring UI contract while reading from the normalized owner-scoped store.
func (h *Handler) sdkMonitoringResources(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if h.sdkResources == nil || h.registry == nil || h.integrations == nil {
		writeJSON(w, http.StatusOK, map[string]any{"resources": []any{}})
		return
	}
	instances, err := h.integrations.List(r.Context(), owner, true)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load SDK integrations")
		return
	}
	byID := make(map[string]struct {
		name   string
		source string
		kind   string
		icon   string
	}, len(instances))
	for _, instance := range instances {
		if instance.Type == "sdk" {
			byID[instance.ID] = struct {
				name   string
				source string
				kind   string
				icon   string
			}{name: instance.Name, source: instance.Source, kind: "sdk"}
		} else if isBeszelIntegration(instance) {
			details, _ := instance.Config["details"].(map[string]any)
			icon, _ := details["icon"].(string)
			byID[instance.ID] = struct {
				name   string
				source string
				kind   string
				icon   string
			}{name: instance.Name, source: instance.Source, kind: "yaml", icon: icon}
		}
	}
	types, err := h.registry.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load SDK resource types")
		return
	}
	result := make([]map[string]any, 0)
	for _, definition := range types {
		if !strings.HasPrefix(definition.Type, "sdk.") {
			continue
		}
		for offset := 0; ; offset += 200 {
			page, err := h.sdkResources.Query(r.Context(), resources.Query{
				OwnerID: owner, Types: []string{definition.Type}, Provider: "sdk", Limit: 200, Offset: offset,
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, "could not load SDK monitoring resources")
				return
			}
			for _, item := range page.Items {
				instance, exists := byID[item.ProviderInstanceID]
				if !exists || !containsExact(item.Capabilities, "monitoring") && !containsExact(stringValues(item.Data["tags"]), "monitoring") {
					continue
				}
				collectionID := strings.TrimPrefix(definition.Type, "sdk."+strings.ToLower(instance.source)+".")
				if collectionID == definition.Type || collectionID == "" {
					// Resource type names are based on the integration source.
					parts := strings.Split(definition.Type, ".")
					if len(parts) >= 3 {
						collectionID = strings.Join(parts[2:], ".")
					}
				}
				data := make(map[string]any, len(item.Data)+7)
				for key, value := range item.Data {
					data[key] = value
				}
				data["instanceId"] = item.ProviderInstanceID
				data["instanceName"] = instance.name
				data["source"] = instance.source
				data["collectionId"] = collectionID
				data["capabilities"] = item.Capabilities
				data["updatedAt"] = item.UpdatedAt
				result = append(result, data)
			}
			if len(page.Items) < 200 {
				break
			}
		}
	}
	// Beszel remains a YAML integration. Its declared systems collection is
	// exposed through the same monitoring resource UI as SDK providers.
	for _, definition := range types {
		if !strings.HasPrefix(definition.Type, "integration.beszel.") || !containsExact(definition.Capabilities, "monitoring") {
			continue
		}
		for offset := 0; ; offset += 200 {
			page, err := h.sdkResources.Query(r.Context(), resources.Query{
				OwnerID: owner, Types: []string{definition.Type}, Provider: "yaml",
				Capabilities: []string{"monitoring"}, Limit: 200, Offset: offset,
			})
			if err != nil {
				writeError(w, http.StatusInternalServerError, "could not load Beszel monitoring resources")
				return
			}
			for _, item := range page.Items {
				instance, exists := byID[item.ProviderInstanceID]
				if !exists || instance.kind != "yaml" {
					continue
				}
				name, _ := item.Data["name"].(string)
				if name == "" {
					name = item.ProviderResourceID
				}
				status, _ := item.Data["status"].(string)
				state := "offline"
				if strings.EqualFold(status, "up") {
					state = "online"
				}
				attributes := map[string]any{}
				for _, field := range []string{"info", "usage", "load", "network"} {
					if value, found := item.Data[field]; found {
						attributes[field] = value
					}
				}
				result = append(result, map[string]any{
					"id": item.ProviderResourceID, "name": name, "icon": instance.icon,
					"state": state, "attributes": attributes,
					"instanceId": item.ProviderInstanceID, "instanceName": instance.name,
					"source": instance.source, "collectionId": strings.TrimPrefix(definition.Type, "integration.beszel."),
					"capabilities": item.Capabilities, "updatedAt": item.UpdatedAt,
				})
			}
			if len(page.Items) < 200 {
				break
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"resources": result})
}

func isBeszelIntegration(instance integrations.Integration) bool {
	details, _ := instance.Config["details"].(map[string]any)
	name, _ := details["name"].(string)
	slug, _ := details["slug"].(string)
	return strings.EqualFold(strings.TrimSpace(name), "Beszel") || strings.EqualFold(strings.TrimSpace(slug), "beszel") || strings.HasSuffix(strings.ToLower(instance.Source), "/beszel.yaml")
}

func containsExact(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func stringValues(value any) []string {
	switch values := value.(type) {
	case []string:
		return values
	case []any:
		result := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}
