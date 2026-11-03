package monitoringapi

import (
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

// sdkMonitoringResources returns SDK resources explicitly marked for
// monitoring. It mirrors the retained monitoring settings API while reading
// from the normalized owner-scoped resource store.
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
	}, len(instances))
	for _, instance := range instances {
		if instance.Type == "sdk" {
			byID[instance.ID] = struct {
				name   string
				source string
			}{name: instance.Name, source: instance.Source}
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
	writeJSON(w, http.StatusOK, map[string]any{"resources": result})
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
