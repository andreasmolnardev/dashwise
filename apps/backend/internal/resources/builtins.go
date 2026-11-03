package resources

import "context"

// BuiltinDefinitions are the stable resource contracts shared by native
// Dashwise domains. Storage and domain workflows remain specialized behind
// provider adapters; these definitions describe the fields consumers may use.
func BuiltinDefinitions() []Definition {
	return []Definition{
		{
			Type: "dashwise.link", Version: 1, Title: "Link",
			Fields: []FieldDefinition{
				{Name: "title", Type: "string", Filterable: true, Searchable: true},
				{Name: "kind", Type: "string", Filterable: true},
				{Name: "url", Type: "url", Searchable: true},
				{Name: "description", Type: "text", Searchable: true},
				{Name: "collectionId", Type: "string", Filterable: true},
				{Name: "favorite", Type: "boolean", Filterable: true},
				{Name: "createdAt", Type: "datetime", Filterable: true},
			},
			Capabilities: []string{"list", "detail", "search", "launch", "actions"},
		},
		{
			Type: "dashwise.shortcut", Version: 1, Title: "Shortcut",
			Fields: []FieldDefinition{
				{Name: "title", Type: "string", Filterable: true, Searchable: true},
				{Name: "url", Type: "url", Searchable: true},
				{Name: "description", Type: "text", Searchable: true},
				{Name: "createdAt", Type: "datetime", Filterable: true},
			},
			Capabilities: []string{"list", "detail", "search", "launch", "actions"},
		},
		{
			Type: "news.article", Version: 1, Title: "News article",
			Fields: []FieldDefinition{
				{Name: "title", Type: "string", Filterable: true, Searchable: true},
				{Name: "summary", Type: "text", Searchable: true},
				{Name: "url", Type: "url", Searchable: true},
				{Name: "source", Type: "string", Filterable: true, Searchable: true},
				{Name: "feedId", Type: "string", Filterable: true},
				{Name: "feedIds", Type: "array", Filterable: true},
				{Name: "isRead", Type: "boolean", Filterable: true},
				{Name: "publishedAt", Type: "datetime", Filterable: true},
			},
			Capabilities: []string{"list", "detail", "search", "save", "mark_read"},
		},
		{
			Type: "monitoring.host", Version: 1, Title: "Monitoring host",
			Fields: []FieldDefinition{
				{Name: "name", Type: "string", Filterable: true, Searchable: true},
				{Name: "hostname", Type: "string", Filterable: true, Searchable: true},
				{Name: "status", Type: "string", Filterable: true},
				{Name: "lastConnectedAt", Type: "datetime", Filterable: true},
			},
			Capabilities: []string{"list", "detail", "monitoring", "history"},
		},
		{
			Type: "monitoring.service", Version: 1, Title: "Monitored service",
			Fields: []FieldDefinition{
				{Name: "name", Type: "string", Filterable: true, Searchable: true},
				{Name: "url", Type: "url", Searchable: true},
				{Name: "linkId", Type: "string", Filterable: true},
				{Name: "status", Type: "string", Filterable: true},
				{Name: "checkedAt", Type: "datetime", Filterable: true},
			},
			Capabilities: []string{"list", "detail", "monitoring", "history"},
		},
		{
			Type: "calendar.event", Version: 1, Title: "Calendar event",
			Fields: []FieldDefinition{
				{Name: "title", Type: "string", Searchable: true},
				{Name: "description", Type: "text", Searchable: true},
				{Name: "startAt", Type: "datetime", Filterable: true},
				{Name: "endAt", Type: "datetime", Filterable: true},
				{Name: "location", Type: "string", Searchable: true},
			},
			Capabilities: []string{"list", "detail"},
		},
		{
			Type: "weather.forecast", Version: 1, Title: "Weather forecast",
			Fields: []FieldDefinition{
				{Name: "location", Type: "string", Filterable: true, Searchable: true},
				{Name: "temperature", Type: "number", Filterable: true},
				{Name: "condition", Type: "string", Filterable: true, Searchable: true},
				{Name: "observedAt", Type: "datetime", Filterable: true},
			},
			Capabilities: []string{"list", "detail"},
		},
	}
}

func (r *Registry) RegisterBuiltins(ctx context.Context) error {
	for _, definition := range BuiltinDefinitions() {
		if err := r.Register(ctx, definition); err != nil {
			return err
		}
	}
	return nil
}
