// Package resources defines Dashwise's shared resource contract and SQLite
// registry/store. It intentionally leaves authorization to the API/domain
// layer that supplies the owner scope to each operation.
package resources

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

var identifierPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,127}$`)
var fieldPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)

// FieldDefinition describes a top-level field in a resource's JSON data.
// Filterable and Searchable are explicit opt-ins so queries cannot inspect
// arbitrary provider data by default.
type FieldDefinition struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Filterable bool   `json:"filterable,omitempty"`
	Searchable bool   `json:"searchable,omitempty"`
}

// Definition is the versioned contract for resources of one type.
type Definition struct {
	Type         string            `json:"type"`
	Version      int               `json:"version"`
	Title        string            `json:"title,omitempty"`
	Description  string            `json:"description,omitempty"`
	Fields       []FieldDefinition `json:"fields,omitempty"`
	Capabilities []string          `json:"capabilities,omitempty"`
}

func (d Definition) Validate() error {
	if !identifierPattern.MatchString(d.Type) {
		return errors.New("resource type must be a lowercase identifier")
	}
	if d.Version < 1 {
		return errors.New("resource definition version must be positive")
	}
	seen := make(map[string]struct{}, len(d.Fields))
	for _, field := range d.Fields {
		if !fieldPattern.MatchString(field.Name) {
			return fmt.Errorf("field %q must be a top-level identifier", field.Name)
		}
		if strings.TrimSpace(field.Type) == "" {
			return fmt.Errorf("field %q must declare a type", field.Name)
		}
		switch field.Type {
		case "string", "text", "url", "datetime", "date", "number", "integer", "boolean", "object", "array":
		default:
			return fmt.Errorf("field %q has unsupported type %q", field.Name, field.Type)
		}
		if field.Searchable && field.Type != "string" && field.Type != "text" && field.Type != "url" && field.Type != "datetime" && field.Type != "date" && field.Type != "number" && field.Type != "integer" && field.Type != "boolean" {
			return fmt.Errorf("field %q must be a scalar type to be searchable", field.Name)
		}
		switch field.Type {
		case "string", "text", "url", "datetime", "date", "number", "integer", "boolean", "object", "array":
		default:
			return fmt.Errorf("field %q has unsupported type %q", field.Name, field.Type)
		}
		if _, exists := seen[field.Name]; exists {
			return fmt.Errorf("duplicate field %q", field.Name)
		}
		seen[field.Name] = struct{}{}
	}
	for _, capability := range d.Capabilities {
		if !identifierPattern.MatchString(capability) {
			return fmt.Errorf("invalid resource capability %q", capability)
		}
	}
	return nil
}

func (d Definition) field(name string) (FieldDefinition, bool) {
	for _, field := range d.Fields {
		if field.Name == name {
			return field, true
		}
	}
	return FieldDefinition{}, false
}

func marshal(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode resource JSON: %w", err)
	}
	return string(encoded), nil
}
