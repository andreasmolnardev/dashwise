package activities

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/notifications"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
)

// DefinitionSettings is private to an account and contains presentation
// preferences plus user-authored resource conditions.
type DefinitionSettings struct {
	Enabled    map[string]bool             `json:"enabled,omitempty"`
	Config     map[string]map[string]any   `json:"config,omitempty"`
	Conditions []ResourceActivityCondition `json:"conditions,omitempty"`
}

type ResourceActivityCondition struct {
	ID                 string   `json:"id"`
	Title              string   `json:"title"`
	Description        string   `json:"description,omitempty"`
	InstanceID         string   `json:"instanceId"`
	CollectionID       string   `json:"collectionId"`
	ResourceID         string   `json:"resourceId,omitempty"`
	FieldPath          string   `json:"fieldPath"`
	Operator           string   `json:"operator"`
	Value              any      `json:"value,omitempty"`
	Severity           string   `json:"severity"`
	NotificationTopics []string `json:"notificationTopics,omitempty"`
}

type ActivityConfigOption struct {
	Label string `json:"label"`
	Value any    `json:"value"`
}

type ActivityConfigField struct {
	Key         string                 `json:"key"`
	Label       string                 `json:"label"`
	Description string                 `json:"description,omitempty"`
	Type        string                 `json:"type"`
	Min         *float64               `json:"min,omitempty"`
	Max         *float64               `json:"max,omitempty"`
	Step        *float64               `json:"step,omitempty"`
	Options     []ActivityConfigOption `json:"options,omitempty"`
}

type ActivityDefinitionView struct {
	ID                 string                `json:"id"`
	Title              string                `json:"title"`
	Description        string                `json:"description"`
	Source             string                `json:"source"`
	SourceID           string                `json:"sourceId,omitempty"`
	SourceName         string                `json:"sourceName,omitempty"`
	Enabled            bool                  `json:"enabled"`
	Config             map[string]any        `json:"config"`
	ConfigFields       []ActivityConfigField `json:"configFields"`
	ActiveCount        int                   `json:"activeCount,omitempty"`
	AvailabilityReason string                `json:"availabilityReason,omitempty"`
}

type ActivityResourceCatalogEntry struct {
	InstanceID   string   `json:"instanceId"`
	InstanceName string   `json:"instanceName"`
	CollectionID string   `json:"collectionId"`
	ResourceID   string   `json:"resourceId,omitempty"`
	Name         string   `json:"name"`
	Fields       []string `json:"fields"`
}

type builtinDefinition struct {
	ID, Title, Description string
	Defaults               map[string]any
	Fields                 []ActivityConfigField
}

func numberPointer(value float64) *float64 { return &value }

var notificationTopicsField = ActivityConfigField{Key: "notificationTopics", Label: "Related notification topics", Description: "Optionally show this activity only while one of these topics has unread notifications.", Type: "topics"}

var builtinDefinitions = []builtinDefinition{
	{ID: "calendar.upcoming", Title: "Upcoming calendar events", Description: "Keep events visible from the configured lead time through their end time.", Defaults: map[string]any{"windowMinutes": 30, "notificationTopics": []string{}}, Fields: []ActivityConfigField{{Key: "windowMinutes", Label: "Upcoming window (minutes)", Type: "number", Min: numberPointer(0), Max: numberPointer(1440)}, notificationTopicsField}},
	{ID: "notifications.unread", Title: "Unread notifications", Description: "Show the current unread notification count. Notification Topics remain separate from Activities.", Defaults: map[string]any{"notificationTopics": []string{}}, Fields: []ActivityConfigField{notificationTopicsField}},
	{ID: "sun.events", Title: "Sunrise and sunset", Description: "Show the next sunrise or sunset as it approaches.", Defaults: map[string]any{"windowMinutes": 60, "notificationTopics": []string{}}, Fields: []ActivityConfigField{{Key: "windowMinutes", Label: "Upcoming window (minutes)", Type: "number", Min: numberPointer(1), Max: numberPointer(1440)}, notificationTopicsField}},
	{ID: "weather.warnings", Title: "Weather warnings", Description: "Show active warnings when a configured weather service provides them.", Defaults: map[string]any{"notificationTopics": []string{}}, Fields: []ActivityConfigField{notificationTopicsField}},
	{ID: "news.feed-failures", Title: "News feed failures", Description: "Aggregate feeds after repeated refresh failures and clear after a successful refresh.", Defaults: map[string]any{"repeatFailures": 3, "notificationTopics": []string{}}, Fields: []ActivityConfigField{{Key: "repeatFailures", Label: "Failures before showing", Type: "number", Min: numberPointer(1), Max: numberPointer(20)}, notificationTopicsField}},
	{ID: "monitoring.issues", Title: "Monitoring issues", Description: "Keep unavailable monitored services visible until they recover.", Defaults: map[string]any{"notificationTopics": []string{}}, Fields: []ActivityConfigField{notificationTopicsField}},
	{ID: "integrations.connection-failures", Title: "Integration connection failures", Description: "Show failed integrations until their connection recovers.", Defaults: map[string]any{"notificationTopics": []string{}}, Fields: []ActivityConfigField{notificationTopicsField}},
	{ID: "jobs.issues", Title: "Background job issues", Description: "Show meaningful ongoing or failed background jobs while they remain relevant.", Defaults: map[string]any{"notificationTopics": []string{}}, Fields: []ActivityConfigField{notificationTopicsField}},
	{ID: "integrations.updates", Title: "Integration updates", Description: "Show available YAML integration updates until they are installed.", Defaults: map[string]any{"notificationTopics": []string{}}, Fields: []ActivityConfigField{notificationTopicsField}},
}

var conditionIdentifierPattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,240}$`)

func ListDefinitionViews(ctx context.Context, store *Store, owner string, topicStore *notifications.Store) ([]ActivityDefinitionView, error) {
	settings, err := store.DefinitionSettings(ctx, owner)
	if err != nil {
		return nil, err
	}
	topics, err := listTopicOptions(ctx, owner, topicStore)
	if err != nil {
		return nil, err
	}
	views := make([]ActivityDefinitionView, 0, len(builtinDefinitions)+len(settings.Conditions))
	for _, definition := range builtinDefinitions {
		config := map[string]any{}
		for key, value := range definition.Defaults {
			config[key] = value
		}
		for key, value := range settings.Config[definition.ID] {
			config[key] = value
		}
		fields := withTopicOptions(definition.Fields, topics)
		views = append(views, ActivityDefinitionView{ID: definition.ID, Title: definition.Title, Description: definition.Description, Source: "builtin", Enabled: settingEnabled(settings, definition.ID, true), Config: config, ConfigFields: fields})
	}
	for _, condition := range settings.Conditions {
		config, _ := jsonObject(condition)
		views = append(views, ActivityDefinitionView{ID: "condition:" + condition.ID, Title: condition.Title, Description: firstNonempty(condition.Description, "When "+condition.FieldPath+" "+condition.Operator), Source: "user", SourceID: condition.InstanceID, SourceName: condition.CollectionID, Enabled: settingEnabled(settings, "condition:"+condition.ID, true), Config: config, ConfigFields: withTopicOptions([]ActivityConfigField{notificationTopicsField}, topics)})
	}
	return views, nil
}

func SaveDefinitionPreference(ctx context.Context, store *Store, topicStore *notifications.Store, owner, definitionID string, enabled *bool, config map[string]any) (ActivityDefinitionView, error) {
	settings, err := store.DefinitionSettings(ctx, owner)
	if err != nil {
		return ActivityDefinitionView{}, err
	}
	var fields []ActivityConfigField
	if definitionID == "" {
		return ActivityDefinitionView{}, ErrNotFound
	}
	if strings.HasPrefix(definitionID, "condition:") {
		conditionID := strings.TrimPrefix(definitionID, "condition:")
		index := conditionIndex(settings.Conditions, conditionID)
		if index < 0 {
			return ActivityDefinitionView{}, ErrNotFound
		}
		fields = []ActivityConfigField{notificationTopicsField}
		if config != nil {
			for key := range config {
				if key != "title" && key != "description" && key != "notificationTopics" {
					return ActivityDefinitionView{}, ErrInvalid
				}
			}
			condition := &settings.Conditions[index]
			if raw, ok := config["title"]; ok {
				title, valid := raw.(string)
				title = strings.TrimSpace(title)
				if !valid || title == "" || len(title) > 120 {
					return ActivityDefinitionView{}, fmt.Errorf("condition title must be 1 to 120 characters")
				}
				condition.Title = title
			}
			if raw, ok := config["description"]; ok {
				if description, valid := raw.(string); valid {
					condition.Description = description[:min(500, len(description))]
				} else {
					return ActivityDefinitionView{}, ErrInvalid
				}
			}
			if raw, ok := config["notificationTopics"]; ok {
				topics, valid := stringArray(raw)
				if !valid {
					return ActivityDefinitionView{}, ErrInvalid
				}
				condition.NotificationTopics = topics
			}
		}
	} else {
		builtin, found := findBuiltin(definitionID)
		if !found {
			return ActivityDefinitionView{}, ErrNotFound
		}
		fields = builtin.Fields
		if config != nil {
			if err := validateConfigPatch(ctx, owner, topicStore, fields, config); err != nil {
				return ActivityDefinitionView{}, err
			}
			if settings.Config[definitionID] == nil {
				settings.Config[definitionID] = map[string]any{}
			}
			for key, value := range config {
				settings.Config[definitionID][key] = value
			}
		}
	}
	if enabled != nil {
		settings.Enabled[definitionID] = *enabled
	}
	if err := store.SaveDefinitionSettings(ctx, owner, settings); err != nil {
		return ActivityDefinitionView{}, err
	}
	if enabled != nil && !*enabled && strings.HasPrefix(definitionID, "condition:") {
		if err := clearConditionActivities(ctx, store, owner, settings.Conditions[conditionIndex(settings.Conditions, strings.TrimPrefix(definitionID, "condition:"))]); err != nil {
			return ActivityDefinitionView{}, err
		}
	}
	views, err := ListDefinitionViews(ctx, store, owner, topicStore)
	if err != nil {
		return ActivityDefinitionView{}, err
	}
	for _, view := range views {
		if view.ID == definitionID {
			return view, nil
		}
	}
	return ActivityDefinitionView{}, ErrNotFound
}

func CreateResourceCondition(ctx context.Context, store *Store, topicStore *notifications.Store, resourceStore *resources.Store, registry *resources.Registry, owner, integrationSource string, input map[string]any) (ActivityDefinitionView, error) {
	title := textValue(input["title"])
	instanceID, collectionID, fieldPath, operator := textValue(input["instanceId"]), textValue(input["collectionId"]), textValue(input["fieldPath"]), textValue(input["operator"])
	if title == "" || len(title) > 120 || instanceID == "" || collectionID == "" || fieldPath == "" || !validConditionOperator(operator) {
		return ActivityDefinitionView{}, fmt.Errorf("condition requires a title, SDK resource, field, and supported operator")
	}
	if len(instanceID) > 200 || len(collectionID) > 120 || !conditionIdentifierPattern.MatchString(fieldPath) || !conditionIdentifierPattern.MatchString(collectionID) {
		return ActivityDefinitionView{}, fmt.Errorf("condition resource identifiers are invalid")
	}
	resourceType := "sdk." + strings.ToLower(strings.TrimSpace(integrationSource)) + "." + strings.ToLower(collectionID)
	registered, err := registry.List(ctx)
	if err != nil {
		return ActivityDefinitionView{}, err
	}
	declared := false
	for _, candidate := range registered {
		if candidate.Type == resourceType {
			declared = true
			break
		}
	}
	if !declared {
		return ActivityDefinitionView{}, fmt.Errorf("SDK resource collection not found")
	}
	resourceID := strings.TrimSpace(textValue(input["resourceId"]))
	if resourceID != "" {
		page, err := resourceStore.Query(ctx, resources.Query{OwnerID: owner, Types: []string{resourceType}, InstanceID: instanceID, Limit: 200})
		if err != nil {
			return ActivityDefinitionView{}, err
		}
		found := false
		for _, item := range page.Items {
			if item.ProviderResourceID == resourceID || item.ID == resourceID {
				found = true
				break
			}
		}
		if !found {
			return ActivityDefinitionView{}, fmt.Errorf("SDK resource not found")
		}
	}
	severity := textValue(input["severity"])
	if !validActivitySeverity(severity) {
		severity = "warning"
	}
	condition := ResourceActivityCondition{ID: newConditionID(), Title: title, InstanceID: instanceID, CollectionID: collectionID, FieldPath: fieldPath, Operator: operator, Severity: severity}
	if value, ok := input["value"]; ok {
		condition.Value = value
	}
	if description, ok := input["description"].(string); ok {
		condition.Description = description[:min(500, len(description))]
	}
	if resourceID != "" {
		condition.ResourceID = resourceID
	}
	if rawTopics, ok := input["notificationTopics"]; ok {
		topics, valid := stringArray(rawTopics)
		if !valid {
			return ActivityDefinitionView{}, fmt.Errorf("activity notification topics must belong to the current user")
		}
		if err := validateTopics(ctx, owner, topicStore, topics); err != nil {
			return ActivityDefinitionView{}, err
		}
		condition.NotificationTopics = topics
	}
	settings, err := store.DefinitionSettings(ctx, owner)
	if err != nil {
		return ActivityDefinitionView{}, err
	}
	settings.Conditions = append(settings.Conditions, condition)
	if err := store.SaveDefinitionSettings(ctx, owner, settings); err != nil {
		return ActivityDefinitionView{}, err
	}
	if err := ReconcileResourceConditionSnapshot(ctx, store, topicStore, owner, condition, resourceStore, registry); err != nil {
		return ActivityDefinitionView{}, err
	}
	views, err := ListDefinitionViews(ctx, store, owner, topicStore)
	if err != nil {
		return ActivityDefinitionView{}, err
	}
	for _, view := range views {
		if view.ID == "condition:"+condition.ID {
			return view, nil
		}
	}
	return ActivityDefinitionView{}, ErrNotFound
}

func DeleteResourceCondition(ctx context.Context, store *Store, owner, conditionID string) (bool, error) {
	settings, err := store.DefinitionSettings(ctx, owner)
	if err != nil {
		return false, err
	}
	index := conditionIndex(settings.Conditions, conditionID)
	if index < 0 {
		return false, nil
	}
	removed := settings.Conditions[index]
	settings.Conditions = append(settings.Conditions[:index], settings.Conditions[index+1:]...)
	delete(settings.Enabled, "condition:"+conditionID)
	if err := clearConditionActivities(ctx, store, owner, removed); err != nil {
		return false, err
	}
	if err := store.SaveDefinitionSettings(ctx, owner, settings); err != nil {
		return false, err
	}
	return true, nil
}

// ReconcileResourceConditionSnapshot materializes currently matching resource
// states as current Activity records and clears conditions that no longer match.
func ReconcileResourceConditionSnapshot(ctx context.Context, store *Store, topicStore *notifications.Store, owner string, condition ResourceActivityCondition, resourceStore *resources.Store, registry *resources.Registry) error {
	settings, err := store.DefinitionSettings(ctx, owner)
	if err != nil {
		return err
	}
	if !settingEnabled(settings, "condition:"+condition.ID, true) {
		return clearConditionActivities(ctx, store, owner, condition)
	}
	if !conditionTopicsRelevant(ctx, owner, topicStore, condition.NotificationTopics) {
		return clearConditionActivities(ctx, store, owner, condition)
	}
	definitions, err := registry.List(ctx)
	if err != nil {
		return err
	}
	types := make([]string, 0)
	for _, definition := range definitions {
		if strings.HasPrefix(definition.Type, "sdk.") && strings.HasSuffix(definition.Type, "."+strings.ToLower(condition.CollectionID)) {
			types = append(types, definition.Type)
		}
	}
	if len(types) == 0 {
		return clearConditionActivities(ctx, store, owner, condition)
	}
	active := map[string]bool{}
	for offset := 0; ; offset += 200 {
		page, err := resourceStore.Query(ctx, resources.Query{OwnerID: owner, Types: types, InstanceID: condition.InstanceID, Limit: 200, Offset: offset})
		if err != nil {
			return err
		}
		for _, item := range page.Items {
			if item.State != "current" {
				continue
			}
			resource := conditionResource(item)
			if condition.ResourceID != "" && condition.ResourceID != item.ProviderResourceID && condition.ResourceID != item.ID {
				continue
			}
			resourceID := item.ProviderResourceID
			if resourceID == "" {
				resourceID = item.ID
			}
			key := "resource-condition:" + condition.ID + ":" + resourceID
			if !EvaluateResourceActivityCondition(condition, resource) {
				if _, err := store.Clear(ctx, owner, "user-condition", condition.InstanceID, key); err != nil {
					return err
				}
				continue
			}
			active[key] = true
			state := fieldValue(resource, condition.FieldPath)
			metadata := map[string]any{"instanceId": condition.InstanceID, "collectionId": condition.CollectionID, "resourceId": resourceID, "fieldPath": condition.FieldPath, "value": jsonSafe(state)}
			_, _, err := store.Publish(ctx, owner, Input{Source: "user-condition", SourceID: condition.InstanceID, Type: "resource.condition", Title: condition.Title, Description: condition.Description, Severity: condition.Severity, IdempotencyKey: key, Current: true, Metadata: metadata})
			if err != nil {
				return err
			}
		}
		if len(page.Items) < 200 {
			break
		}
	}
	return clearConditionActivitiesExcept(ctx, store, owner, condition, active)
}

func EvaluateResourceActivityCondition(condition ResourceActivityCondition, resource map[string]any) bool {
	if condition.ResourceID != "" && condition.ResourceID != textValue(resource["id"]) {
		return false
	}
	value := fieldValue(resource, condition.FieldPath)
	switch condition.Operator {
	case "exists":
		return value != nil
	case "truthy":
		return truthy(value)
	case "equals":
		return reflect.DeepEqual(value, condition.Value)
	case "notEquals":
		return !reflect.DeepEqual(value, condition.Value)
	case "greaterThan":
		return compareNumbers(value, condition.Value, func(a, b float64) bool { return a > b })
	case "greaterThanOrEqual":
		return compareNumbers(value, condition.Value, func(a, b float64) bool { return a >= b })
	case "lessThan":
		return compareNumbers(value, condition.Value, func(a, b float64) bool { return a < b })
	case "lessThanOrEqual":
		return compareNumbers(value, condition.Value, func(a, b float64) bool { return a <= b })
	case "contains":
		switch current := value.(type) {
		case string:
			needle, ok := condition.Value.(string)
			return ok && strings.Contains(current, needle)
		case []any:
			for _, item := range current {
				if reflect.DeepEqual(item, condition.Value) {
					return true
				}
			}
		}
	}
	return false
}

func ResourceFieldPaths(resource map[string]any) []string {
	fields := []string{"name", "state", "available"}
	for _, root := range []string{"state", "attributes"} {
		if values, ok := resource[root].(map[string]any); ok {
			for key := range values {
				fields = append(fields, root+"."+key)
			}
		}
	}
	sort.Strings(fields)
	return fields
}

func conditionResource(item resources.Resource) map[string]any {
	resource := make(map[string]any, len(item.Data)+3)
	for key, value := range item.Data {
		resource[key] = value
	}
	resource["id"] = item.ProviderResourceID
	if _, ok := resource["name"]; !ok {
		if title, ok := resource["title"]; ok {
			resource["name"] = title
		}
	}
	if _, ok := resource["available"]; !ok {
		resource["available"] = item.State == "current"
	}
	return resource
}

func clearConditionActivities(ctx context.Context, store *Store, owner string, condition ResourceActivityCondition) error {
	return clearConditionActivitiesExcept(ctx, store, owner, condition, map[string]bool{})
}

func clearConditionActivitiesExcept(ctx context.Context, store *Store, owner string, condition ResourceActivityCondition, keep map[string]bool) error {
	prefix := "resource-condition:" + condition.ID + ":"
	for pageNumber := 1; ; pageNumber++ {
		page, err := store.List(ctx, owner, Query{Page: pageNumber, PerPage: 100, Source: "user-condition", Type: "resource.condition"})
		if err != nil {
			return err
		}
		for _, record := range page.Items {
			if record.SourceID != condition.InstanceID || !strings.HasPrefix(record.IdempotencyKey, prefix) || keep[record.IdempotencyKey] {
				continue
			}
			if _, err := store.Clear(ctx, owner, "user-condition", condition.InstanceID, record.IdempotencyKey); err != nil {
				return err
			}
		}
		if pageNumber >= page.TotalPages {
			break
		}
	}
	return nil
}

func conditionTopicsRelevant(ctx context.Context, owner string, topicStore *notifications.Store, topicIDs []string) bool {
	if len(topicIDs) == 0 || topicStore == nil {
		return true
	}
	items, err := topicStore.ListItems(ctx, owner, true)
	if err != nil {
		return false
	}
	allowed := map[string]bool{}
	for _, id := range topicIDs {
		allowed[id] = true
	}
	for _, item := range items {
		if allowed[item.TopicID] {
			return true
		}
	}
	return false
}

func listTopicOptions(ctx context.Context, owner string, topicStore *notifications.Store) ([]ActivityConfigOption, error) {
	if topicStore == nil {
		return []ActivityConfigOption{}, nil
	}
	topics, err := topicStore.ListTopics(ctx, owner)
	if err != nil {
		return nil, err
	}
	options := make([]ActivityConfigOption, 0, len(topics))
	for _, topic := range topics {
		options = append(options, ActivityConfigOption{Label: topic.Title, Value: topic.ID})
	}
	return options, nil
}

func withTopicOptions(fields []ActivityConfigField, options []ActivityConfigOption) []ActivityConfigField {
	result := append([]ActivityConfigField(nil), fields...)
	for index := range result {
		if result[index].Type == "topics" {
			result[index].Options = options
		}
	}
	return result
}

func validateConfigPatch(ctx context.Context, owner string, topicStore *notifications.Store, fields []ActivityConfigField, patch map[string]any) error {
	allowed := map[string]ActivityConfigField{}
	for _, field := range fields {
		allowed[field.Key] = field
	}
	for key, value := range patch {
		field, ok := allowed[key]
		if !ok {
			return fmt.Errorf("activity config contains an unknown field")
		}
		switch field.Type {
		case "number":
			n, ok := numberValue(value)
			if !ok || field.Min != nil && n < *field.Min || field.Max != nil && n > *field.Max {
				return fmt.Errorf("invalid activity config value: %s", key)
			}
		case "topics":
			topics, ok := stringArray(value)
			if !ok {
				return fmt.Errorf("activity notification topics must belong to the current user")
			}
			if err := validateTopics(ctx, owner, topicStore, topics); err != nil {
				return err
			}
		case "boolean":
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("invalid activity config value: %s", key)
			}
		default:
			if _, ok := value.(string); !ok {
				return fmt.Errorf("invalid activity config value: %s", key)
			}
		}
	}
	return nil
}

func validateTopics(ctx context.Context, owner string, topicStore *notifications.Store, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if topicStore == nil {
		return fmt.Errorf("notification topic store is unavailable")
	}
	topics, err := topicStore.ListTopics(ctx, owner)
	if err != nil {
		return err
	}
	owned := map[string]bool{}
	for _, topic := range topics {
		owned[topic.ID] = true
	}
	for _, id := range ids {
		if !owned[id] {
			return fmt.Errorf("activity notification topics must belong to the current user")
		}
	}
	return nil
}

func settingEnabled(settings DefinitionSettings, id string, defaultValue bool) bool {
	if value, ok := settings.Enabled[id]; ok {
		return value
	}
	return defaultValue
}
func findBuiltin(id string) (builtinDefinition, bool) {
	for _, item := range builtinDefinitions {
		if item.ID == id {
			return item, true
		}
	}
	return builtinDefinition{}, false
}
func conditionIndex(conditions []ResourceActivityCondition, id string) int {
	for index, condition := range conditions {
		if condition.ID == id {
			return index
		}
	}
	return -1
}
func validConditionOperator(operator string) bool {
	switch operator {
	case "equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "contains", "truthy", "exists":
		return true
	}
	return false
}
func textValue(value any) string {
	text, _ := value.(string)
	return text
}
func validActivitySeverity(value string) bool {
	switch value {
	case "info", "success", "warning", "error":
		return true
	}
	return false
}
func stringArray(value any) ([]string, bool) {
	items, ok := value.([]any)
	if !ok {
		if stringsValue, ok := value.([]string); ok {
			return stringsValue, true
		}
		return nil, false
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			return nil, false
		}
		result = append(result, text)
	}
	return result, true
}
func jsonObject(value any) (map[string]any, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	err = json.Unmarshal(encoded, &result)
	return result, err
}
func firstNonempty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
func fieldValue(value map[string]any, path string) any {
	var current any = value
	for _, part := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[part]
	}
	return current
}
func truthy(value any) bool {
	if value == nil {
		return false
	}
	switch current := value.(type) {
	case bool:
		return current
	case string:
		return current != ""
	case float64:
		return current != 0
	case int:
		return current != 0
	}
	return true
}
func numberValue(value any) (float64, bool) {
	switch current := value.(type) {
	case float64:
		return current, true
	case float32:
		return float64(current), true
	case int:
		return float64(current), true
	case int64:
		return float64(current), true
	}
	return 0, false
}
func compareNumbers(left, right any, compare func(float64, float64) bool) bool {
	a, okA := numberValue(left)
	b, okB := numberValue(right)
	return okA && okB && compare(a, b)
}
func jsonSafe(value any) any {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var safe any
	if json.Unmarshal(encoded, &safe) != nil {
		return nil
	}
	return safe
}
func newConditionID() string {
	id, err := newID()
	if err != nil {
		return fmt.Sprintf("condition-%d", time.Now().UnixNano())
	}
	return id
}

func (s *Store) DefinitionSettings(ctx context.Context, owner string) (DefinitionSettings, error) {
	if strings.TrimSpace(owner) == "" {
		return DefinitionSettings{}, ErrInvalid
	}
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT settings_json FROM activity_definition_settings WHERE owner_id=?`, owner).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return DefinitionSettings{Enabled: map[string]bool{}, Config: map[string]map[string]any{}, Conditions: []ResourceActivityCondition{}}, nil
	}
	if err != nil {
		return DefinitionSettings{}, fmt.Errorf("read activity definition settings: %w", err)
	}
	var settings DefinitionSettings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return DefinitionSettings{}, fmt.Errorf("decode activity definition settings: %w", err)
	}
	if settings.Enabled == nil {
		settings.Enabled = map[string]bool{}
	}
	if settings.Config == nil {
		settings.Config = map[string]map[string]any{}
	}
	if settings.Conditions == nil {
		settings.Conditions = []ResourceActivityCondition{}
	}
	return settings, nil
}

func (s *Store) SaveDefinitionSettings(ctx context.Context, owner string, settings DefinitionSettings) error {
	if strings.TrimSpace(owner) == "" {
		return ErrInvalid
	}
	if settings.Enabled == nil {
		settings.Enabled = map[string]bool{}
	}
	if settings.Config == nil {
		settings.Config = map[string]map[string]any{}
	}
	if settings.Conditions == nil {
		settings.Conditions = []ResourceActivityCondition{}
	}
	encoded, err := json.Marshal(settings)
	if err != nil || len(encoded) > 1<<20 {
		return ErrInvalid
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO activity_definition_settings(owner_id,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at`, owner, string(encoded), time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("save activity definition settings: %w", err)
	}
	return nil
}
