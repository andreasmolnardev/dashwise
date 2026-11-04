package resources

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// Filter is a constrained predicate over a declared, filterable top-level
// resource field. Operators include scalar comparisons, contains, containsAny,
// and exists.
type Filter struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value,omitempty"`
}

// SortField orders resources by a resource metadata or declared data field.
type SortField struct {
	Field     string `json:"field"`
	Direction string `json:"direction"`
}

// Query supports owner-scoped resource selection with bounded pagination.
type Query struct {
	OwnerID      string      `json:"ownerId"`
	Types        []string    `json:"types,omitempty"`
	Provider     string      `json:"provider,omitempty"`
	InstanceID   string      `json:"providerInstanceId,omitempty"`
	Capabilities []string    `json:"capabilities,omitempty"`
	Filters      []Filter    `json:"filters,omitempty"`
	Search       string      `json:"search,omitempty"`
	Sort         []SortField `json:"sort,omitempty"`
	OrderBy      string      `json:"orderBy,omitempty"`
	Limit        int         `json:"limit,omitempty"`
	Offset       int         `json:"offset,omitempty"`
}

type Page struct {
	Items  []Resource `json:"items"`
	Total  int        `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
}

func (s *Store) compileQuery(ctx context.Context, query Query) (string, []any, error) {
	if query.OwnerID == "" {
		return "", nil, errors.New("owner scope is required")
	}
	if len(query.Types) > 50 || len(query.Filters) > 20 || len(query.Capabilities) > 32 || len(query.Sort) > 4 {
		return "", nil, errors.New("resource query has too many types, filters, or capabilities")
	}
	if len(query.Search) > 256 {
		return "", nil, errors.New("resource search is limited to 256 bytes")
	}
	conditions := []string{"owner_id = ?"}
	args := []any{query.OwnerID}
	if query.Provider != "" {
		if !identifierPattern.MatchString(query.Provider) {
			return "", nil, errors.New("invalid provider identifier")
		}
		conditions = append(conditions, "provider = ?")
		args = append(args, query.Provider)
	}
	if query.InstanceID != "" {
		conditions = append(conditions, "provider_instance_id = ?")
		args = append(args, query.InstanceID)
	}
	for _, resourceType := range query.Types {
		if _, err := s.registry.Get(ctx, resourceType); err != nil {
			return "", nil, err
		}
	}
	if len(query.Types) == 1 {
		conditions = append(conditions, "type = ?")
		args = append(args, query.Types[0])
	} else if len(query.Types) > 1 {
		placeholders := make([]string, len(query.Types))
		for i, resourceType := range query.Types {
			placeholders[i] = "?"
			args = append(args, resourceType)
		}
		conditions = append(conditions, "type IN ("+join(placeholders, ",")+")")
	}
	for _, filter := range query.Filters {
		if len(query.Types) != 1 {
			return "", nil, errors.New("field filters require exactly one resource type")
		}
		definition, err := s.registry.Get(ctx, query.Types[0])
		if err != nil {
			return "", nil, err
		}
		field, exists := definition.field(filter.Field)
		if !exists || !field.Filterable {
			return "", nil, fmt.Errorf("field %q is not filterable", filter.Field)
		}
		condition, filterArgs, err := compileFilter(field, filter)
		if err != nil {
			return "", nil, err
		}
		conditions = append(conditions, condition)
		args = append(args, filterArgs...)
	}
	for _, capability := range query.Capabilities {
		if !identifierPattern.MatchString(capability) {
			return "", nil, fmt.Errorf("invalid resource capability %q", capability)
		}
		conditions = append(conditions, `EXISTS (SELECT 1 FROM json_each(resources.capabilities_json) c WHERE c.value = ?)`)
		args = append(args, capability)
	}
	if query.Search != "" {
		definitions := make([]Definition, 0, len(query.Types))
		if len(query.Types) > 0 {
			for _, resourceType := range query.Types {
				definition, err := s.registry.Get(ctx, resourceType)
				if err != nil {
					return "", nil, err
				}
				definitions = append(definitions, definition)
			}
		} else {
			var err error
			definitions, err = s.registry.List(ctx)
			if err != nil {
				return "", nil, fmt.Errorf("list searchable resource types: %w", err)
			}
			if len(definitions) > 100 {
				return "", nil, errors.New("global search spans too many resource types")
			}
		}
		typeSearch := make([]string, 0, len(definitions))
		for _, definition := range definitions {
			// Search is an explicit resource capability. A searchable field alone
			// does not opt a resource into global search; callers can still query
			// that resource directly for views that need field-level matching.
			searchEnabled := false
			for _, capability := range definition.Capabilities {
				if capability == "search" {
					searchEnabled = true
					break
				}
			}
			if !searchEnabled {
				continue
			}
			fields := make([]string, 0, len(definition.Fields))
			for _, field := range definition.Fields {
				if field.Searchable {
					fields = append(fields, field.Name)
				}
			}
			if len(fields) == 0 {
				continue
			}
			fieldSearch := make([]string, 0, len(fields))
			for range fields {
				fieldSearch = append(fieldSearch, "instr(lower(COALESCE(json_extract(data_json, ?), '')), lower(?)) > 0")
			}
			typeSearch = append(typeSearch, "(type = ? AND ("+join(fieldSearch, " OR ")+"))")
			args = append(args, definition.Type)
			for _, name := range fields {
				args = append(args, "$."+name, query.Search)
			}
		}
		if len(typeSearch) == 0 {
			return "", nil, errors.New("resource types have no searchable fields")
		}
		conditions = append(conditions, "("+join(typeSearch, " OR ")+")")
	}
	return " WHERE " + join(conditions, " AND "), args, nil
}

func compileSort(ctx context.Context, registry *Registry, query Query) (string, error) {
	if len(query.Sort) == 0 {
		orderBy := "updated_at DESC, id ASC"
		switch query.OrderBy {
		case "createdAt":
			orderBy = "created_at DESC, id ASC"
		case "type":
			orderBy = "type ASC, id ASC"
		case "publishedAt":
			if len(query.Types) != 1 || query.Types[0] != "news.article" {
				return "", errors.New("orderBy publishedAt is supported only for news.article")
			}
			orderBy = "json_extract(data_json, '$.publishedAt') DESC, id ASC"
		case "updatedAt", "":
		default:
			return "", errors.New("orderBy must be updatedAt, createdAt, type, or publishedAt for news.article")
		}
		return orderBy, nil
	}
	if query.OrderBy != "" {
		return "", errors.New("use either sort or orderBy, not both")
	}
	parts := make([]string, 0, len(query.Sort)+1)
	for _, item := range query.Sort {
		direction := strings.ToUpper(item.Direction)
		if direction != "ASC" && direction != "DESC" {
			return "", errors.New("sort direction must be asc or desc")
		}
		var expression string
		switch item.Field {
		case "createdAt":
			expression = "created_at"
		case "updatedAt":
			expression = "updated_at"
		case "type":
			expression = "type"
		default:
			if len(query.Types) != 1 {
				return "", errors.New("sorting by a resource data field requires exactly one resource type")
			}
			definition, err := registry.Get(ctx, query.Types[0])
			if err != nil {
				return "", err
			}
			if _, exists := definition.field(item.Field); !exists || !fieldPattern.MatchString(item.Field) {
				return "", fmt.Errorf("field %q is not declared on resource type %q", item.Field, query.Types[0])
			}
			expression = "json_extract(data_json, '$." + item.Field + "')"
		}
		parts = append(parts, expression+" "+direction)
	}
	parts = append(parts, "id ASC")
	return join(parts, ", "), nil
}

func compileFilter(fieldDefinition FieldDefinition, filter Filter) (string, []any, error) {
	path := "$." + fieldDefinition.Name // Definition validation restricts this to a safe identifier.
	field := "json_extract(data_json, ?)"
	if filter.Operator == "containsAny" {
		if fieldDefinition.Type != "array" {
			return "", nil, errors.New("containsAny operator requires an array field")
		}
		values, ok := filter.Value.([]any)
		if !ok || len(values) == 0 || len(values) > 100 {
			return "", nil, errors.New("containsAny filter value must be a non-empty array of at most 100 values")
		}
		placeholders := make([]string, len(values))
		args := []any{path}
		for index, value := range values {
			text, ok := value.(string)
			if !ok || text == "" || len(text) > 256 {
				return "", nil, errors.New("containsAny filter values must be non-empty strings up to 256 bytes")
			}
			placeholders[index] = "?"
			args = append(args, text)
		}
		return "EXISTS (SELECT 1 FROM json_each(COALESCE(" + field + ", '[]')) matching_value WHERE matching_value.value IN (" + join(placeholders, ",") + "))", args, nil
	}
	if filter.Operator == "exists" {
		if filter.Value == nil {
			return "json_type(data_json, ?) IS NOT NULL", []any{path}, nil
		}
		exists, ok := filter.Value.(bool)
		if !ok {
			return "", nil, errors.New("exists filter value must be boolean")
		}
		if exists {
			return "json_type(data_json, ?) IS NOT NULL", []any{path}, nil
		}
		return "json_type(data_json, ?) IS NULL", []any{path}, nil
	}
	operators := map[string]string{"eq": "=", "neq": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "contains": "contains"}
	operator, ok := operators[filter.Operator]
	if !ok {
		return "", nil, fmt.Errorf("unsupported filter operator %q", filter.Operator)
	}
	if filter.Value == nil {
		return "", nil, errors.New("filter value is required")
	}
	if operator == "contains" {
		if fieldDefinition.Type != "string" && fieldDefinition.Type != "text" && fieldDefinition.Type != "url" && fieldDefinition.Type != "datetime" && fieldDefinition.Type != "date" {
			return "", nil, errors.New("contains operator requires a string field")
		}
		if _, ok := filter.Value.(string); !ok {
			return "", nil, errors.New("contains filter value must be a string")
		}
		return "instr(lower(COALESCE(" + field + ", '')), lower(?)) > 0", []any{path, filter.Value}, nil
	}
	if err := validateFieldValue(fieldDefinition, filter.Value); err != nil {
		return "", nil, err
	}
	if (operator == ">" || operator == ">=" || operator == "<" || operator == "<=") && fieldDefinition.Type == "boolean" {
		return "", nil, errors.New("ordered comparisons are not supported for boolean fields")
	}
	return field + " " + operator + " ?", []any{path, filter.Value}, nil
}

func join(values []string, separator string) string {
	if len(values) == 0 {
		return ""
	}
	result := values[0]
	for _, value := range values[1:] {
		result += separator + value
	}
	return result
}
