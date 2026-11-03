package resources

import (
	"context"
	"errors"
	"fmt"
)

// Filter is a constrained predicate over a declared, filterable top-level
// resource field. Operators are eq, neq, gt, gte, lt, lte, contains, exists.
type Filter struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value,omitempty"`
}

// Query supports owner-scoped resource selection with bounded pagination.
type Query struct {
	OwnerID      string   `json:"ownerId"`
	Types        []string `json:"types,omitempty"`
	Provider     string   `json:"provider,omitempty"`
	InstanceID   string   `json:"providerInstanceId,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
	Filters      []Filter `json:"filters,omitempty"`
	Search       string   `json:"search,omitempty"`
	OrderBy      string   `json:"orderBy,omitempty"`
	Limit        int      `json:"limit,omitempty"`
	Offset       int      `json:"offset,omitempty"`
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
		condition, filterArgs, err := compileFilter(field.Name, filter)
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
		if len(query.Types) != 1 {
			return "", nil, errors.New("search requires exactly one resource type")
		}
		definition, err := s.registry.Get(ctx, query.Types[0])
		if err != nil {
			return "", nil, err
		}
		searchFields := make([]string, 0)
		for _, field := range definition.Fields {
			if field.Searchable {
				searchFields = append(searchFields, field.Name)
			}
		}
		if len(searchFields) == 0 {
			return "", nil, errors.New("resource type has no searchable fields")
		}
		searchConditions := make([]string, 0, len(searchFields))
		for _, name := range searchFields {
			searchConditions = append(searchConditions, "instr(lower(COALESCE(json_extract(data_json, ?), '')), lower(?)) > 0")
			args = append(args, "$."+name, query.Search)
		}
		conditions = append(conditions, "("+join(searchConditions, " OR ")+")")
	}
	return " WHERE " + join(conditions, " AND "), args, nil
}

func compileFilter(name string, filter Filter) (string, []any, error) {
	path := "$." + name // Definition validation restricts this to a safe identifier.
	field := "json_extract(data_json, ?)"
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
		if _, ok := filter.Value.(string); !ok {
			return "", nil, errors.New("contains filter value must be a string")
		}
		return "instr(lower(COALESCE(" + field + ", '')), lower(?)) > 0", []any{path, filter.Value}, nil
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
