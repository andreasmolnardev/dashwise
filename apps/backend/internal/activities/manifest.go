package activities

import (
	"context"
	"errors"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/notifications"
)

// SDKManifest is the manifest view of a retained, trusted SDK integration
// definition. It carries only the fields needed to surface declared activity
// definitions; nothing here executes provider code.
type SDKManifest struct {
	ID          string           `json:"id,omitempty"`
	Name        string           `json:"name,omitempty"`
	Description string           `json:"description,omitempty"`
	Activities  []map[string]any `json:"activities,omitempty"`
}

// SDKActivityDeclaration is one activity declared by a retained SDK manifest.
type SDKActivityDeclaration struct {
	ID          string
	Title       string
	Description string
}

const sdkDefinitionPrefix = "sdk:"

// ValidSDKActivityID reports whether an activity declaration ID from a
// retained SDK manifest may participate in a definition identifier.
func ValidSDKActivityID(value string) bool {
	return conditionIdentifierPattern.MatchString(value)
}

// SDKActivityDefinitionID builds the owner-stable definition identifier for one
// SDK integration instance's declared activity. It returns an empty string when
// the identifiers cannot form a definition.
func SDKActivityDefinitionID(instanceID, activityID string) string {
	if strings.TrimSpace(instanceID) == "" || !ValidSDKActivityID(activityID) {
		return ""
	}
	return sdkDefinitionPrefix + instanceID + ":" + activityID
}

// ParseSDKActivityDefinitionID splits an SDK activity definition identifier
// back into its instance and declaration IDs. Non-SDK definition IDs are not ok.
func ParseSDKActivityDefinitionID(definitionID string) (instanceID, activityID string, ok bool) {
	rest, isSDK := strings.CutPrefix(definitionID, sdkDefinitionPrefix)
	if !isSDK {
		return "", "", false
	}
	instanceID, activityID, found := strings.Cut(rest, ":")
	if !found || instanceID == "" || strings.Contains(activityID, ":") || !ValidSDKActivityID(activityID) {
		return "", "", false
	}
	return instanceID, activityID, true
}

// ManifestActivityDeclarations validates an SDK manifest's declared activities
// in stable declaration order. Undeclared or malformed entries are skipped so a
// single bad definition cannot hide the rest of the catalog.
func ManifestActivityDeclarations(manifest SDKManifest) []SDKActivityDeclaration {
	declarations := make([]SDKActivityDeclaration, 0, len(manifest.Activities))
	seen := map[string]bool{}
	for _, entry := range manifest.Activities {
		id := strings.TrimSpace(textValue(entry["id"]))
		if !ValidSDKActivityID(id) || seen[id] {
			continue
		}
		seen[id] = true
		declarations = append(declarations, SDKActivityDeclaration{
			ID:          id,
			Title:       firstNonempty(textValue(entry["title"]), manifest.Name+" "+id),
			Description: strings.TrimSpace(textValue(entry["description"])),
		})
	}
	return declarations
}

// ManifestActivityDeclaration resolves one declared activity by ID and reports
// whether the retained manifest declares it.
func ManifestActivityDeclaration(manifest SDKManifest, activityID string) (SDKActivityDeclaration, bool) {
	for _, declaration := range ManifestActivityDeclarations(manifest) {
		if declaration.ID == activityID {
			return declaration, true
		}
	}
	return SDKActivityDeclaration{}, false
}

// DefinitionTopicPreference reads the notification topic IDs configured on one
// definition's saved preference. A nil result means no topic filter applies.
func DefinitionTopicPreference(settings DefinitionSettings, definitionID string) []string {
	config, ok := settings.Config[definitionID]
	if !ok {
		return nil
	}
	topics, _ := stringArray(config["notificationTopics"])
	return topics
}

// TopicsRelevant reports whether any notification topic in the configured
// filter currently has unread items for the owner. No filter, no topics store,
// or a store error keeps the definition relevant, mirroring the user resource
// condition behavior.
func TopicsRelevant(ctx context.Context, owner string, topicStore *notifications.Store, topicIDs []string) bool {
	return conditionTopicsRelevant(ctx, owner, topicStore, topicIDs)
}

// resolveSDKActivityDeclaration confirms that one owned, enabled SDK
// integration instance declares the given activity in its retained manifest.
func resolveSDKActivityDeclaration(ctx context.Context, integrationStore *integrations.Store, retained []SDKManifest, owner, instanceID, activityID string) (SDKActivityDeclaration, error) {
	instance, err := integrationStore.Get(ctx, owner, instanceID)
	if errors.Is(err, integrations.ErrNotFound) {
		return SDKActivityDeclaration{}, ErrNotFound
	}
	if err != nil {
		return SDKActivityDeclaration{}, err
	}
	if instance.Type != "sdk" {
		return SDKActivityDeclaration{}, ErrNotFound
	}
	for _, manifest := range retained {
		if manifest.ID != strings.ToLower(strings.TrimSpace(instance.Source)) {
			continue
		}
		if declaration, declared := ManifestActivityDeclaration(manifest, activityID); declared {
			return declaration, nil
		}
		return SDKActivityDeclaration{}, ErrNotFound
	}
	return SDKActivityDeclaration{}, ErrNotFound
}
