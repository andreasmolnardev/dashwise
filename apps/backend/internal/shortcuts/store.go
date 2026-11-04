// Package shortcuts stores launcher shortcuts and app groups as Dashwise resources.
package shortcuts

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

const resourceType = "dashwise.shortcut"
const provider = "dashwise"
const providerInstance = "shortcuts"

var ErrNotFound = errors.New("shortcut not found")
var ErrInvalid = errors.New("invalid shortcut")

type Store struct{ resources *resources.Store }
type ItemInput struct {
	Name       string   `json:"name"`
	Icon       string   `json:"icon"`
	Secondary  string   `json:"secondary"`
	Action     any      `json:"action"`
	Actions    any      `json:"actions"`
	Tags       []string `json:"tags"`
	SourceID   string   `json:"sourceId"`
	App        string   `json:"app"`
	IsPinned   bool     `json:"isPinned"`
	IsDisabled bool     `json:"isDisabled"`
}
type AppInput struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Icon string `json:"icon"`
}
type OnDemandInput struct {
	SourceID  string   `json:"sourceId"`
	Name      string   `json:"name"`
	Icon      string   `json:"icon"`
	Secondary string   `json:"secondary"`
	Action    string   `json:"action"`
	Tags      []string `json:"tags"`
}

func New(db *foundation.DB, store *resources.Store) (*Store, error) {
	if db == nil || db.SQL() == nil || store == nil {
		return nil, errors.New("shortcuts require an open database and resource store")
	}
	return &Store{resources: store}, nil
}

func (s *Store) List(ctx context.Context, owner string) ([]map[string]any, error) {
	items, err := s.all(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		data := item.Data
		if data["kind"] == "app" {
			continue
		}
		out = append(out, toLegacy(item))
	}
	sort.SliceStable(out, func(i, j int) bool {
		return strings.ToLower(stringValue(out[i]["name"])) < strings.ToLower(stringValue(out[j]["name"]))
	})
	return out, nil
}
func (s *Store) Patch(ctx context.Context, owner, id string, patch map[string]any) error {
	item, err := s.find(ctx, owner, id)
	if err != nil {
		return err
	}
	if item.Data["kind"] == "app" {
		return ErrNotFound
	}
	if v, ok := patch["isPinned"].(bool); ok {
		item.Data["isPinned"] = v
	}
	if v, ok := patch["isDisabled"].(bool); ok {
		item.Data["isDisabled"] = v
	}
	if v, ok := patch["app"]; ok {
		if v == nil {
			item.Data["app"] = ""
		} else if text, ok := v.(string); ok {
			item.Data["app"] = text
		} else {
			return ErrInvalid
		}
	}
	_, err = s.resources.Upsert(ctx, item)
	return err
}

// Action returns the configured action only after resolving the shortcut in
// the requesting owner's resource scope.
func (s *Store) Action(ctx context.Context, owner, id string) (any, error) {
	item, err := s.find(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	if item.Data["kind"] == "app" {
		return nil, ErrNotFound
	}
	return item.Data["action"], nil
}

func (s *Store) RecordUsage(ctx context.Context, owner, id, timestamp string) error {
	item, err := s.find(ctx, owner, id)
	if err != nil {
		return err
	}
	if _, err := time.Parse(time.RFC3339, timestamp); err != nil {
		return ErrInvalid
	}
	stats := anySlice(item.Data["usageStats"])
	stats = append(stats, map[string]any{"timestamp": timestamp})
	if len(stats) > 100 {
		stats = stats[len(stats)-100:]
	}
	item.Data["usageStats"] = stats
	_, err = s.resources.Upsert(ctx, item)
	return err
}
func (s *Store) FrequentlyUsed(ctx context.Context, owner string) []map[string]string {
	items, err := s.all(ctx, owner)
	if err != nil {
		return []map[string]string{}
	}
	type entry struct {
		id string
		n  int
	}
	rows := []entry{}
	for _, item := range items {
		if item.Data["kind"] == "app" {
			continue
		}
		n := len(anySlice(item.Data["usageStats"]))
		if n > 0 {
			rows = append(rows, entry{item.ProviderResourceID, n})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].n > rows[j].n })
	if len(rows) > 5 {
		rows = rows[:5]
	}
	out := make([]map[string]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]string{"id": row.id})
	}
	return out
}
func (s *Store) CreateApp(ctx context.Context, owner string, in AppInput) (map[string]any, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || in.Type != "on-demand" {
		return nil, ErrInvalid
	}
	id, err := newIdentity()
	if err != nil {
		return nil, err
	}
	appData := map[string]any{"kind": "app", "name": in.Name, "icon": strings.TrimSpace(in.Icon), "sourceId": "on-demand:" + id, "type": "on-demand"}
	if _, err := s.upsert(ctx, owner, id, appData); err != nil {
		return nil, err
	}
	shortcutID, err := newIdentity()
	if err != nil {
		return nil, err
	}
	shortcut := map[string]any{"kind": "shortcut", "name": in.Name, "icon": strings.TrimSpace(in.Icon), "secondary": "Shortcut app", "action": "app:" + id, "sourceId": "shortcuts-app:" + id, "tags": []string{in.Name, "shortcut app"}}
	if _, err := s.upsert(ctx, owner, shortcutID, shortcut); err != nil {
		return nil, err
	}
	return map[string]any{"appId": id, "id": id, "name": in.Name, "type": "on-demand"}, nil
}
func (s *Store) SyncOnDemand(ctx context.Context, owner, appID string, inputs []OnDemandInput) (map[string]any, error) {
	app, err := s.find(ctx, owner, appID)
	if err != nil || app.Data["kind"] != "app" || app.Data["type"] != "on-demand" {
		return nil, ErrNotFound
	}
	seen := map[string]bool{}
	for _, in := range inputs {
		in.SourceID = strings.TrimSpace(in.SourceID)
		in.Name = strings.TrimSpace(in.Name)
		in.Action = strings.TrimSpace(in.Action)
		if in.SourceID == "" || in.Name == "" || in.Action == "" || seen[in.SourceID] {
			return nil, ErrInvalid
		}
		seen[in.SourceID] = true
	}
	items, err := s.all(ctx, owner)
	if err != nil {
		return nil, err
	}
	existing := map[string]resources.Resource{}
	for _, item := range items {
		if item.Data["app"] == appID && item.Data["kind"] != "app" {
			existing[item.ProviderResourceID] = item
		}
	}
	created, updated := 0, 0
	for _, in := range inputs {
		data := map[string]any{"kind": "shortcut", "name": in.Name, "icon": in.Icon, "secondary": in.Secondary, "action": in.Action, "tags": in.Tags, "sourceId": in.SourceID, "app": appID, "isPinned": false, "isDisabled": false, "usageStats": []any{}}
		if current, ok := existing[in.SourceID]; ok {
			delete(existing, in.SourceID)
			if sameData(current.Data, data) {
				continue
			}
			// Provider sync owns shortcut metadata, while pin/disable state and
			// usage belong to the user. Keep those fields when refreshed metadata
			// changes so a sync cannot silently reset launcher preferences.
			for _, key := range []string{"isPinned", "isDisabled", "usageStats"} {
				if value, ok := current.Data[key]; ok {
					data[key] = value
				}
			}
			current.Data = data
			if _, err := s.resources.Upsert(ctx, current); err != nil {
				return nil, err
			}
			updated++
		} else {
			if _, err := s.upsert(ctx, owner, in.SourceID, data); err != nil {
				return nil, err
			}
			created++
		}
	}
	deleted := 0
	for _, item := range existing {
		if err := s.resources.Delete(ctx, owner, item.ID); err != nil {
			return nil, err
		}
		deleted++
	}
	return map[string]any{"appId": appID, "total": len(inputs), "created": created, "updated": updated, "deleted": deleted}, nil
}
func (s *Store) upsert(ctx context.Context, owner, id string, data map[string]any) (resources.Resource, error) {
	name := stringValue(data["name"])
	action := data["action"]
	urlValue := ""
	if text, ok := action.(string); ok && (strings.HasPrefix(text, "http://") || strings.HasPrefix(text, "https://")) {
		urlValue = text
	}
	return s.resources.Upsert(ctx, resources.Resource{Type: resourceType, Provider: provider, ProviderInstanceID: providerInstance, ProviderResourceID: id, OwnerID: owner, Capabilities: []string{"list", "detail", "search", "launch", "actions"}, Data: map[string]any{"title": name, "name": name, "url": urlValue, "description": stringValue(data["secondary"]), "kind": data["kind"], "action": data["action"], "actions": data["actions"], "icon": data["icon"], "secondary": data["secondary"], "tags": data["tags"], "sourceId": data["sourceId"], "app": data["app"], "isPinned": data["isPinned"], "isDisabled": data["isDisabled"], "usageStats": data["usageStats"]}})
}
func (s *Store) all(ctx context.Context, owner string) ([]resources.Resource, error) {
	out := []resources.Resource{}
	for offset := 0; ; offset += 200 {
		page, err := s.resources.Query(ctx, resources.Query{OwnerID: owner, Types: []string{resourceType}, Provider: provider, InstanceID: providerInstance, Limit: 200, Offset: offset, OrderBy: "type"})
		if err != nil {
			return nil, err
		}
		out = append(out, page.Items...)
		if len(out) >= page.Total || len(page.Items) == 0 {
			return out, nil
		}
	}
}
func (s *Store) find(ctx context.Context, owner, id string) (resources.Resource, error) {
	items, err := s.all(ctx, owner)
	if err != nil {
		return resources.Resource{}, err
	}
	for _, item := range items {
		if item.ProviderResourceID == id {
			return item, nil
		}
	}
	return resources.Resource{}, ErrNotFound
}
func toLegacy(item resources.Resource) map[string]any {
	d := item.Data
	action := d["action"]
	kind := "link"
	if text, ok := action.(string); ok && strings.HasPrefix(text, "app:") {
		kind = "app"
	}
	return map[string]any{"id": item.ProviderResourceID, "sourceId": d["sourceId"], "parentId": nonempty(d["app"]), "name": d["name"], "icon": d["icon"], "secondaryInfo": d["secondary"], "type": kind, "action": action, "actions": d["actions"], "tags": d["tags"], "isPinned": d["isPinned"], "isDisabled": d["isDisabled"], "usageStats": d["usageStats"]}
}
func sameData(a, b map[string]any) bool {
	for k, v := range b {
		if fmt.Sprint(a[k]) != fmt.Sprint(v) {
			return false
		}
	}
	return true
}
func nonempty(v any) any {
	if v == nil || v == "" {
		return nil
	}
	return v
}
func stringValue(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}
func anySlice(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	if a, ok := v.([]string); ok {
		out := []any{}
		for _, x := range a {
			out = append(out, x)
		}
		return out
	}
	return []any{}
}
func newIdentity() (string, error) { id, err := randomID(); return id, err }
func randomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
